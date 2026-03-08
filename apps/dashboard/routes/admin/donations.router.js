/**
 * Admin Donations Management Routes
 * Globale Donations-Verwaltung unter /admin/donations
 *
 * @author FireBot Team
 */

'use strict';

const express = require('express');
const router = express.Router();
const { ServiceManager } = require('dunebot-core');

// ============================================================
// GET /admin/donations — Übersicht
// ============================================================
router.get('/', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');

    try {
        const donations = await dbService.query(`
            SELECT d.*, g.owner_name as guild_owner_name
            FROM donations d
            LEFT JOIN guilds g ON d.user_id = g.owner_id
            ORDER BY d.created_at DESC LIMIT 100
        `);
        const statsRows = await dbService.query(`
            SELECT COUNT(*) as total_donations,
                SUM(CASE WHEN payment_status='completed' THEN 1 ELSE 0 END) as successful_donations,
                SUM(CASE WHEN payment_status='completed' THEN amount ELSE 0 END) as total_amount,
                AVG(CASE WHEN payment_status='completed' THEN amount ELSE NULL END) as average_donation,
                COUNT(DISTINCT user_id) as unique_supporters
            FROM donations
        `);
        const stats = statsRows[0] || {};
        const topDonors = await dbService.query(`
            SELECT sb.user_id, sb.badge_level, sb.total_donated, sb.donation_count, g.owner_name as username
            FROM supporter_badges sb LEFT JOIN guilds g ON sb.user_id = g.owner_id
            ORDER BY sb.total_donated DESC LIMIT 10
        `);
        const monthlyStats = await dbService.query(`
            SELECT DATE_FORMAT(created_at,'%Y-%m') as month, COUNT(*) as donation_count, SUM(amount) as total_amount
            FROM donations WHERE payment_status='completed' AND created_at >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
            GROUP BY DATE_FORMAT(created_at,'%Y-%m') ORDER BY month DESC
        `);
        const badgeDistribution = await dbService.query(`
            SELECT badge_level, COUNT(*) as count FROM supporter_badges WHERE is_active=1 GROUP BY badge_level
        `);
        const themeManager = ServiceManager.get('themeManager');
        await themeManager.renderView(res, 'admin/donations', {
            title: 'Donations', activeMenu: '/admin/donations',
            donations: donations || [], stats: stats || {},
            topDonors: topDonors || [], monthlyStats: monthlyStats || [],
            badgeDistribution: badgeDistribution || []
        });
    } catch (error) {
        Logger.error('[Admin/Donations] Fehler beim Laden:', error);
        res.status(500).render('error', { message: 'Fehler beim Laden der Donations', error });
    }
});

router.post('/create', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    try {
        const { user_id, amount, note, payment_provider = 'manual' } = req.body;
        if (!user_id || !amount) return res.status(400).json({ success: false, message: 'User-ID und Betrag sind erforderlich' });
        const parsedAmount = parseFloat(amount);
        if (isNaN(parsedAmount) || parsedAmount < 0.01) return res.status(400).json({ success: false, message: 'Ungültiger Betrag (min. €0.01)' });
        const guilds = await dbService.query('SELECT owner_id, owner_name FROM guilds WHERE owner_id = ?', [user_id]);
        if (!guilds || guilds.length === 0) return res.status(404).json({ success: false, message: 'User nicht gefunden' });
        const result = await dbService.query(
            `INSERT INTO donations (user_id, guild_id, amount, payment_provider, payment_status, metadata, created_at) VALUES (?, NULL, ?, ?, 'completed', ?, NOW())`,
            [user_id, parsedAmount, payment_provider, JSON.stringify({ note: note || 'Manuelle Donation', created_by: req.session.user?.info?.id })]
        );
        await recalculateSupporterBadge(user_id);
        try { await ServiceManager.get('ipcServer').broadcastOne('dashboard:SET_SUPPORTER_ROLE', { userId: user_id, amount: parsedAmount }); } catch (e) { Logger.warn('[Admin/Donations] IPC-Fehler:', e.message); }
        Logger.info(`[Admin/Donations] Manuelle Donation: €${parsedAmount} für ${user_id}`);
        res.json({ success: true, message: `Donation von €${parsedAmount.toFixed(2)} erstellt`, donationId: result.insertId });
    } catch (error) {
        Logger.error('[Admin/Donations] Fehler:', error);
        res.status(500).json({ success: false, message: 'Fehler beim Erstellen der Donation' });
    }
});

router.delete('/:donationId', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    try {
        const { donationId } = req.params;
        const donations = await dbService.query('SELECT * FROM donations WHERE id = ?', [donationId]);
        if (!donations || donations.length === 0) return res.status(404).json({ success: false, message: 'Donation nicht gefunden' });
        await dbService.query(
            'UPDATE donations SET payment_status=?, metadata=JSON_SET(COALESCE(metadata,"{}"), "$.refunded_by", ?, "$.refunded_at", ?) WHERE id=?',
            ['refunded', req.session.user?.info?.id, new Date().toISOString(), donationId]
        );
        await recalculateSupporterBadge(donations[0].user_id);
        try { await ServiceManager.get('ipcServer').broadcastOne('dashboard:SET_SUPPORTER_ROLE', { userId: donations[0].user_id, amount: 0 }); } catch (e) { Logger.warn('[Admin/Donations] IPC-Fehler:', e.message); }
        Logger.info(`[Admin/Donations] Donation ${donationId} erstattet`);
        res.json({ success: true, message: 'Donation als erstattet markiert' });
    } catch (error) {
        Logger.error('[Admin/Donations] Fehler:', error);
        res.status(500).json({ success: false, message: 'Fehler beim Erstatten' });
    }
});

router.post('/recalculate', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    try {
        const users = await dbService.query(`SELECT DISTINCT user_id FROM donations WHERE payment_status='completed'`);
        let updated = 0;
        for (const { user_id } of users) { await recalculateSupporterBadge(user_id); updated++; }
        Logger.info(`[Admin/Donations] ${updated} Badges neu berechnet`);
        res.json({ success: true, message: `${updated} Supporter-Badges neu berechnet` });
    } catch (error) {
        Logger.error('[Admin/Donations] Fehler:', error);
        res.status(500).json({ success: false, message: 'Fehler bei der Neuberechnung' });
    }
});

async function recalculateSupporterBadge(userId) {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const rows = await dbService.query(`SELECT SUM(amount) as total_donated, COUNT(*) as donation_count FROM donations WHERE user_id=? AND payment_status='completed'`, [userId]);
    const totalDonated = parseFloat(rows[0]?.total_donated || 0);
    const donationCount = parseInt(rows[0]?.donation_count || 0);
    const badgeLevel = calculateBadgeLevel(totalDonated);
    if (totalDonated === 0 || !badgeLevel) { await dbService.query('DELETE FROM supporter_badges WHERE user_id=?', [userId]); return; }
    await dbService.query(
        `INSERT INTO supporter_badges (user_id, badge_level, total_donated, donation_count, is_active, created_at, updated_at) VALUES (?,?,?,?,1,NOW(),NOW()) ON DUPLICATE KEY UPDATE badge_level=VALUES(badge_level), total_donated=VALUES(total_donated), donation_count=VALUES(donation_count), is_active=1, updated_at=NOW()`,
        [userId, badgeLevel, totalDonated, donationCount]
    );
    Logger.debug(`[Admin/Donations] Badge für ${userId}: ${badgeLevel} (€${totalDonated.toFixed(2)})`);
}

function calculateBadgeLevel(total) {
    if (total >= 100) return 'platinum';
    if (total >= 50) return 'gold';
    if (total >= 20) return 'silver';
    if (total >= 5) return 'bronze';
    return null;
}

module.exports = router;
module.exports.recalculateSupporterBadge = recalculateSupporterBadge;
module.exports.calculateBadgeLevel = calculateBadgeLevel;
