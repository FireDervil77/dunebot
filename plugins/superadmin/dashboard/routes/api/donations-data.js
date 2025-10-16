/**
 * SuperAdmin API - Donations Data
 * 
 * Lädt alle Donations-Daten (Statistiken, Top Donors, Badge-Verteilung)
 * 
 * @author FireDervil
 */

const express = require('express');
const router = express.Router();
const { ServiceManager } = require('dunebot-core');

/**
 * GET /api/superadmin/donations
 * Holt alle Donations-Daten
 */
router.get('/donations', async (req, res) => {
    try {
        const Logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');
        const { guildId } = req.query;

        Logger.info(`[SuperAdmin API] Loading donations data for guild: ${guildId}`);
        
        // Alle Donations abrufen (neueste zuerst)
        Logger.info('[SuperAdmin API] Querying donations...');
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
        Logger.info(`[SuperAdmin API] Found ${donations.length} donations`);

        // Statistiken abrufen
        Logger.info('[SuperAdmin API] Querying stats...');
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
        Logger.info('[SuperAdmin API] Stats query completed');
        
        // Top Donors (Lifetime)
        Logger.info('[SuperAdmin API] Querying top donors...');
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
        Logger.info('[SuperAdmin API] Querying monthly stats...');
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
        Logger.info('[SuperAdmin API] Querying badge distribution...');
        const [badgeDistributionResult] = await dbService.query(`
            SELECT 
                badge_level,
                COUNT(*) as count
            FROM supporter_badges
            WHERE is_active = 1
            GROUP BY badge_level
        `);
        const badgeDistribution = Array.isArray(badgeDistributionResult) ? badgeDistributionResult : [];
        
        Logger.info('[SuperAdmin API] Donations data loaded successfully');
        
        res.json({
            success: true,
            data: {
                donations,
                stats,
                topDonors,
                monthlyStats,
                badgeDistribution
            }
        });
        
    } catch (error) {
        const Logger = ServiceManager.get('Logger');
        Logger.error('[SuperAdmin API] Error loading donations data:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Fehler beim Laden der Donations-Daten',
            error: error.message
        });
    }
});

module.exports = router;
