/**
 * Kern-Donations-Router
 * Routes: /guild/:guildId/donate, /guild/:guildId/hall-of-fame
 *
 * Ersetzt das Core-Plugin für Donations und Hall of Fame Routen.
 *
 * @author FireDervil
 */

const express = require('express');
const { ServiceManager } = require('dunebot-core');

// Router für /guild/:guildId/donate
const donateRouter = express.Router({ mergeParams: true });

// Router für /guild/:guildId/hall-of-fame
const hallOfFameRouter = express.Router({ mergeParams: true });

// GET / (→ /guild/:guildId/donate)
donateRouter.get('/', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const themeManager = ServiceManager.get('themeManager');
    const guildId = req.params.guildId;
    const userId = req.session?.user?.info?.id || null;

    try {
        // User Badge abrufen (falls vorhanden und eingeloggt)
        let badges = [];
        if (userId) {
            const badgeResult = await dbService.query(
                'SELECT * FROM supporter_badges WHERE user_id = ? AND is_active = 1',
                [userId]
            );
            badges = Array.isArray(badgeResult) ? badgeResult : [];
        }

        // Community Stats
        const statsResult = await dbService.query(`
            SELECT 
                SUM(CASE WHEN payment_status = 'completed' THEN amount ELSE 0 END) as total_amount,
                COUNT(DISTINCT user_id) as supporter_count
            FROM donations
        `);
        const stats = Array.isArray(statsResult) ? statsResult : [];

        await themeManager.renderView(res, 'guild/donate', {
            title: 'DuneBot unterstützen',
            activeMenu: `/guild/${guildId}/donate`,
            guildId,
            userBadge: badges[0] || null,
            communityStats: stats[0] || { total_amount: 0, supporter_count: 0 }
        });
    } catch (error) {
        Logger.error('[KernDonations] Fehler beim Laden der Donate-Seite:', error);
        res.status(500).render('error', { message: 'Fehler beim Laden der Seite' });
    }
});

// GET /success (→ /guild/:guildId/donate/success)
donateRouter.get('/success', (req, res) => {
    const themeManager = ServiceManager.get('themeManager');
    const guildId = req.params.guildId;

    themeManager.renderView(res, 'guild/donate-success', {
        title: 'Danke für deine Unterstützung!',
        activeMenu: `/guild/${guildId}/donate`,
        guildId,
        sessionId: req.query.session_id || null
    });
});

// GET /cancel (→ /guild/:guildId/donate/cancel)
donateRouter.get('/cancel', (req, res) => {
    const themeManager = ServiceManager.get('themeManager');
    const guildId = req.params.guildId;

    themeManager.renderView(res, 'guild/donate-cancel', {
        title: 'Zahlung abgebrochen',
        activeMenu: `/guild/${guildId}/donate`,
        guildId
    });
});

// GET / (→ /guild/:guildId/hall-of-fame)
hallOfFameRouter.get('/', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const themeManager = ServiceManager.get('themeManager');
    const guildId = req.params.guildId;
    const userId = req.session?.user?.info?.id || null;

    try {
        // Top Donators abrufen (mit Badge-Info und User-Details)
        const topDonators = await dbService.query(`
            SELECT 
                d.user_id,
                SUM(CASE WHEN d.payment_status = 'completed' THEN d.amount ELSE 0 END) as total_donated,
                COUNT(CASE WHEN d.payment_status = 'completed' THEN 1 END) as donation_count,
                MAX(d.created_at) as last_donation,
                sb.badge_level,
                sb.is_active as has_active_badge,
                JSON_UNQUOTE(JSON_EXTRACT(d.metadata, '$.username')) as username
            FROM donations d
            LEFT JOIN supporter_badges sb ON d.user_id = sb.user_id AND sb.is_active = 1
            WHERE d.payment_status = 'completed'
            GROUP BY d.user_id
            ORDER BY total_donated DESC
            LIMIT 50
        `);

        // Community Stats
        const statsResult = await dbService.query(`
            SELECT 
                SUM(CASE WHEN payment_status = 'completed' THEN amount ELSE 0 END) as total_amount,
                COUNT(DISTINCT user_id) as supporter_count,
                COUNT(CASE WHEN payment_status = 'completed' THEN 1 END) as total_donations,
                AVG(CASE WHEN payment_status = 'completed' THEN amount END) as avg_donation
            FROM donations
        `);
        const stats = Array.isArray(statsResult) && statsResult.length > 0
            ? statsResult[0]
            : { total_amount: 0, supporter_count: 0, total_donations: 0, avg_donation: 0 };

        // User Badge & Rang (falls eingeloggt)
        let userBadge = null;
        let userRank = null;
        if (userId) {
            const badgeResult = await dbService.query(
                'SELECT * FROM supporter_badges WHERE user_id = ? AND is_active = 1',
                [userId]
            );
            userBadge = Array.isArray(badgeResult) && badgeResult.length > 0 ? badgeResult[0] : null;

            const rankIndex = Array.isArray(topDonators) ? topDonators.findIndex(d => d.user_id === userId) : -1;
            userRank = rankIndex >= 0 ? rankIndex + 1 : null;
        }

        await themeManager.renderView(res, 'guild/hall-of-fame', {
            title: 'Hall of Fame - Top Supporters',
            activeMenu: `/guild/${guildId}/hall-of-fame`,
            guildId,
            topDonators: topDonators || [],
            communityStats: stats,
            userBadge,
            userRank,
            userId: userId || null
        });
    } catch (error) {
        Logger.error('[KernDonations] Fehler beim Laden der Hall of Fame:', error);
        res.status(500).render('error', { message: 'Fehler beim Laden der Hall of Fame' });
    }
});

module.exports = { donateRouter, hallOfFameRouter };
