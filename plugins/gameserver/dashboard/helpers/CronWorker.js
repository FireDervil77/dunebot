'use strict';

/**
 * CronWorker – Gameserver Cron-Job Scheduler
 *
 * Lädt alle aktivierten Cronjobs aus gameserver_cronjobs und
 * führt sie zum eingestellten Zeitpunkt aus (via node-cron).
 *
 * Aktionen:
 *  - start     → gameserver.start  (IPM)
 *  - stop      → gameserver.stop   (IPM)
 *  - restart   → gameserver.restart (IPM)
 *  - backup    → gameserver.backup  (IPM) + gameserver_backups DB-Eintrag
 *  - command   → gameserver.rcon   (IPM)
 */
const cron = require('node-cron');
const { ServiceManager } = require('dunebot-core');

class CronWorker {
    constructor() {
        /** @type {Map<number, import('node-cron').ScheduledTask>} id → ScheduledTask */
        this._tasks = new Map();
        /** @type {Map<number, Object>} id → Job-Datensatz (für serverbezogene Aktionen) */
        this._jobs = new Map();
        this._started = false;
    }

    // ────────────────────────────────────────────────────────────
    // Lifecycle
    // ────────────────────────────────────────────────────────────

    /**
     * Startet den Worker: Lädt alle aktivierten Jobs aus der DB und plant sie ein.
     * @param {Object} dbService - DuneBot DB-Service
     */
    async start(dbService) {
        const Logger = ServiceManager.get('Logger');
        Logger.info('[CronWorker] Starte Gameserver Cron-Worker...');

        const jobs = await dbService.query(
            `SELECT cj.id, cj.server_id, cj.guild_id, cj.name, cj.cron_expr, cj.action,
                    cj.command, cj.enabled, cj.run_once,
                    gs.name AS server_name, gs.install_path, gs.daemon_server_id AS daemon_id,
                    r.daemon_id AS rootserver_daemon_id
             FROM gameserver_cronjobs cj
             JOIN gameservers gs ON gs.id = cj.server_id
             LEFT JOIN rootserver r ON gs.rootserver_id = r.id
             WHERE cj.enabled = 1`
        );

        if (!jobs || !jobs.length) {
            Logger.info('[CronWorker] Keine aktiven Cronjobs gefunden.');
        } else {
            Logger.info(`[CronWorker] Plane ${jobs.length} Cronjobs ein...`);
            for (const job of jobs) {
                this._schedule(job);
            }
        }

        this._started = true;
        Logger.success('[CronWorker] Cron-Worker gestartet.');
    }

    /**
     * Stoppt den Worker und alle laufenden Tasks.
     */
    stop() {
        for (const [id, task] of this._tasks) {
            task.stop();
            this._tasks.delete(id);
        }
        this._jobs.clear();
        this._started = false;
        const Logger = ServiceManager.get('Logger');
        Logger.info('[CronWorker] Cron-Worker gestoppt.');
    }

    // ────────────────────────────────────────────────────────────
    // Dynamisches Job-Management (wird von Routes aufgerufen)
    // ────────────────────────────────────────────────────────────

    /**
     * Fügt einen neuen Job zum Scheduler hinzu (wenn enabled).
     * Erwartet das vollständige Job-Objekt wie es aus der DB kommt,
     * inkl. daemon_id und install_path.
     * @param {Object} job
     */
    add(job) {
        if (!job.enabled) return;
        this.remove(job.id); // Sicherheits-Dedup
        this._schedule(job);
    }

    /**
     * Entfernt einen Job aus dem Scheduler.
     * @param {number} id
     */
    remove(id) {
        const task = this._tasks.get(id);
        if (task) {
            task.stop();
            this._tasks.delete(id);
            this._jobs.delete(id);
            const Logger = ServiceManager.get('Logger');
            Logger.debug(`[CronWorker] Job ${id} entfernt.`);
        }
    }

    /**
     * Aktualisiert einen Job (entfernt + fügt neu hinzu).
     * @param {Object} job
     */
    update(job) {
        this.remove(job.id);
        if (job.enabled) {
            this._schedule(job);
        }
    }

    // ────────────────────────────────────────────────────────────
    // Intern
    // ────────────────────────────────────────────────────────────

    /**
     * Plant einen Job ein (node-cron).
     * @param {Object} job
     */
    _schedule(job) {
        const Logger = ServiceManager.get('Logger');

        // Cron-Expression validieren (5 oder 6 Felder)
        if (!cron.validate(job.cron_expr)) {
            Logger.warn(`[CronWorker] Ungültige Cron-Expression für Job ${job.id} (${job.name}): "${job.cron_expr}" – übersprungen`);
            return;
        }

        const task = cron.schedule(job.cron_expr, () => {
            this._execute(job).catch(err => {
                Logger.error(`[CronWorker] Fehler bei Ausführung von Job ${job.id} (${job.name}):`, err.message);
            });
        }, {
            timezone: 'Europe/Berlin',
            scheduled: true,
        });

        this._tasks.set(job.id, task);
        this._jobs.set(job.id, job);
        Logger.debug(`[CronWorker] Job ${job.id} (${job.name}) eingeplant: ${job.cron_expr} → ${job.action}`);
    }

    /**
     * Führt einen Cronjob aus und aktualisiert die DB.
     * @param {Object} job
     */
    async _execute(job) {
        const Logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');
        const ipmServer = ServiceManager.get('ipmServer');

        Logger.info(`[CronWorker] Führe Job ${job.id} aus: "${job.name}" (${job.action}) für Server ${job.server_id}`);

        // Daemon bei JEDER Ausführung frisch auflösen.
        // Der Job wird beim Einplanen einmal aus der DB gelesen und bleibt dann im
        // Speicher – nach einem Server-Umzug zeigte der gecachte Wert weiter auf den
        // alten Rootserver, und Backups/Neustarts liefen dort ins Leere.
        const daemonId = await this._resolveDaemonId(job, dbService);

        // Daemon-Status prüfen
        if (!daemonId || !ipmServer?.isDaemonOnline(daemonId)) {
            Logger.warn(`[CronWorker] Job ${job.id}: Daemon ${daemonId || '?'} ist offline – übersprungen`);
            await this._updateStatus(dbService, job.id, 'failed');
            return;
        }

        try {
            await this._dispatchAction(job, daemonId, ipmServer, dbService, Logger);
            await this._updateStatus(dbService, job.id, 'success');
            Logger.info(`[CronWorker] Job ${job.id} (${job.name}) erfolgreich ausgeführt`);

            // run_once: Job nach Ausführung deaktivieren
            if (job.run_once) {
                await dbService.query(
                    'UPDATE gameserver_cronjobs SET enabled = 0 WHERE id = ?',
                    [job.id]
                );
                this.remove(job.id);
                Logger.info(`[CronWorker] Job ${job.id} (${job.name}) war run_once – deaktiviert und entfernt`);
            }
        } catch (err) {
            Logger.error(`[CronWorker] Job ${job.id} (${job.name}) fehlgeschlagen:`, err.message);
            await this._updateStatus(dbService, job.id, 'failed');
        }
    }

    /**
     * Dispatcher: Wählt die korrekte IPM-Action basierend auf job.action.
     */
    async _dispatchAction(job, daemonId, ipmServer, dbService, Logger) {
        const serverId = String(job.server_id);

        switch (job.action) {
            case 'start':
                await ipmServer.sendCommand(
                    daemonId, 'gameserver.start',
                    await this._startPayload(job, dbService, serverId),
                    60000
                );
                break;

            case 'stop':
                await ipmServer.sendCommand(daemonId, 'gameserver.stop', {
                    server_id: serverId,
                    guild_id: String(job.guild_id),
                }, 60000);
                break;

            case 'restart':
                // Vollständiges Payload: der nächtliche Neustart ist der Weg, auf dem
                // Updates einlaufen sollen – und ohne Image/Startup-Command scheitert
                // der Start nach dem Stop, der Server bliebe bis zum Morgen unten.
                await ipmServer.sendCommand(
                    daemonId, 'gameserver.restart',
                    await this._startPayload(job, dbService, serverId),
                    60000
                );
                break;

            case 'backup':
                await this._executeBackup(job, daemonId, ipmServer, dbService, Logger);
                break;

            case 'command':
                if (!job.command) throw new Error('command-Feld leer');
                await this._executeRcon(job, daemonId, ipmServer, dbService);
                break;

            default:
                throw new Error(`Unbekannte Aktion: ${job.action}`);
        }
    }

    /**
     * Baut das vollständige Start-/Restart-Payload für diesen Server.
     *
     * Der Daemon hält Image, Startup-Command und Ports nur im Speicher – ein
     * Payload mit bloßer server_id genügt nach einem Daemon-Neustart nicht.
     *
     * @param {Object} job
     * @param {Object} dbService
     * @param {string} serverId
     * @returns {Promise<Object>}
     * @throws {Error} wenn der Server oder sein Docker-Image fehlt
     */
    async _startPayload(job, dbService, serverId) {
        const { buildStartPayload, loadServerForStart } = require('./StartPayload');

        const server = await loadServerForStart(dbService, job.server_id);
        if (!server) throw new Error(`Server ${job.server_id} nicht gefunden`);

        const { payload, error } = buildStartPayload(server, job.guild_id, ServiceManager.get('Logger'));
        if (error) throw new Error(error);

        return { ...payload, server_id: serverId };
    }

    /**
     * Ermittelt den aktuell zuständigen Daemon eines Jobs.
     *
     * Immer über die DB, nie über den gecachten Job – der Server kann seit dem
     * Einplanen auf einen anderen Rootserver umgezogen sein.
     *
     * @param {Object} job
     * @param {Object} dbService
     * @returns {Promise<string|null>}
     */
    async _resolveDaemonId(job, dbService) {
        try {
            const [row] = await dbService.query(
                `SELECT r.daemon_id
                 FROM gameservers gs
                 LEFT JOIN rootserver r ON gs.rootserver_id = r.id
                 WHERE gs.id = ?`,
                [job.server_id]
            );
            if (row?.daemon_id) {
                // Gecachten Job mitziehen, damit Folgeausführungen konsistent sind
                job.rootserver_daemon_id = row.daemon_id;
                return row.daemon_id;
            }
        } catch (err) {
            ServiceManager.get('Logger')?.warn(
                `[CronWorker] Daemon-Auflösung für Job ${job.id} fehlgeschlagen: ${err.message}`
            );
        }
        return job.rootserver_daemon_id || job.daemon_id || null;
    }

    /**
     * Plant alle Jobs eines Servers neu ein – z.B. nach einem Umzug auf einen
     * anderen Rootserver, damit sie mit den aktuellen Daten laufen.
     *
     * @param {number|string} serverId
     * @returns {Promise<number>} Anzahl neu eingeplanter Jobs
     */
    async rescheduleServer(serverId) {
        const Logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');

        // Bestehende Tasks dieses Servers stoppen
        const stopped = this.pauseServer(serverId);

        const jobs = await dbService.query(
            `SELECT cj.id, cj.server_id, cj.guild_id, cj.name, cj.cron_expr, cj.action,
                    cj.command, cj.enabled, cj.run_once,
                    gs.name AS server_name, gs.install_path, gs.daemon_server_id AS daemon_id,
                    r.daemon_id AS rootserver_daemon_id
             FROM gameserver_cronjobs cj
             JOIN gameservers gs ON gs.id = cj.server_id
             LEFT JOIN rootserver r ON gs.rootserver_id = r.id
             WHERE cj.server_id = ? AND cj.enabled = 1`,
            [serverId]
        );

        for (const job of jobs) {
            this._schedule(job);
        }

        Logger.info(`[CronWorker] Server ${serverId}: ${stopped} Job(s) gestoppt, ${jobs.length} neu eingeplant`);
        return jobs.length;
    }

    /**
     * Stoppt alle laufenden Tasks eines Servers, ohne sie in der DB zu ändern.
     * Wird während einer Migration genutzt, damit kein Backup oder Neustart
     * mitten in den Umzug fährt.
     *
     * @param {number|string} serverId
     * @returns {number} Anzahl gestoppter Tasks
     */
    pauseServer(serverId) {
        let stopped = 0;
        for (const [jobId, task] of [...this._tasks]) {
            const job = this._jobs.get(jobId);
            if (!job || String(job.server_id) !== String(serverId)) continue;
            task.stop();
            this._tasks.delete(jobId);
            this._jobs.delete(jobId);
            stopped++;
        }
        return stopped;
    }

    /**
     * Führt einen RCON-Befehl aus.
     *
     * Der Daemon braucht Host, Port, Passwort und Protokoll – die stehen nicht im
     * Job, sondern in ports/env_variables des Servers und im Addon. Sie werden hier
     * genauso aufgelöst wie im Konsolen-Pfad.
     */
    async _executeRcon(job, daemonId, ipmServer, dbService) {
        const StatusService = require('./StatusService');

        const [server] = await dbService.query(`
            SELECT gs.id, gs.guild_id, gs.ports, gs.env_variables, gs.bind_ip,
                   am.game_data,
                   r.host AS rootserver_ip
            FROM gameservers gs
            LEFT JOIN addon_marketplace am ON gs.addon_marketplace_id = am.id
            LEFT JOIN rootserver r         ON gs.rootserver_id = r.id
            WHERE gs.id = ?
        `, [job.server_id]);

        if (!server) throw new Error(`Server ${job.server_id} nicht gefunden`);

        const parse = (v, fallback) => {
            if (v == null) return fallback;
            if (typeof v !== 'string') return v;
            try { return JSON.parse(v); } catch (_) { return fallback; }
        };
        const ports    = parse(server.ports, {});
        const envVars  = parse(server.env_variables, {});
        const gameData = parse(server.game_data, {});

        const rcon = StatusService.resolveRcon({ gameData, ports, envVars });
        if (!rcon.available) {
            throw new Error(rcon.reason || 'RCON ist für diesen Server nicht verfügbar');
        }

        const result = await ipmServer.sendCommand(daemonId, 'gameserver.rcon', {
            guild_id:      String(server.guild_id),
            server_id:     String(server.id),
            rcon_host:     server.bind_ip || server.rootserver_ip || '127.0.0.1',
            rcon_port:     rcon.port,
            rcon_password: envVars[gameData.config.rcon.password_var] || '',
            rcon_protocol: rcon.protocol || 'srcds',
            rcon_command:  job.command,
        }, 30000);

        StatusService.recordRconResult(server.id, server.guild_id, !!result?.success, result?.error)
            .catch(() => { /* Anzeige-Detail */ });

        if (!result?.success) {
            throw new Error(result?.error || 'RCON-Befehl fehlgeschlagen');
        }
    }

    /**
     * Führt ein Backup aus und pflegt gameserver_backups.
     */
    async _executeBackup(job, daemonId, ipmServer, dbService, Logger) {
        // Backup-Namen generieren
        const now = new Date();
        const ts = now.toISOString().replace('T', '_').replace(/:/g, '-').slice(0, 16);
        const safeName = (job.server_name || `server_${job.server_id}`)
            .replace(/[^a-zA-Z0-9_-]/g, '_')
            .substring(0, 40);
        const backupName = `${safeName}_cron_${ts}`;

        // DB-Eintrag anlegen (pending)
        const result = await dbService.query(
            `INSERT INTO gameserver_backups (server_id, guild_id, name, status, note, created_by)
             VALUES (?, ?, ?, 'pending', 'Automatisches Backup (Cronjob)', 'cron')`,
            [job.server_id, job.guild_id, backupName]
        );
        const backupId = result.insertId;

        try {
            // Status: running
            await dbService.query(
                "UPDATE gameserver_backups SET status = 'running' WHERE id = ?",
                [backupId]
            );

            const response = await ipmServer.sendCommand(daemonId, 'gameserver.backup', {
                server_id: String(job.server_id),
                backup_id: String(backupId),
                backup_name: backupName,
                install_path: job.install_path,
            }, 300000);

            const sizeBytes = response?.size_bytes || 0;

            await dbService.query(
                "UPDATE gameserver_backups SET status = 'completed', size_bytes = ?, completed_at = NOW() WHERE id = ?",
                [sizeBytes, backupId]
            );

            Logger.info(`[CronWorker] Cronjob-Backup abgeschlossen: ${backupName} (${sizeBytes} Bytes)`);

            // SSE-Broadcast
            const sseManager = ServiceManager.get('sseManager');
            sseManager?.broadcast(String(job.guild_id), 'gameserver', {
                action: 'backup_completed',
                server_id: job.server_id,
                backup_id: backupId,
                backup_name: backupName,
                source: 'cron',
            });
        } catch (err) {
            await dbService.query(
                "UPDATE gameserver_backups SET status = 'failed', error_message = ? WHERE id = ?",
                [err.message || 'Backup fehlgeschlagen', backupId]
            );
            throw err;
        }
    }

    /**
     * Aktualisiert last_run_at und last_status in der DB.
     */
    async _updateStatus(dbService, jobId, status) {
        await dbService.query(
            'UPDATE gameserver_cronjobs SET last_run_at = NOW(), last_status = ? WHERE id = ?',
            [status, jobId]
        );
    }
}

module.exports = CronWorker;
