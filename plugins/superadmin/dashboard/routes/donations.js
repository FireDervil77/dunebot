/**
 * SuperAdmin Donations Management Routes
 * Nur für Control-Guild sichtbar
 * 
 * @author DuneBot Development Team
 */

const express = require('express');
const router = express.Router();
const { ServiceManager } = require('dunebot-core');

const dbService = ServiceManager.get('dbService');
const Logger = ServiceManager.get('Logger');

/**
 * GET /guild/:guildId/plugins/superadmin/donations
 * Übersicht aller Donations mit Statistiken
 */
router.get('/', async (req, res) => {
    try {
        const { guildId } = req.params;
        Logger.info(`[SuperAdmin] Loading donations page for guild: ${guildId}`);
        
        // Alle Donations abrufen (neueste zuerst)
        // Note: Discord-Usernamen werden via IPC vom Bot geholt
        Logger.info('[SuperAdmin] Querying donations...');
        const [donationsResult] = await dbService.query(`
            SELECT 
                d.*,
                g.owner_name as guild_owner_name
            FROM donations d
            LEFT JOIN guilds g ON d.user_id = g.owner_id
            ORDER BY d.created_at DESC
            LIMIT 100
        `);
        const donations = Array.isArray(donationsResult) ? donationsResult : [];
        Logger.info(`[SuperAdmin] Found ${donations.length} donations`);

        // Statistiken abrufen
        Logger.info('[SuperAdmin] Querying stats...');
        const [statsResult] = await dbService.query(`
            SELECT 
                COUNT(*) as total_donations,
                SUM(CASE WHEN payment_status = 'completed' THEN 1 ELSE 0 END) as successful_donations,
                SUM(CASE WHEN payment_status = 'completed' THEN amount ELSE 0 END) as total_amount,
                AVG(CASE WHEN payment_status = 'completed' THEN amount ELSE NULL END) as average_donation,
                COUNT(DISTINCT user_id) as unique_supporters
            FROM donations
        `);
        const stats = Array.isArray(statsResult) && statsResult.length > 0 ? statsResult[0] : {};
        Logger.info('[SuperAdmin] Stats query completed');
        
        // Top Donors (Lifetime)
        Logger.info('[SuperAdmin] Querying top donors...');
        const [topDonorsResult] = await dbService.query(`
            SELECT 
                sb.user_id,
                sb.badge_level,
                sb.total_donated,
                sb.donation_count,
                g.owner_name as username,
                NULL as avatar,
                g.owner_name as full_username
            FROM supporter_badges sb
            LEFT JOIN guilds g ON sb.user_id = g.owner_id
            ORDER BY sb.total_donated DESC
            LIMIT 10
        `);
        const topDonors = Array.isArray(topDonorsResult) ? topDonorsResult : [];
        
        // Monatliche Statistiken (letzte 12 Monate)
        const [monthlyStatsResult] = await dbService.query(`
            SELECT 
                DATE_FORMAT(created_at, '%Y-%m') as month,
                COUNT(*) as donation_count,
                SUM(amount) as total_amount
            FROM donations
            WHERE payment_status = 'completed'
                AND created_at >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
            GROUP BY DATE_FORMAT(created_at, '%Y-%m')
            ORDER BY month DESC
        `);
        const monthlyStats = Array.isArray(monthlyStatsResult) ? monthlyStatsResult : [];
        
        // Badge-Verteilung
        const [badgeDistributionResult] = await dbService.query(`
            SELECT 
                badge_level,
                COUNT(*) as count
            FROM supporter_badges
            WHERE is_active = 1
            GROUP BY badge_level
        `);
        const badgeDistribution = Array.isArray(badgeDistributionResult) ? badgeDistributionResult : [];
        
        // Template rendern mit ThemeManager (wie Greeting Plugin)
        const themeManager = ServiceManager.get('themeManager');
        await themeManager.renderView(res, 'guild/donations', {
            title: 'Donations',
            activeMenu: `/guild/${guildId}/plugins/superadmin/donations`,
            guildId,
            donations: donations || [],
            stats: stats || {},
            topDonors: topDonors || [],
            monthlyStats: monthlyStats || [],
            badgeDistribution: badgeDistribution || []
        });
        
    } catch (error) {
        const Logger = ServiceManager.get('Logger');
        Logger.error('[SuperAdmin] Error loading donations page:', error);
        res.status(500).send('Fehler beim Laden der Donations-Seite');
    }
});

/**
 * POST /guild/:guildId/plugins/superadmin/donations/create
 * Manuelle Donation erstellen (für Offline-Spenden, Überweisungen etc.)
 */
router.post('/create', async (req, res) => {
    try {
        const { guildId } = req.params;
        const { user_id, amount, note, payment_provider = 'manual' } = req.body;
        
        // Validierung
        if (!user_id || !amount) {
            return res.status(400).json({ 
                success: false, 
                message: 'User-ID und Betrag sind erforderlich' 
            });
        }
        
        const parsedAmount = parseFloat(amount);
        if (isNaN(parsedAmount) || parsedAmount < 0.01) {
            return res.status(400).json({ 
                success: false, 
                message: 'Ungültiger Betrag (min. €0.01)' 
            });
        }
        
        // User abrufen (via Guild Owner)
        const [guilds] = await dbService.query(
            'SELECT owner_id, owner_name FROM guilds WHERE owner_id = ?',
            [user_id]
        );
        
        if (guilds.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'User nicht gefunden (nicht als Guild-Owner registriert)' 
            });
        }
        
        const user = { 
            id: guilds[0].owner_id, 
            username: guilds[0].owner_name 
        };
        
        // Donation erstellen
        const [result] = await dbService.query(`
            INSERT INTO donations (
                user_id, guild_id, amount, payment_provider, 
                payment_status, metadata, created_at
            ) VALUES (?, ?, ?, ?, 'completed', ?, NOW())
        `, [
            user_id,
            guildId,
            parsedAmount,
            payment_provider,
            JSON.stringify({ 
                note: note || 'Manuelle Donation',
                created_by: req.user.id,
                created_by_username: req.user.username 
            })
        ]);
        
        // Supporter-Badge aktualisieren
        await recalculateSupporterBadge(user_id);
        
        // IPC: Discord-Role vergeben via broadcastOne
        try {
            const ipcServer = ServiceManager.get('ipcServer');
            await ipcServer.broadcastOne('dashboard:SET_SUPPORTER_ROLE', { 
                userId: user_id,
                amount: parsedAmount 
            });
        } catch (ipcError) {
            Logger.error('[SuperAdmin] IPC error when setting supporter role:', ipcError);
        }
        
        Logger.info(`[SuperAdmin] Manual donation created: €${parsedAmount} for user ${user.username}`);
        
        res.json({ 
            success: true, 
            message: `Donation von €${parsedAmount.toFixed(2)} erfolgreich erstellt`,
            donationId: result.insertId
        });
        
    } catch (error) {
        Logger.error('[SuperAdmin] Error creating manual donation:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Fehler beim Erstellen der Donation' 
        });
    }
});

/**
 * DELETE /guild/:guildId/plugins/superadmin/donations/:donationId
 * Donation löschen (z.B. bei Rückbuchung/Betrug)
 */
router.delete('/:donationId', async (req, res) => {
    try {
        const { donationId } = req.params;
        
        // Donation abrufen
        const [donations] = await dbService.query(
            'SELECT * FROM donations WHERE id = ?',
            [donationId]
        );
        
        if (donations.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Donation nicht gefunden' 
            });
        }
        
        const donation = donations[0];
        
        // Status auf "refunded" setzen (nicht löschen für Audit-Trail)
        await dbService.query(
            'UPDATE donations SET payment_status = ?, metadata = JSON_SET(metadata, "$.refunded_by", ?, "$.refunded_at", NOW()) WHERE id = ?',
            [
                'refunded',
                req.user.id,
                donationId
            ]
        );
        
        // Supporter-Badge neu berechnen
        await recalculateSupporterBadge(donation.user_id);
        
        // IPC: Discord-Role aktualisieren via broadcastOne
        try {
            const ipcServer = ServiceManager.get('ipcServer');
            await ipcServer.broadcastOne('dashboard:SET_SUPPORTER_ROLE', { 
                userId: donation.user_id,
                amount: 0 // Trigger recalculation
            });
        } catch (ipcError) {
            Logger.error('[SuperAdmin] IPC error when updating supporter role:', ipcError);
        }
        
        Logger.info(`[SuperAdmin] Donation ${donationId} marked as refunded by ${req.user.username}`);
        
        res.json({ 
            success: true, 
            message: 'Donation als erstattet markiert' 
        });
        
    } catch (error) {
        Logger.error('[SuperAdmin] Error refunding donation:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Fehler beim Erstatten der Donation' 
        });
    }
});

/**
 * POST /guild/:guildId/plugins/superadmin/donations/recalculate
 * Alle Supporter-Badges neu berechnen
 */
router.post('/recalculate', async (req, res) => {
    try {
        // Alle User mit Donations abrufen
        const [users] = await dbService.query(`
            SELECT DISTINCT user_id 
            FROM donations 
            WHERE payment_status = 'completed'
        `);
        
        let updated = 0;
        for (const { user_id } of users) {
            await recalculateSupporterBadge(user_id);
            updated++;
        }
        
        Logger.info(`[SuperAdmin] Recalculated ${updated} supporter badges`);
        
        res.json({ 
            success: true, 
            message: `${updated} Supporter-Badges neu berechnet` 
        });
        
    } catch (error) {
        Logger.error('[SuperAdmin] Error recalculating badges:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Fehler bei der Neuberechnung' 
        });
    }
});

/**
 * Helper: Supporter-Badge für einen User neu berechnen
 * @param {string} userId - Discord User ID
 */
async function recalculateSupporterBadge(userId) {
    try {
        // Gesamtsumme berechnen
        const [result] = await dbService.query(`
            SELECT 
                SUM(amount) as total_donated,
                COUNT(*) as donation_count
            FROM donations
            WHERE user_id = ?
                AND payment_status = 'completed'
        `, [userId]);
        
        const totalDonated = parseFloat(result[0]?.total_donated || 0);
        const donationCount = parseInt(result[0]?.donation_count || 0);
        
        // Badge-Level berechnen
        const badgeLevel = calculateBadgeLevel(totalDonated);
        
        if (totalDonated === 0 || !badgeLevel) {
            // Badge löschen oder deaktivieren
            await dbService.query(`
                DELETE FROM supporter_badges 
                WHERE user_id = ?
            `, [userId]);
            return;
        }
        
        // Badge erstellen oder aktualisieren
        await dbService.query(`
            INSERT INTO supporter_badges (
                user_id, badge_level, total_donated, donation_count, 
                is_active, created_at, updated_at
            ) VALUES (?, ?, ?, ?, 1, NOW(), NOW())
            ON DUPLICATE KEY UPDATE
                badge_level = VALUES(badge_level),
                total_donated = VALUES(total_donated),
                donation_count = VALUES(donation_count),
                is_active = 1,
                updated_at = NOW()
        `, [userId, badgeLevel, totalDonated, donationCount]);
        
        Logger.debug(`[SuperAdmin] Updated supporter badge for user ${userId}: ${badgeLevel} (€${totalDonated.toFixed(2)})`);
        
    } catch (error) {
        Logger.error('[SuperAdmin] Error recalculating supporter badge:', error);
        throw error;
    }
}

/**
 * Helper: Badge-Level basierend auf Gesamtsumme berechnen
 * @param {number} totalDonated - Gesamtsumme der Donations
 * @returns {string|null} Badge-Level oder null
 */
function calculateBadgeLevel(totalDonated) {
    if (totalDonated >= 100) return 'platinum';
    if (totalDonated >= 50) return 'gold';
    if (totalDonated >= 20) return 'silver';
    if (totalDonated >= 5) return 'bronze';
    return null;
}

// Exports für Tests
module.exports = router;
module.exports.recalculateSupporterBadge = recalculateSupporterBadge;
module.exports.calculateBadgeLevel = calculateBadgeLevel;
