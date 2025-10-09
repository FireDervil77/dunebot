/**
 * Toast-Logger API
 * 
 * Empfängt und speichert Toast-Events vom Frontend für Monitoring/Debugging.
 * Speichert kritische Toasts (error, warning) in Session und optional in DB.
 * 
 * @author FireDervil
 */

const express = require('express');
const router = express.Router();
const { ServiceManager } = require('dunebot-core');

/**
 * POST /api/core/toasts/log
 * Loggt einen Toast-Event
 * 
 * Body:
 * - type: string (success|error|warning|info)
 * - message: string
 * - timestamp: ISO-String
 * - url: string (current page)
 * - guildId: string (optional)
 * - metadata: object (optional)
 */
router.post('/log', async (req, res) => {
    try {
        const logger = ServiceManager.get('Logger');
        const { type, message, timestamp, url, guildId, userAgent, metadata } = req.body;

        // Validierung
        if (!type || !message) {
            return res.status(400).json({ 
                success: false, 
                error: 'Type und Message sind erforderlich' 
            });
        }

        // Toast-Event Objekt
        const toastEvent = {
            type,
            message,
            timestamp: timestamp || new Date().toISOString(),
            url: url || 'unknown',
            guildId: guildId || null,
            userId: req.session?.user?.id || 'anonymous',
            username: req.session?.user?.username || 'Anonymous',
            userAgent: userAgent || req.headers['user-agent'] || 'unknown',
            sessionId: req.sessionID || 'no-session',
            metadata: metadata || {}
        };

        // Session-basierte Toast-History (In-Memory für schnellen Zugriff)
        if (!req.session.toastHistory) {
            req.session.toastHistory = [];
        }

        // Nur kritische Toasts in Session speichern (max 50 pro User)
        if (type === 'error' || type === 'warning') {
            req.session.toastHistory.unshift(toastEvent);
            if (req.session.toastHistory.length > 50) {
                req.session.toastHistory = req.session.toastHistory.slice(0, 50);
            }
        }

        // In Log-Datei schreiben (strukturiert für ELK-Stack etc.)
        const logLevel = type === 'error' ? 'error' : type === 'warning' ? 'warn' : 'info';
        logger[logLevel]({
            component: 'ToastLogger',
            event: 'client_toast',
            ...toastEvent
        }, `[Client Toast] ${type.toUpperCase()}: ${message}`);

        // Optional: In Datenbank speichern (für langfristige Analyse)
        // Nur für error/warning und wenn aktiviert
        if ((type === 'error' || type === 'warning') && process.env.TOAST_LOGGER_DB === 'true') {
            try {
                const dbService = ServiceManager.get('dbService');
                
                // Tabelle erstellen falls nicht vorhanden (idempotent)
                await dbService.query(`
                    CREATE TABLE IF NOT EXISTS toast_events (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        type VARCHAR(20) NOT NULL,
                        message TEXT NOT NULL,
                        user_id VARCHAR(100),
                        username VARCHAR(100),
                        guild_id VARCHAR(100),
                        url VARCHAR(500),
                        user_agent TEXT,
                        metadata JSON,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        INDEX idx_type (type),
                        INDEX idx_user (user_id),
                        INDEX idx_guild (guild_id),
                        INDEX idx_created (created_at)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
                `);

                // Toast-Event speichern
                await dbService.query(`
                    INSERT INTO toast_events 
                    (type, message, user_id, username, guild_id, url, user_agent, metadata)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `, [
                    toastEvent.type,
                    toastEvent.message,
                    toastEvent.userId,
                    toastEvent.username,
                    toastEvent.guildId,
                    toastEvent.url,
                    toastEvent.userAgent,
                    JSON.stringify(toastEvent.metadata)
                ]);

            } catch (dbError) {
                logger.error({ 
                    component: 'ToastLogger', 
                    error: dbError.message 
                }, 'Fehler beim Speichern in Datenbank');
                // Nicht kritisch - weiter fortfahren
            }
        }

        res.json({ 
            success: true, 
            logged: true,
            savedToSession: type === 'error' || type === 'warning',
            savedToDb: process.env.TOAST_LOGGER_DB === 'true'
        });

    } catch (error) {
        const logger = ServiceManager.get('Logger');
        logger.error({ 
            component: 'ToastLogger', 
            error: error.message,
            stack: error.stack 
        }, 'Fehler beim Loggen von Toast-Event');

        res.status(500).json({ 
            success: false, 
            error: 'Interner Serverfehler beim Loggen' 
        });
    }
});

/**
 * GET /api/core/toasts/history
 * Gibt Toast-History der aktuellen Session zurück
 */
router.get('/history', (req, res) => {
    try {
        const history = req.session?.toastHistory || [];
        
        res.json({
            success: true,
            count: history.length,
            toasts: history
        });

    } catch (error) {
        const logger = ServiceManager.get('Logger');
        logger.error({ 
            component: 'ToastLogger', 
            error: error.message 
        }, 'Fehler beim Abrufen der Toast-History');

        res.status(500).json({ 
            success: false, 
            error: 'Fehler beim Abrufen der History' 
        });
    }
});

module.exports = router;
