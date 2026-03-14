/**
 * Console Routes - REST-API für Live-Console
 * 
 * Endpoints:
 * - POST /console/:serverId/attach - Subscribe zu Console-Output
 * - POST /console/:serverId/send - Command senden
 * - POST /console/:serverId/detach - Unsubscribe
 * 
 * @author FireBot Team
 */

const express = require('express');
const router = express.Router({ mergeParams: true });
const ServiceManager = require('dunebot-core').ServiceManager;
const { requirePermission } = require('../../../../apps/dashboard/middlewares/permissions.middleware');
const { validateCommand, rateLimiter } = require('../helpers/CommandFilter');

// ========================================
// WebSocket-Support für Router aktivieren
// ========================================
try {
    const expressWs = require('express-ws');
    // express-ws auf Router anwenden (ermöglicht router.ws())
    expressWs(router);
    ServiceManager.get('Logger').debug('[Console Routes] express-ws aktiviert - WebSocket-Support verfügbar');
} catch (error) {
    ServiceManager.get('Logger').warn('[Console Routes] express-ws nicht verfügbar:', error.message);
}

/**
 * POST /console/:serverId/attach
 * Subscribe zu Console-Output (startet Streaming)
 * 
 * Permission: GAMESERVER.CONSOLE.VIEW
 */
router.post('/:serverId/attach', 
    requirePermission('GAMESERVER.CONSOLE.VIEW'),
    async (req, res) => {
        const { serverId } = req.params;
        const { guildId } = res.locals;
        const Logger = ServiceManager.get('Logger');
        
        // Discord-User für Tracking
        const discordUserId = req.session?.user?.info?.id || res.locals.user?.info?.id || 'unknown';
        
        // Eindeutige Client-ID generieren (Discord-User für Tracking)
        const clientId = `${discordUserId}-${Date.now()}`;
        
        // System-User für Console-Zugriff (für späteren RCON/File-Zugriff)
        const systemUser = `gs-guild_${guildId}`;
        
        try {
            const consoleManager = ServiceManager.get('consoleManager');
            
            // Attach zu Server-Console
            const history = await consoleManager.attach(
                guildId,
                serverId,
                clientId,
                systemUser  // System-User für Console-Zugriff
            );
            
            Logger.info(`[Console API] Attach erfolgreich: Server ${serverId}, Client ${clientId}`);
            
            res.json({
                success: true,
                client_id: clientId,
                history: history,
                line_count: history.length
            });
            
        } catch (error) {
            Logger.error(`[Console API] Attach fehlgeschlagen:`, error);
            
            res.status(500).json({
                success: false,
                message: error.message || 'Fehler beim Verbinden zur Console'
            });
        }
    }
);

/**
 * POST /console/:serverId/send
 * Command an Server senden (via RCON)
 * 
 * Permission: GAMESERVER.CONSOLE.EXECUTE
 * Body: { command: string }
 */
router.post('/:serverId/send',
    requirePermission('GAMESERVER.CONSOLE.EXECUTE'),
    async (req, res) => {
        const { serverId } = req.params;
        const { command } = req.body;
        const { guildId } = res.locals;
        const Logger = ServiceManager.get('Logger');
        
        // Discord-User für Rate-Limiting & Audit
        const userId = req.session?.user?.info?.id || res.locals.user?.info?.id || 'unknown';
        
        if (!command) {
            return res.status(400).json({
                success: false,
                message: 'Command fehlt im Request-Body'
            });
        }
        
        try {
            // ✅ STEP 1: Rate-Limit prüfen
            const rateLimitCheck = rateLimiter.check(userId);
            if (!rateLimitCheck.allowed) {
                Logger.warn(`[Console API] Rate-Limit erreicht: User ${userId}`, {
                    serverId,
                    guildId
                });
                
                return res.status(429).json({
                    success: false,
                    message: rateLimitCheck.error
                });
            }
            
            // ✅ STEP 2: Command-Validierung (Blacklist + Pattern-Check)
            const validation = validateCommand(command, {
                userId,
                serverId,
                guildId
            });
            
            if (!validation.valid) {
                Logger.warn(`[Console API] Command blockiert: ${command}`, {
                    userId,
                    serverId,
                    guildId,
                    reason: validation.error
                });
                
                return res.status(400).json({
                    success: false,
                    message: validation.error
                });
            }
            
            // ✅ STEP 3: Command an Daemon senden (via IPM)
            const consoleManager = ServiceManager.get('consoleManager');
            
            await consoleManager.sendCommand(
                guildId,
                serverId,
                validation.sanitized, // Sanitized Command verwenden
                userId
            );
            
            Logger.info(`[Console API] Command gesendet: Server ${serverId}, Cmd: ${validation.sanitized.substring(0, 50)}`, {
                userId,
                remaining: rateLimitCheck.remaining
            });
            
            res.json({
                success: true,
                message: 'Command erfolgreich gesendet',
                remaining: rateLimitCheck.remaining
            });
            
        } catch (error) {
            Logger.error(`[Console API] Command fehlgeschlagen:`, error);
            
            res.status(500).json({
                success: false,
                message: error.message || 'Fehler beim Senden des Commands'
            });
        }
    }
);

/**
 * POST /console/:serverId/detach
 * Unsubscribe von Console-Output
 * 
 * Body: { client_id: string }
 */
router.post('/:serverId/detach', async (req, res) => {
    const { serverId } = req.params;
    const { client_id } = req.body;
    const { guildId } = res.locals;
    const Logger = ServiceManager.get('Logger');
    
    if (!client_id) {
        return res.status(400).json({
            success: false,
            message: 'client_id fehlt im Request-Body'
        });
    }
    
    try {
        const consoleManager = ServiceManager.get('consoleManager');
        
        // Detach von Server-Console
        await consoleManager.detach(guildId, serverId, client_id);
        
        Logger.info(`[Console API] Detach erfolgreich: Server ${serverId}, Client ${client_id}`);
        
        res.json({
            success: true,
            message: 'Erfolgreich getrennt'
        });
        
    } catch (error) {
        Logger.error(`[Console API] Detach fehlgeschlagen:`, error);
        
        // Detach-Fehler sind meist unkritisch (Server könnte gelöscht sein)
        // → Trotzdem success:true zurück
        res.json({
            success: true,
            message: 'Getrennt (mit Warnung)'
        });
    }
});

/**
 * GET /console/:serverId/stream
 * SSE-Stream für Console-Output (Tab-basiertes Auto-Connect/Disconnect)
 * 
 * Query: client_id (von attach-Request)
 * Permission: GAMESERVER.CONSOLE.VIEW
 */
router.get('/:serverId/stream',
    requirePermission('GAMESERVER.CONSOLE.VIEW'),
    async (req, res) => {
        const { serverId } = req.params;
        const { client_id } = req.query;
        const { guildId } = res.locals;
        const Logger = ServiceManager.get('Logger');
        
        if (!client_id) {
            return res.status(400).json({
                success: false,
                message: 'client_id Query-Parameter fehlt'
            });
        }
        
        Logger.info(`[Console SSE] Stream started: Server ${serverId}, Client ${client_id}`);
        
        // SSE-Headers setzen
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no'); // Nginx-Buffering aus
        
        // Initial-Event (Connection erfolgreich)
        res.write('event: connected\n');
        res.write(`data: ${JSON.stringify({ client_id, timestamp: Date.now() })}\n\n`);
        
        // SSE-Manager registrieren (für console:output Events vom Daemon)
        const sseManager = ServiceManager.get('sseManager');
        if (sseManager) {
            // Filter: Nur Events für diesen Server
            const filter = (msg) => {
                return msg.namespace === 'console' && 
                       msg.data.server_id === serverId;
            };
            
            sseManager.addClient(guildId, client_id, res, filter);
        } else {
            Logger.warn('[Console SSE] SSEManager nicht verfügbar - Events werden nicht empfangen!');
        }
        
        // Heartbeat (alle 30s)
        const heartbeat = setInterval(() => {
            res.write(': heartbeat\n\n');
        }, 30000);
        
        // Cleanup bei Connection-Close
        req.on('close', () => {
            clearInterval(heartbeat);
            
            if (sseManager) {
                // Client aus SSE-Manager entfernen (wird automatisch bei close gemacht)
                Logger.info(`[Console SSE] Client ${client_id} disconnected`);
            }
            
            // Detach von Console (IPM-Command an Daemon)
            const consoleManager = ServiceManager.get('consoleManager');
            if (consoleManager) {
                consoleManager.detach(guildId, serverId, client_id)
                    .catch(err => Logger.error(`[Console SSE] Auto-Detach fehlgeschlagen:`, err));
            }
        });
    }
);

module.exports = router;

// ════════════════════════════════════════════════════════════════════════════
// ⚠️  DEPRECATED: WebSocket-Routes
// ════════════════════════════════════════════════════════════════════════════
//
// Die folgenden WebSocket-Routes sind DEPRECATED und werden entfernt!
//
// ❌ GRUND: Redundant zu SSE!
//   - SSE funktioniert bereits für Console-Output
//   - Effizienter (HTTP/1.1, keine Upgrade-Komplexität)
//   - Einfacher für Browser (EventSource API)
//   - Apache Proxy einfacher (RewriteRules für WS komplex)
//
// ✅ NEUE ARCHITEKTUR:
//   - Console Output: SSE (gameserver:console Event)
//   - Commands: POST /send → RCON
//   - Status-Updates: SSE (gameserver:status_changed)
//
// TODO: Entfernen nach Migration auf PTY-Console!
// ════════════════════════════════════════════════════════════════════════════

/**
 * WebSocket: /console/ws/:serverId
 * Live-Streaming der Console per WebSocket (direkter als SSE)
 *
 * Hinweis: express-ws ist global in app.js initialisiert.
 */
try {
    // eslint-disable-next-line no-unused-vars
    const wsRoute = router.ws;
    if (typeof router.ws === 'function') {
        /**
         * Gemeinsamer Handler für WS-Endpunkte
         */
        const handleWS = async (ws, req) => {
            // serverId kann in beiden Routen-Varianten extrahiert werden
            const serverId = req.params.serverId || (req.params[0] /* fallback for wildcard */);
            const guildId = (req.baseUrl && req.baseUrl.split('/')[2]) || (req.params && req.params.guildId);
            const Logger = ServiceManager.get('Logger');

            try {
                const consoleManager = ServiceManager.get('consoleManager');
                if (!consoleManager) {
                    ws.send(JSON.stringify({ type: 'error', message: 'ConsoleManager not available' }));
                    return ws.close();
                }

                // Minimaler Permission-Check (Session vorhanden?)
                // Hinweis: Bei einigen Proxies können Cookies im Upgrade entfallen.
                // Für reinen Output-Stream lassen wir die Verbindung bestehen und beschränken nur Commands.
                const hasSession = !!(req.session && req.session.user);
                if (!hasSession) {
                    const warnMsg = 'unauthorized (read-only)';
                    Logger.warn(`[Console WS] ${warnMsg} – lasse Verbindung bestehen (nur Output)`);
                    ws.send(JSON.stringify({ type: 'warning', message: warnMsg }));
                }

                // Client registrieren
                consoleManager.addWSClient(String(serverId), ws);

                // Optional: Letzte History senden (schneller Eindruck)
                const history = consoleManager.consoleHistory.get(String(serverId)) || [];
                if (history.length) {
                    ws.send(JSON.stringify({ type: 'history', server_id: String(serverId), lines: history }));
                }

                Logger.info(`[Console WS] Client verbunden (Guild: ${guildId}, Server: ${serverId})`);

                // Eingehende Messages (optional: Commands)
                ws.on('message', async (raw) => {
                    try {
                        const msg = JSON.parse(raw.toString());
                        if (msg.type === 'command' && typeof msg.command === 'string' && msg.command.trim()) {
                            try {
                                if (!hasSession) throw new Error('unauthorized');
                                const userId = req.session?.user?.info?.id || 'ws-user';
                                await consoleManager.sendCommand(String(guildId), String(serverId), msg.command, userId);
                            } catch (e) {
                                ws.send(JSON.stringify({ type: 'error', message: e.message || 'command failed' }));
                            }
                        }
                    } catch (_) {}
                });

                ws.on('close', () => {
                    Logger.info(`[Console WS] Client getrennt (Server: ${serverId})`);
                });
            } catch (err) {
                const Logger = ServiceManager.get('Logger');
                Logger.error('[Console WS] Fehler beim Handshake:', err);
                try { ws.close(); } catch (_) {}
            }
        };

        // 1) Normale WS-Route
        router.ws('/ws/:serverId', handleWS);

        // 2) Einige Proxies/Stacks hängen ".websocket" an – optional mit abgedeckt
        router.ws('/ws/:serverId/.websocket', handleWS);

        // 3) Safety: wildcard-Suffix (z. B. trailing slash)
        router.ws('/ws/:serverId/*', handleWS);
    }
} catch (e) {
    // express-ws nicht aktiv – ignorieren
}
