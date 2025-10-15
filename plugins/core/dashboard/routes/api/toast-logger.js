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
            userId: req.session?.user?.info?.id || 'anonymous', // FIXED: user.info.id
            username: req.session?.user?.info?.username || 'Anonymous', // FIXED: user.info.username
            userAgent: userAgent || req.headers['user-agent'] || 'unknown',
            sessionId: req.sessionID || 'no-session',
            metadata: metadata || {}
        };

        // Zentrale DB-Logging (ersetzt Session-basierte Speicherung)
        // Alle Toasts werden in guild_toast_logs gespeichert, auch anonyme
        try {
            const dbService = ServiceManager.get('dbService');
            
            // Toast-Event in zentrale DB-Tabelle speichern
            await dbService.query(`
                INSERT INTO guild_toast_logs 
                (type, message, user_id, username, guild_id, url, user_agent, session_id, source, metadata)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                toastEvent.type,
                toastEvent.message,
                toastEvent.userId,
                toastEvent.username,
                toastEvent.guildId,
                toastEvent.url,
                toastEvent.userAgent,
                toastEvent.sessionId,
                toastEvent.metadata?.source || 'guild.js',
                JSON.stringify(toastEvent.metadata)
            ]);

            // Zentrales Logging (strukturiert für PM2/ELK-Stack)
            const logLevel = type === 'error' ? 'error' : type === 'warning' ? 'warn' : 'info';
            logger[logLevel]({
                component: 'ToastLogger',
                event: 'client_toast',
                guildId: toastEvent.guildId,
                userId: toastEvent.userId,
                type: toastEvent.type,
                url: toastEvent.url,
                source: toastEvent.metadata?.source || 'guild.js'
            }, `[Toast] ${type.toUpperCase()}: ${message} (User: ${toastEvent.username}, Guild: ${toastEvent.guildId})`);

        } catch (dbError) {
            logger.error({ 
                component: 'ToastLogger', 
                error: dbError.message,
                guildId: toastEvent.guildId,
                userId: toastEvent.userId
            }, 'Fehler beim Speichern von Toast in guild_toast_logs');
            // Nicht kritisch - weiter fortfahren
        }

        res.json({ 
            success: true, 
            logged: true,
            savedToDb: true,
            method: 'guild_toast_logs'
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
 * Gibt Toast-History aus DB zurück (User-spezifisch + Guild-Context)
 */
router.get('/history', async (req, res) => {
    try {
        const logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');
        const userId = req.session?.user?.info?.id; // FIXED: user.info.id statt user.id
        const guildId = req.query.guildId || req.session?.currentGuildId;

        // Debug-Logging für Troubleshooting
        logger.debug('[ToastLogger] History Request:', {
            userId: userId || 'NOT_SET',
            sessionExists: !!req.session,
            userExists: !!req.session?.user,
            userInfoExists: !!req.session?.user?.info,
            guildId: guildId || 'NOT_SET',
            cookies: req.headers.cookie ? 'PRESENT' : 'MISSING'
        });

        if (!userId) {
            logger.warn('[ToastLogger] Unauthenticated history request', {
                sessionId: req.sessionID || 'NO_SESSION',
                userAgent: req.headers['user-agent'],
                ip: req.ip,
                sessionUser: req.session?.user ? 'PRESENT_BUT_NO_INFO' : 'MISSING'
            });
            
            // Fallback: Leere Liste statt 401 für bessere UX
            return res.json({ 
                success: true,
                count: 0,
                total: 0,
                toasts: [],
                message: 'Nicht authentifiziert - keine Toast-History verfügbar',
                debug: {
                    hasSession: !!req.session,
                    hasUser: !!req.session?.user,
                    hasUserInfo: !!req.session?.user?.info,
                    sessionId: req.sessionID || null
                }
            });
        }

        // Query-Parameter für Filterung
        const limit = Math.min(parseInt(req.query.limit) || 50, 100); // Max 100
        const offset = parseInt(req.query.offset) || 0;
        const type = req.query.type; // 'error', 'warning', etc.

        // SQL-Query bauen
        let whereClauses = [];
        let params = [];

        // User-Filter: Nur eigene Toasts oder Session-basierte Toasts
        if (userId) {
            whereClauses.push('(user_id = ? OR session_id = ?)');
            params.push(userId, req.sessionID || 'no-session');
        } else {
            // Fallback: Session-basierte Toasts für anonyme User
            whereClauses.push('session_id = ?');
            params.push(req.sessionID || 'no-session');
        }

        if (guildId) {
            whereClauses.push('guild_id = ?');
            params.push(guildId);
        }

        if (type && ['error', 'warning', 'info', 'success'].includes(type)) {
            whereClauses.push('type = ?');
            params.push(type);
        }

        // Nur kritische Toasts für Top-Nav (error/warning)
        if (req.query.criticalOnly === 'true') {
            whereClauses.push("type IN ('error', 'warning')");
        }

        const whereClause = whereClauses.join(' AND ');
        params.push(limit, offset);

        // Toast-History aus DB laden
        const toasts = await dbService.query(`
            SELECT 
                id,
                type,
                message,
                guild_id,
                url,
                source,
                metadata,
                created_at as timestamp
            FROM guild_toast_logs 
            WHERE ${whereClause}
            ORDER BY created_at DESC 
            LIMIT ? OFFSET ?
        `, params);

        // Anzahl für Pagination
        const countResult = await dbService.query(`
            SELECT COUNT(*) as total 
            FROM guild_toast_logs 
            WHERE ${whereClause}
        `, params.slice(0, -2)); // Ohne LIMIT/OFFSET

        res.json({
            success: true,
            count: toasts.length,
            total: countResult[0]?.total || 0,
            toasts: toasts,
            pagination: {
                limit,
                offset,
                hasMore: (offset + toasts.length) < (countResult[0]?.total || 0)
            }
        });

    } catch (error) {
        const logger = ServiceManager.get('Logger');
        logger.error({ 
            component: 'ToastLogger', 
            error: error.message,
            userId: req.session?.user?.id
        }, 'Fehler beim Abrufen der Toast-History aus DB');

        res.status(500).json({ 
            success: false, 
            error: 'Fehler beim Abrufen der History' 
        });
    }
});

module.exports = router;
