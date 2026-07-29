/**
 * Gameserver Migration Manager
 * 
 * Verwaltet Server-Umzüge zwischen verschiedenen RootServern
 * 
 * Flow:
 * 1. Validierung (Server-Status, Ziel-RootServer, Speicherplatz, Ports)
 * 2. Server stoppen (falls läuft)
 * 3. Backup auf Quell-Daemon erstellen
 * 4. Transfer via Dashboard (Proxy)
 * 5. Restore auf Ziel-Daemon
 * 6. DB aktualisieren (rootserver_id, Ports)
 * 7. Cleanup (temporäre Dateien löschen)
 * 
 * @author FireDervil & GitHub Copilot
 * @date 2026-05-21
 */

'use strict';

const { ServiceManager } = require('dunebot-core');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');

class MigrationManager {
    constructor() {
        this.Logger = ServiceManager.get('Logger');
        this.dbService = ServiceManager.get('dbService');
        this.ipmServer = ServiceManager.get('ipmServer');
        this.sseManager = ServiceManager.get('sseManager');
        
        // Temporäres Verzeichnis für Migrations-Backups auf Dashboard
        this.tempDir = '/tmp/gameserver-migrations';

        // Aktive HTTP-Streaming-Transfers: migrationId → { token, filePath, expiresAt }
        // Token-Auth für die /api/migration/:id/stream Endpunkte (api.router.js)
        this.activeTransfers = new Map();
    }

    /**
     * Wartet, bis der Server wirklich gestoppt ist (DB-Status wird vom Daemon
     * per status_changed-Event gepflegt) und lässt danach kurz "nachlaufen",
     * damit das Spiel seine Savegames fertig schreiben kann.
     * Blockiert die Migration nie dauerhaft: Nach dem Timeout wird mit Warnung
     * fortgefahren (der Daemon hat den Stop ja bereits quittiert).
     * @private
     */
    async _waitForServerStopped(serverId, guildId, migrationId) {
        const STOPPED_STATES = ['offline', 'stopped', 'error'];
        const TIMEOUT_MS = 90000;
        const INTERVAL_MS = 2000;
        const SETTLE_MS = 5000; // Nachlauf für Savegame-Flush
        const startedAt = Date.now();

        while (Date.now() - startedAt < TIMEOUT_MS) {
            try {
                const rows = await this.dbService.query('SELECT status FROM gameservers WHERE id = ?', [serverId]);
                const status = rows?.[0]?.status;

                if (status && STOPPED_STATES.includes(status)) {
                    this.Logger.info(`[MigrationManager] Server ${serverId} ist gestoppt (Status: ${status}) — warte ${SETTLE_MS / 1000}s auf Savegame-Flush`);
                    this._sendSSE(guildId, serverId, {
                        type: 'migration_progress', migrationId, step: 'stopping', progress: 10,
                        detail: 'Server gestoppt — warte auf Savegame-Flush...'
                    });
                    await new Promise(r => setTimeout(r, SETTLE_MS));
                    return;
                }
            } catch (err) {
                this.Logger.warn('[MigrationManager] Status-Poll fehlgeschlagen:', err?.message || err);
            }

            const elapsed = Math.round((Date.now() - startedAt) / 1000);
            this._sendSSE(guildId, serverId, {
                type: 'migration_progress', migrationId, step: 'stopping', progress: 8,
                detail: `Warte auf vollständigen Stop... (${elapsed}s)`
            });

            await new Promise(r => setTimeout(r, INTERVAL_MS));
        }

        this.Logger.warn(`[MigrationManager] Timeout beim Warten auf Stop von Server ${serverId} — fahre trotzdem fort (Daemon hat Stop quittiert)`);
        await new Promise(r => setTimeout(r, SETTLE_MS));
    }

    /**
     * Startet einen "Lebenszeichen"-Ticker für lange Schritte (Backup, Transfer,
     * Restore). Ohne ihn steht die Anzeige minutenlang still und wirkt eingefroren.
     * @returns {Function} stop-Funktion
     * @private
     */
    _startStepTicker(guildId, serverId, migrationId, step, progress, label) {
        const startedAt = Date.now();

        const tick = () => {
            const elapsed = Math.round((Date.now() - startedAt) / 1000);
            const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
            const ss = String(elapsed % 60).padStart(2, '0');
            this._sendSSE(guildId, serverId, {
                type: 'migration_progress',
                migrationId,
                step,
                progress,
                elapsed_seconds: elapsed,
                detail: `${label} (${mm}:${ss})`
            });
        };

        const timer = setInterval(tick, 5000);
        return () => clearInterval(timer);
    }

    /**
     * Meldet Transfer-Fortschritt (wird vom Streaming-Endpunkt aufgerufen).
     * Rechnet die übertragenen Bytes in echten Prozentfortschritt um.
     */
    reportTransferProgress(migrationId, bytesTransferred, direction = 'upload') {
        const transfer = this.activeTransfers.get(String(migrationId));
        if (!transfer || !transfer.guildId) return;

        const total = transfer.expectedBytes || 0;
        const mb = (bytesTransferred / 1024 / 1024).toFixed(0);
        const totalMb = total ? (total / 1024 / 1024).toFixed(0) : null;

        // Transfer belegt den Bereich 40–70 % der Gesamt-Migration
        const ratio = total > 0 ? Math.min(bytesTransferred / total, 1) : 0;
        const progress = 40 + Math.round(ratio * 30);

        this._sendSSE(transfer.guildId, transfer.serverId, {
            type: 'migration_progress',
            migrationId,
            step: 'transferring',
            progress,
            detail: totalMb
                ? `${direction === 'upload' ? 'Upload' : 'Download'}: ${mb} / ${totalMb} MB (${Math.round(ratio * 100)}%)`
                : `${direction === 'upload' ? 'Upload' : 'Download'}: ${mb} MB`
        });
    }

    /**
     * Räumt Migrationen auf, die durch einen Dashboard-Neustart verwaist sind.
     * Eine laufende Migration lebt nur im Speicher (Promise-Kette + Transfer-Token);
     * nach einem Restart kann sie nicht fortgesetzt werden, würde aber ewig als
     * "läuft" in der DB stehen und den Server auf 'updating' festhalten.
     * Wird beim Plugin-Start aufgerufen.
     */
    async cleanupOrphanedMigrations() {
        const RUNNING = ['pending', 'stopping_server', 'backing_up', 'transferring', 'restoring', 'updating_db'];

        try {
            const orphaned = await this.dbService.query(
                `SELECT id, server_id FROM gameserver_migrations WHERE status IN (${RUNNING.map(() => '?').join(',')})`,
                RUNNING
            );

            if (!Array.isArray(orphaned) || orphaned.length === 0) return;

            this.Logger.warn(`[MigrationManager] ${orphaned.length} verwaiste Migration(en) nach Neustart gefunden — markiere als fehlgeschlagen`);

            await this.dbService.query(
                `UPDATE gameserver_migrations
                 SET status = 'failed', error_message = 'Abgebrochen: Dashboard wurde während der Migration neu gestartet'
                 WHERE status IN (${RUNNING.map(() => '?').join(',')})`,
                RUNNING
            );

            // Server, die dadurch auf 'updating' festhängen, auf 'error' setzen
            for (const row of orphaned) {
                await this.dbService.query(
                    "UPDATE gameservers SET status = 'error' WHERE id = ? AND status = 'updating'",
                    [row.server_id]
                );
            }
        } catch (err) {
            this.Logger.error('[MigrationManager] cleanupOrphanedMigrations fehlgeschlagen:', err?.message || err);
        }
    }

    /**
     * Erzeugt einen Einmal-Token für den HTTP-Streaming-Transfer einer Migration
     * @private
     */
    _createTransfer(migrationId, filePath, context = {}) {
        const token = crypto.randomBytes(32).toString('hex');
        this.activeTransfers.set(String(migrationId), {
            token,
            filePath,
            // Kontext für Fortschritts-Events aus dem Streaming-Endpunkt
            guildId: context.guildId || null,
            serverId: context.serverId || null,
            expectedBytes: context.expectedBytes || 0,
            expiresAt: Date.now() + 2 * 60 * 60 * 1000 // 2 Stunden
        });
        return token;
    }

    /**
     * Validiert einen Transfer-Token (aufgerufen von den Streaming-Endpunkten)
     * @returns {{token: string, filePath: string}|null}
     */
    validateTransfer(migrationId, token) {
        const transfer = this.activeTransfers.get(String(migrationId));
        if (!transfer) return null;
        if (transfer.expiresAt < Date.now()) {
            this.activeTransfers.delete(String(migrationId));
            return null;
        }
        if (!token || transfer.token !== token) return null;
        return transfer;
    }

    /**
     * Beendet einen Transfer (Token invalidieren)
     * @private
     */
    _endTransfer(migrationId) {
        this.activeTransfers.delete(String(migrationId));
    }

    /**
     * Server-Migration initiieren
     * @param {number} serverId - Gameserver ID
     * @param {number} targetRootServerId - Ziel-RootServer ID
     * @param {string} userId - Discord User ID (Initiator)
     * @param {string} guildId - Guild ID
     * @returns {Promise<{success: boolean, migrationId?: number, error?: string}>}
     */
    async startMigration(serverId, targetRootServerId, userId, guildId) {
        this.Logger.info(`[MigrationManager] Starting migration for Server ${serverId} to RootServer ${targetRootServerId}`);

        let previousStatus = null; // Für Rollback, falls nach dem Status-Update etwas schiefgeht

        try {
            // Phase 1: Validierung
            const validation = await this._validate(serverId, targetRootServerId, guildId);
            if (!validation.success) {
                return { success: false, error: validation.error };
            }

            const { server, sourceRootServer, targetRootServer } = validation.data;

            // Migration-Eintrag in DB erstellen
            const result = await this.dbService.query(
                `INSERT INTO gameserver_migrations 
                (server_id, source_rootserver_id, target_rootserver_id, initiated_by, status, current_step, old_ports)
                VALUES (?, ?, ?, ?, 'pending', 'Initialisierung...', ?)`,
                [serverId, server.rootserver_id, targetRootServerId, userId, JSON.stringify(server.ports)]
            );

            const migrationId = result.insertId;

            this.Logger.info(`[MigrationManager] Migration ${migrationId} created`);

            // Server-Status auf 'updating' setzen (wird bei Migration verwendet)
            previousStatus = server.status;
            await this.dbService.query(
                'UPDATE gameservers SET status = ? WHERE id = ?',
                ['updating', serverId]
            );

            // SSE-Event für UI-Update
            this._sendSSE(guildId, serverId, {
                type: 'migration_started',
                migrationId,
                serverId,
                serverName: server.name
            });

            // Migration asynchron ausführen (nicht blockierend)
            this._executeMigration(migrationId, server, sourceRootServer, targetRootServer, guildId)
                .catch(err => {
                    this.Logger.error(`[MigrationManager] Migration ${migrationId} failed:`, err);
                    this._updateMigrationStatus(migrationId, 'failed', 0, err.message);
                });

            return { success: true, migrationId };

        } catch (error) {
            this.Logger.error('[MigrationManager] startMigration error:', error);

            // Falls der Status bereits auf 'updating' gesetzt wurde: zurückrollen,
            // damit der Server nicht dauerhaft in 'updating' hängen bleibt
            if (previousStatus !== null) {
                try {
                    await this.dbService.query(
                        'UPDATE gameservers SET status = ? WHERE id = ?',
                        [previousStatus, serverId]
                    );
                    this.Logger.info(`[MigrationManager] Server ${serverId} Status zurückgesetzt auf '${previousStatus}'`);
                } catch (rollbackErr) {
                    this.Logger.error('[MigrationManager] Status-Rollback fehlgeschlagen:', rollbackErr);
                }
            }

            return { success: false, error: error.message };
        }
    }

    /**
     * Validiert Migration-Voraussetzungen
     * @private
     */
    async _validate(serverId, targetRootServerId, guildId) {
        // Server laden
        const [server] = await this.dbService.query(
            `SELECT gs.*, r.daemon_id as source_daemon_id, r.name as source_rootserver_name
             FROM gameservers gs
             LEFT JOIN rootserver r ON gs.rootserver_id = r.id
             WHERE gs.id = ? AND gs.guild_id = ?`,
            [serverId, guildId]
        );

        if (!server) {
            return { success: false, error: 'Server nicht gefunden' };
        }

        // Server-Status prüfen
        if (['installing', 'migrating'].includes(server.status)) {
            return { success: false, error: `Server kann nicht migriert werden (Status: ${server.status})` };
        }

        // Quell-RootServer vorhanden?
        if (!server.rootserver_id) {
            return { success: false, error: 'Server hat keinen zugewiesenen RootServer' };
        }

        // Nicht zum gleichen Server verschieben
        if (server.rootserver_id === targetRootServerId) {
            return { success: false, error: 'Ziel-RootServer ist identisch mit aktuellem RootServer' };
        }

        // Ziel-RootServer laden
        const [targetRootServer] = await this.dbService.query(
            'SELECT * FROM rootserver WHERE id = ? AND guild_id = ?',
            [targetRootServerId, guildId]
        );

        if (!targetRootServer) {
            return { success: false, error: 'Ziel-RootServer nicht gefunden' };
        }

        // Ziel-Daemon online?
        if (!this.ipmServer.isDaemonOnline(targetRootServer.daemon_id)) {
            return { success: false, error: `Ziel-RootServer ist offline (Daemon: ${targetRootServer.daemon_id})` };
        }

        // Quell-Daemon online?
        if (!this.ipmServer.isDaemonOnline(server.source_daemon_id)) {
            return { success: false, error: `Quell-RootServer ist offline (Daemon: ${server.source_daemon_id})` };
        }

        // Quell-RootServer-Daten laden (für späteren Zugriff)
        const [sourceRootServer] = await this.dbService.query(
            'SELECT * FROM rootserver WHERE id = ?',
            [server.rootserver_id]
        );

        return {
            success: true,
            data: {
                server,
                sourceRootServer,
                targetRootServer
            }
        };
    }

    /**
     * Führt Migration aus (asynchron)
     * @private
     */
    async _executeMigration(migrationId, server, sourceRootServer, targetRootServer, guildId) {
        // Außerhalb des try deklariert, damit der catch-Block das Backup aufräumen kann
        let backupPath = null;

        try {
            // Schritt 0: Cronjobs anhalten.
            // Sonst fährt mitten in den Umzug ein geplantes Backup oder ein Neustart
            // hinein – und zwar auf dem Quell-Rootserver, dessen Daten gerade
            // weggeschoben werden.
            try {
                const cronWorker = ServiceManager.get('gameserverCronWorker');
                const paused = cronWorker?.pauseServer(server.id) ?? 0;
                if (paused > 0) {
                    this.Logger.info(`[MigrationManager] ${paused} Cronjob(s) für Server ${server.id} pausiert`);
                }
            } catch (cronErr) {
                this.Logger.warn(`[MigrationManager] Cronjobs konnten nicht pausiert werden: ${cronErr.message}`);
            }

            // Schritt 1: Server stoppen — IMMER versuchen, unabhängig vom DB-Status.
            // Der DB-Status kann von der Realität abweichen (z. B. 'error' nach einer
            // fehlgeschlagenen Migration, während der Container real weiterläuft).
            // Ein Backup eines laufenden Servers wäre inkonsistent — deshalb wird der
            // Stop immer gesendet und "läuft nicht" vom Daemon als OK gewertet.
            await this._updateMigrationStatus(migrationId, 'stopping_server', 5, 'Server wird gestoppt...');
            this._sendSSE(guildId, server.id, { type: 'migration_progress', migrationId, step: 'stopping', progress: 5 });

            // War der Server überhaupt gestartet? server.status ist der Status VOR der
            // Migration (startMigration setzt die DB danach auf 'updating').
            // Wichtig: Bei einem bereits gestoppten Server sendet der Daemon kein
            // status_changed-Event mehr — ein Warten auf 'offline' liefe zwangsläufig
            // in den Timeout. Deshalb wird nur gewartet, wenn wirklich gestoppt wurde.
            const RUNNING_STATES = ['online', 'starting', 'stopping'];
            let stoppedByUs = RUNNING_STATES.includes(server.status);

            const notRunningPattern = /not running|läuft nicht|nicht gestartet|already stopped|kein container/i;
            try {
                const stopResult = await this.ipmServer.sendCommand(
                    sourceRootServer.daemon_id,
                    'gameserver.stop',
                    { server_id: String(server.id), daemon_id: sourceRootServer.daemon_id },
                    30000
                );

                if (stopResult?.success) {
                    // Der Daemon hat tatsächlich etwas gestoppt — auch wenn der
                    // DB-Status 'offline' behauptete (veralteter Status). In dem Fall
                    // MUSS gewartet werden, sonst läuft tar in einen inkonsistenten Stand.
                    stoppedByUs = true;
                } else {
                    const msg = String(stopResult?.message || stopResult?.error || 'Unbekannt');
                    if (notRunningPattern.test(msg)) {
                        this.Logger.info(`[MigrationManager] Server ${server.id} war bereits gestoppt (${msg})`);
                        stoppedByUs = false;
                    } else {
                        throw new Error(`Server-Stop fehlgeschlagen: ${msg}`);
                    }
                }
            } catch (err) {
                const msg = String(err?.message || err);
                if (notRunningPattern.test(msg)) {
                    this.Logger.info(`[MigrationManager] Server ${server.id} war bereits gestoppt (${msg})`);
                    stoppedByUs = false;
                } else {
                    throw err;
                }
            }

            if (stoppedByUs) {
                // Warten bis der Server WIRKLICH gestoppt ist. Der Daemon quittiert
                // gameserver.stop, sobald das Stop-Signal abgesetzt ist — der Container
                // schreibt danach aber noch Savegames. Ein Backup zu diesem Zeitpunkt
                // wäre inkonsistent (und tar meldet "file changed as we read it").
                await this._waitForServerStopped(server.id, guildId, migrationId);
            } else {
                this.Logger.info(`[MigrationManager] Server ${server.id} war bereits gestoppt (Status vorher: ${server.status}) — kein Warten nötig`);
                this._sendSSE(guildId, server.id, {
                    type: 'migration_progress', migrationId, step: 'stopping', progress: 10,
                    detail: 'Server war bereits gestoppt'
                });
            }

            await this.dbService.query('UPDATE gameservers SET status = ? WHERE id = ?', ['offline', server.id]);

            // Schritt 2: Backup erstellen
            await this._updateMigrationStatus(migrationId, 'backing_up', 15, 'Backup wird erstellt...');
            this._sendSSE(guildId, server.id, { type: 'migration_progress', migrationId, step: 'backing_up', progress: 15 });

            backupPath = `/tmp/migration-${server.id}-${Date.now()}.tar.gz`;

            // Ticker: Ohne ihn steht die Anzeige während des (minutenlangen) tar still
            const stopBackupTicker = this._startStepTicker(
                guildId, server.id, migrationId, 'backing_up', 15, 'Backup wird erstellt'
            );

            let backupResult;
            try {
                backupResult = await this.ipmServer.sendCommand(
                    sourceRootServer.daemon_id,
                    'gameserver.migrate.backup',
                    {
                        server_id: String(server.id),
                        daemon_id: sourceRootServer.daemon_id,
                        backup_path: backupPath
                    },
                    900000 // 15 Minuten Timeout (tar.gz großer Server dauert; 3 min waren zu knapp)
                );
            } finally {
                stopBackupTicker();
            }

            if (!backupResult?.success) {
                throw new Error(`Backup fehlgeschlagen: ${backupResult?.message || backupResult?.error || 'Unbekannt'}`);
            }

            // WICHTIG: Der Daemon legt Zusatzfelder FLACH ins Response-Payload
            // (sendCommandResponseWithData spreadet `extra` direkt) — es gibt kein
            // `data`-Wrapper-Objekt. Defensive: beide Formen akzeptieren.
            const backupSize = backupResult.backup_size_bytes ?? backupResult.data?.backup_size_bytes ?? 0;
            const backupChecksum = backupResult.checksum ?? backupResult.data?.checksum ?? null;
            this.Logger.info(`[MigrationManager] Backup erstellt: ${(backupSize / 1024 / 1024).toFixed(1)} MB — Transfer via HTTP-Streaming`);

            // Backup-Infos in DB speichern
            await this.dbService.query(
                'UPDATE gameserver_migrations SET backup_path = ?, backup_size_bytes = ?, backup_checksum = ? WHERE id = ?',
                [backupPath, backupSize, backupChecksum, migrationId]
            );

            // Schritt 3: Transfer (Dashboard lädt herunter, dann hoch)
            await this._updateMigrationStatus(migrationId, 'transferring', 40, 'Daten werden übertragen...');
            this._sendSSE(guildId, server.id, { type: 'migration_progress', migrationId, step: 'transferring', progress: 40 });

            await this._transferBackup(server, sourceRootServer, targetRootServer, backupPath, migrationId, guildId, backupSize);

            // Schritt 4: Restore auf Ziel-Daemon
            await this._updateMigrationStatus(migrationId, 'restoring', 70, 'Server wird wiederhergestellt...');
            this._sendSSE(guildId, server.id, { type: 'migration_progress', migrationId, step: 'restoring', progress: 70 });

            const targetBackupPath = `/tmp/migration-${server.id}-incoming.tar.gz`;
            const targetInstallPath = server.install_path; // Bleibt gleich (relativ zur Guild)

            const stopRestoreTicker = this._startStepTicker(
                guildId, server.id, migrationId, 'restoring', 70, 'Server wird wiederhergestellt'
            );

            let restoreResult;
            try {
                restoreResult = await this.ipmServer.sendCommand(
                    targetRootServer.daemon_id,
                    'gameserver.migrate.restore',
                    {
                        server_id: String(server.id),
                        daemon_id: targetRootServer.daemon_id,
                        backup_path: targetBackupPath,
                        guild_id: guildId,
                        target_path: targetInstallPath
                    },
                    900000 // 15 Minuten (Entpacken großer Archive dauert)
                );
            } finally {
                stopRestoreTicker();
            }

            if (!restoreResult?.success) {
                throw new Error(`Restore fehlgeschlagen: ${restoreResult?.message || restoreResult?.error || 'Unbekannt'}`);
            }

            // Schritt 5: Port-Allocations prüfen und ggf. anpassen
            await this._updateMigrationStatus(migrationId, 'updating_db', 85, 'Datenbank wird aktualisiert...');
            this._sendSSE(guildId, server.id, { type: 'migration_progress', migrationId, step: 'updating_db', progress: 85 });

            const newPorts = await this._adjustPorts(server, targetRootServer);

            // Schritt 6: DB aktualisieren (transaktional)
            await this.dbService.transaction(async (tx) => {
                // Server rootserver_id + bind_ip updaten.
                // WICHTIG: bind_ip MUSS auf den Host des Ziel-RootServers zeigen —
                // sonst versucht der Ziel-Daemon, die Ports auf der IP des alten
                // Hosts zu binden und der Start scheitert mit
                // "cannot assign requested address".
                // (Bei der Server-Erstellung wird bind_ip genauso aus rootserver.host gesetzt.)
                await tx.query(
                    'UPDATE gameservers SET rootserver_id = ?, ports = ?, status = ?, bind_ip = ? WHERE id = ?',
                    [
                        targetRootServer.id,
                        JSON.stringify(newPorts),
                        'offline',
                        targetRootServer.host || null,
                        server.id
                    ]
                );

                // Port-Allocations updaten (falls Tabelle existiert)
                const [tables] = await tx.query("SHOW TABLES LIKE 'port_allocations'");
                if (tables.length > 0) {
                    await tx.query(
                        'UPDATE port_allocations SET rootserver_id = ? WHERE server_id = ?',
                        [targetRootServer.id, server.id]
                    );
                }

                // Migration als completed markieren
                await tx.query(
                    'UPDATE gameserver_migrations SET status = ?, progress_percent = ?, current_step = ?, new_ports = ?, completed_at = NOW() WHERE id = ?',
                    ['completed', 100, 'Migration abgeschlossen', JSON.stringify(newPorts), migrationId]
                );
            });

            // Schritt 7: Cronjobs am Ziel neu einplanen.
            // Muss NACH dem DB-Update laufen, damit die Jobs den neuen Rootserver
            // sehen – sonst schickt der Scheduler Backups und Neustarts weiter an
            // den alten Daemon.
            try {
                const cronWorker = ServiceManager.get('gameserverCronWorker');
                const rescheduled = await cronWorker?.rescheduleServer(server.id);
                if (rescheduled) {
                    this.Logger.info(`[MigrationManager] ${rescheduled} Cronjob(s) für Server ${server.id} auf ${targetRootServer.name} neu eingeplant`);
                }
            } catch (cronErr) {
                this.Logger.error(`[MigrationManager] Cronjobs konnten nicht neu eingeplant werden: ${cronErr.message}`);
            }

            // Schritt 8: Cleanup
            await this._cleanup(migrationId, sourceRootServer, targetRootServer, backupPath, targetBackupPath);

            this._sendSSE(guildId, server.id, { 
                type: 'migration_completed', 
                migrationId, 
                serverId: server.id, 
                serverName: server.name 
            });

            this.Logger.success(`[MigrationManager] Migration ${migrationId} completed successfully`);

        } catch (error) {
            this.Logger.error(`[MigrationManager] Migration ${migrationId} error:`, error);
            await this._updateMigrationStatus(migrationId, 'failed', 0, error.message);

            // Backup-Reste auf dem Quell-Daemon entfernen — sonst sammeln sich
            // bei mehreren Fehlversuchen mehrere GB pro Lauf in /tmp an
            if (backupPath) {
                try {
                    await this.ipmServer.sendCommand(
                        sourceRootServer.daemon_id,
                        'gameserver.migrate.cleanup',
                        { backup_path: backupPath },
                        30000
                    );
                } catch (cleanupErr) {
                    this.Logger.warn('[MigrationManager] Cleanup nach Fehler fehlgeschlagen:', cleanupErr?.message || cleanupErr);
                }
            }

            // Server-Status zurücksetzen
            await this.dbService.query('UPDATE gameservers SET status = ? WHERE id = ?', ['error', server.id]);

            // Cronjobs wieder aufnehmen – der Server bleibt beim Quell-Rootserver,
            // seine geplanten Aufgaben dürfen nicht dauerhaft stillstehen.
            try {
                const cronWorker = ServiceManager.get('gameserverCronWorker');
                await cronWorker?.rescheduleServer(server.id);
            } catch (cronErr) {
                this.Logger.warn(`[MigrationManager] Cronjobs nach Fehler nicht reaktiviert: ${cronErr.message}`);
            }

            this._sendSSE(guildId, server.id, { 
                type: 'migration_failed', 
                migrationId, 
                serverId: server.id, 
                error: error.message 
            });

            throw error;
        }
    }

    /**
     * Transferiert Backup vom Quell- zum Ziel-Daemon via Dashboard (HTTP-Streaming)
     *
     * Ablauf: Quell-Daemon streamt das Backup per HTTP PUT zum Dashboard
     * (/api/migration/:id/stream), der Ziel-Daemon lädt es per HTTP GET wieder
     * herunter. Kein Base64, kein WS-maxPayload-Limit — funktioniert auch für
     * Server mit 10+ GB. Auth über einen pro Migration generierten Einmal-Token.
     * @private
     */
    async _transferBackup(server, sourceRootServer, targetRootServer, backupPath, migrationId, guildId, expectedBytes = 0) {
        // Temp-Datei auf Dashboard
        const localTempPath = path.join(this.tempDir, `migration-${migrationId}.tar.gz`);

        // Temp-Verzeichnis erstellen
        await fs.mkdir(this.tempDir, { recursive: true });

        const streamPath = `/api/migration/${migrationId}/stream`;
        const token = this._createTransfer(migrationId, localTempPath, {
            guildId,
            serverId: server.id,
            expectedBytes
        });

        try {
            // Schritt A: Quell-Daemon → Dashboard (HTTP PUT, gestreamt)
            this.Logger.info(`[MigrationManager] Quell-Daemon streamt Backup zum Dashboard (${streamPath})...`);
            const uploadResult = await this.ipmServer.sendCommand(
                sourceRootServer.daemon_id,
                'gameserver.migrate.upload_http',
                { backup_path: backupPath, upload_path: streamPath, token },
                3600000 // 60 Minuten (10+ GB über langsame Leitungen)
            );

            if (!uploadResult?.success) {
                throw new Error(`Backup-Transfer (Quelle → Dashboard) fehlgeschlagen: ${uploadResult?.message || uploadResult?.error || 'Unbekannt'}`);
            }

            this.Logger.info(`[MigrationManager] Backup auf Dashboard: ${localTempPath} (${uploadResult.uploaded_bytes ?? uploadResult.data?.uploaded_bytes ?? '?'} Bytes)`);

            // Progress-Update
            await this._updateMigrationStatus(migrationId, 'transferring', 55, 'Download zum Ziel-Server...');
            this._sendSSE(guildId, server.id, { type: 'migration_progress', migrationId, step: 'uploading', progress: 55 });

            // Schritt B: Dashboard → Ziel-Daemon (HTTP GET, gestreamt)
            const downloadResult = await this.ipmServer.sendCommand(
                targetRootServer.daemon_id,
                'gameserver.migrate.download_http',
                {
                    download_path: streamPath,
                    token,
                    target_path: `/tmp/migration-${server.id}-incoming.tar.gz`
                },
                3600000 // 60 Minuten
            );

            if (!downloadResult?.success) {
                throw new Error(`Backup-Transfer (Dashboard → Ziel) fehlgeschlagen: ${downloadResult?.message || downloadResult?.error || 'Unbekannt'}`);
            }

            this.Logger.success(`[MigrationManager] Backup transferred successfully (HTTP-Streaming, ${downloadResult.downloaded_bytes ?? downloadResult.data?.downloaded_bytes ?? '?'} Bytes)`);

        } finally {
            // Token invalidieren + lokale Temp-Datei löschen
            this._endTransfer(migrationId);
            try {
                await fs.unlink(localTempPath);
                this.Logger.info(`[MigrationManager] Local temp file deleted: ${localTempPath}`);
            } catch (err) {
                // Datei existiert evtl. nicht (früher Abbruch) — kein Problem
            }
        }
    }

    /**
     * Passt Ports an, falls Ziel-Server andere Ranges hat
     * @private
     */
    /**
     * Passt Ports an, falls Ziel-Server andere Ranges hat oder Ports bereits belegt sind
     * @private
     */
    async _adjustPorts(server, targetRootServer) {
        const currentPorts = typeof server.ports === 'string' ? JSON.parse(server.ports) : server.ports;
        
        // Alle bereits belegten Ports auf Ziel-RootServer laden
        const usedPorts = await this._getUsedPortsOnRootServer(targetRootServer.id, server.id);
        
        // Prüfen ob alle aktuellen Ports verfügbar sind
        const portsToAllocate = Object.keys(currentPorts);
        let needsReallocation = false;
        
        for (const portKey of portsToAllocate) {
            const port = currentPorts[portKey];
            const externalPort = port.external || port;
            
            if (usedPorts.includes(externalPort)) {
                this.Logger.warn(`[MigrationManager] Port ${externalPort} (${portKey}) ist bereits belegt auf RootServer ${targetRootServer.id}`);
                needsReallocation = true;
                break;
            }
        }
        
        // Falls keine Reallocation nötig: Original-Ports zurückgeben
        if (!needsReallocation) {
            this.Logger.info(`[MigrationManager] Alle Ports verfügbar auf Ziel-Server, keine Anpassung nötig`);
            return currentPorts;
        }
        
        // Neue Ports allozieren
        this.Logger.info(`[MigrationManager] Ports müssen neu alloziert werden...`);
        const newPorts = {};
        
        for (const portKey of portsToAllocate) {
            const oldPort = currentPorts[portKey];
            const preferredPort = oldPort.external || oldPort;
            
            // Freien Port finden (Range: 27000-37000 wie in der Create-Logik)
            const newPort = await this._findFreePort(targetRootServer.id, preferredPort, usedPorts);
            
            newPorts[portKey] = {
                external: newPort,
                internal: newPort
            };
            
            usedPorts.push(newPort); // Merken für nächste Iteration
            
            this.Logger.info(`[MigrationManager] Port ${portKey}: ${preferredPort} → ${newPort}`);
        }
        
        return newPorts;
    }
    
    /**
     * Lädt alle bereits belegten Ports auf einem RootServer
     * @private
     */
    async _getUsedPortsOnRootServer(rootServerId, excludeServerId = null) {
        const query = `
            SELECT ports FROM gameservers 
            WHERE rootserver_id = ? 
            ${excludeServerId ? 'AND id != ?' : ''}
        `;
        const params = excludeServerId ? [rootServerId, excludeServerId] : [rootServerId];
        
        const servers = await this.dbService.query(query, params);
        const usedPorts = [];
        
        for (const srv of servers) {
            try {
                const ports = typeof srv.ports === 'string' ? JSON.parse(srv.ports) : srv.ports;
                for (const portKey in ports) {
                    const port = ports[portKey];
                    const externalPort = port.external || port;
                    if (externalPort && !usedPorts.includes(externalPort)) {
                        usedPorts.push(externalPort);
                    }
                }
            } catch (err) {
                this.Logger.warn(`[MigrationManager] Fehler beim Parsen von Ports:`, err);
            }
        }
        
        return usedPorts;
    }
    
    /**
     * Findet einen freien Port im Standard-Range
     * @private
     */
    async _findFreePort(rootServerId, preferredPort, usedPorts) {
        const MIN_PORT = 27000;
        const MAX_PORT = 37000;
        
        // Zuerst versuchen den bevorzugten Port zu verwenden
        if (preferredPort >= MIN_PORT && preferredPort <= MAX_PORT && !usedPorts.includes(preferredPort)) {
            return preferredPort;
        }
        
        // Ansonsten ersten freien Port finden
        for (let port = MIN_PORT; port <= MAX_PORT; port++) {
            if (!usedPorts.includes(port)) {
                return port;
            }
        }
        
        throw new Error('Keine freien Ports verfügbar im Range 27000-37000');
    }

    /**
     * Räumt temporäre Dateien auf
     * @private
     */
    async _cleanup(migrationId, sourceRootServer, targetRootServer, sourceBackupPath, targetBackupPath) {
        this.Logger.info(`[MigrationManager] Cleanup for migration ${migrationId}...`);

        // Backup auf Quell-Daemon löschen
        try {
            await this.ipmServer.sendCommand(
                sourceRootServer.daemon_id,
                'gameserver.migrate.cleanup',
                { backup_path: sourceBackupPath },
                30000
            );
        } catch (err) {
            this.Logger.warn(`[MigrationManager] Cleanup source backup failed:`, err);
        }

        // Backup auf Ziel-Daemon löschen
        try {
            await this.ipmServer.sendCommand(
                targetRootServer.daemon_id,
                'gameserver.migrate.cleanup',
                { backup_path: targetBackupPath },
                30000
            );
        } catch (err) {
            this.Logger.warn(`[MigrationManager] Cleanup target backup failed:`, err);
        }
    }

    /**
     * Aktualisiert Migration-Status in DB
     * @private
     */
    async _updateMigrationStatus(migrationId, status, progress, currentStep = null) {
        await this.dbService.query(
            'UPDATE gameserver_migrations SET status = ?, progress_percent = ?, current_step = ? WHERE id = ?',
            [status, progress, currentStep, migrationId]
        );
    }

    /**
     * Sendet SSE-Event für Live-Updates im UI
     * @private
     */
    _sendSSE(guildId, serverId, data) {
        // WICHTIG (1): Die SSEManager-API heißt broadcast(guildId, namespace, data).
        // Der frühere Aufruf sendToGuild() existierte nicht → TypeError, der in
        // startMigration verschluckt wurde.
        //
        // WICHTIG (2): server_id MUSS im Payload stehen! Die SSE-Route
        // (routes/servers.js, GET /events) filtert Events pro Server über
        // `String(message.data.server_id) === req.query.server_id`. Ohne das Feld
        // werden ALLE Migration-Events verworfen und das UI bleibt auf
        // "Initialisierung..." stehen, obwohl die Migration im Backend läuft.
        try {
            if (this.sseManager) {
                this.sseManager.broadcast(guildId, 'gameserver_migration', {
                    server_id: String(serverId),
                    ...data
                });
            }
        } catch (err) {
            // SSE ist Komfort, nie migrationskritisch — Fehler nur loggen
            this.Logger.warn('[MigrationManager] SSE-Broadcast fehlgeschlagen:', err?.message || err);
        }
    }

    /**
     * Migration-Status abrufen
     */
    async getMigrationStatus(migrationId) {
        const [migration] = await this.dbService.query(
            'SELECT * FROM gameserver_migrations WHERE id = ?',
            [migrationId]
        );

        return migration || null;
    }
}

module.exports = new MigrationManager();
