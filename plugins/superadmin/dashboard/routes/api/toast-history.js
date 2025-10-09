/**
 * Superadmin API - Toast-History
 * 
 * Liest Toast-Events aus der Datenbank für Monitoring
 * 
 * @author FireDervil
 */

const express = require('express');
const router = express.Router();
const { ServiceManager } = require('dunebot-core');

/**
 * GET /api/superadmin/toast-history
 * Holt Toast-Events aus DB (nur für Superadmins)
 * 
 * Query-Parameter:
 * - type: Filter nach Toast-Typ (error, warning, etc.)
 * - username: Filter nach Username
 * - guildId: Filter nach Guild-ID
 * - limit: Max. Anzahl (default: 100)
 */
router.get('/toast-history', async (req, res) => {
    try {
        const logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');
        
        // Superadmin-Check (falls Middleware nicht vorhanden)
        if (!req.session?.user?.isSuperAdmin) {
            return res.status(403).json({ 
                success: false, 
                error: 'Nur für Superadmins' 
            });
        }

        const { type, username, guildId, limit = 100 } = req.query;
        
        // Query zusammenbauen
        let query = 'SELECT * FROM toast_events WHERE 1=1';
        const params = [];
        
        if (type) {
            query += ' AND type = ?';
            params.push(type);
        }
        
        if (username) {
            query += ' AND username LIKE ?';
            params.push(`%${username}%`);
        }
        
        if (guildId) {
            query += ' AND guild_id = ?';
            params.push(guildId);
        }
        
        query += ' ORDER BY created_at DESC LIMIT ?';
        params.push(parseInt(limit));
        
        // Abfrage ausführen
        const toasts = await dbService.query(query, params);
        
        res.json({
            success: true,
            count: toasts.length,
            toasts: toasts
        });

    } catch (error) {
        const logger = ServiceManager.get('Logger');
        logger.error({ 
            component: 'SuperadminAPI', 
            error: error.message 
        }, 'Fehler beim Abrufen der Toast-History');

        res.status(500).json({ 
            success: false, 
            error: 'Interner Serverfehler' 
        });
    }
});

module.exports = router;
