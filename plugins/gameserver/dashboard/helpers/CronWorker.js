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

        // Taeglicher Aufbewahrungs-Durchlauf, unabhaengig von den Jobs. Ohne
        // ihn wuerde eine neu gesetzte Grenze erst beim naechsten Backup wirken
        // — und bei einem geloeschten Backup-Job nie.
        this._aufbewahrung = cron.schedule('30 3 * * *', () => {
            this.aufbewahrungDurchlauf().catch(err =>
                Logger.warn(`[CronWorker] Aufbewahrungs-Durchlauf fehlgeschlagen: ${err.message}`)
            );
        });

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
        if (this._aufbewahrung) {
            this._aufbewahrung.stop();
            this._aufbewahrung = null;
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

        // Soll der Job jetzt überhaupt laufen? Aktion und Serverstatus zusammen
        // entscheiden das – siehe helpers/cronEntscheidung.js. Wichtig ist der
        // Sonderfall `start`: der braucht einen gestoppten Server.
        //
        // Ein bewusst ausgelassener Job wird als `skipped` verbucht, nicht als
        // `failed`. Vorher stand nach jeder Nacht mit offline-Daemon ein roter
        // Fehler in der Liste, obwohl nichts kaputt war.
        const { entscheide } = require('./cronEntscheidung');
        const serverStatus = await this._serverStatus(job.server_id, dbService);
        const lage = entscheide({
            aktion: job.action,
            serverStatus,
            daemonOnline: !!daemonId && !!ipmServer?.isDaemonOnline(daemonId),
        });

        if (!lage.ausfuehren) {
            Logger.info(`[CronWorker] Job ${job.id} ("${job.name}") übersprungen: ${lage.grund}`);
            await this._updateStatus(dbService, job.id, 'skipped', lage.grund);
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

            // Aufbewahrung erst NACH dem erfolgreichen Backup anwenden. Wer
            // vorher aufraeumt, steht ohne Kopie da, wenn das neue Backup
            // scheitert.
            await this._aufbewahrungAnwenden(job, daemonId, ipmServer, dbService, Logger);
        } catch (err) {
            await dbService.query(
                "UPDATE gameserver_backups SET status = 'failed', error_message = ? WHERE id = ?",
                [err.message || 'Backup fehlgeschlagen', backupId]
            );
            throw err;
        }
    }

    /**
     * Wendet die Aufbewahrungsgrenzen eines Backup-Cronjobs an (Baustellen 7.1).
     *
     * Zwei Grenzen je Job: `backup_keep` (Anzahl) und `backup_keep_days`
     * (Alter). Beide 0 heisst unbegrenzt – der Zustand von vorher, damit
     * bestehende Jobs sich durch die Umstellung nicht anders verhalten.
     *
     * Beruecksichtigt werden nur Backups **dieses Cronjobs** (`created_by =
     * 'cron'`), nie die von Hand angelegten. Wer selbst ein Backup zieht, will
     * es behalten; ein Automatismus darf es nicht wegraeumen.
     *
     * Die Datei wird ueber den Daemon geloescht, die DB-Zeile erst danach
     * markiert. Schlaegt das Loeschen fehl, bleibt beides stehen – lieber ein
     * Backup zu viel als eine Zeile ohne Datei.
     */
    async _aufbewahrungAnwenden(job, daemonId, ipmServer, dbService, Logger) {
        // Grenzen frisch lesen: der Job liegt seit dem Einplanen im Speicher,
        // die Einstellung kann seitdem geaendert worden sein.
        const [grenzen] = await dbService.query(
            'SELECT backup_keep, backup_keep_days FROM gameserver_cronjobs WHERE id = ?',
            [job.id]
        );
        return this.aufbewahrungFuerServer(job.server_id, grenzen, daemonId, ipmServer, dbService, Logger);
    }

    /**
     * Wendet die Aufbewahrung eines Servers an.
     *
     * Getrennt vom Cronjob, weil die Einstellung seit dem 2026-08-10 am Server
     * haengt: wer den Backup-Job loescht, soll nicht auch die Aufbewahrung
     * verlieren. Der taegliche Durchlauf ruft dieselbe Methode ohne Job auf.
     *
     * @param {number} serverId
     * @param {object|null} jobGrenzen Abweichung des Cronjobs, oder null
     */
    async aufbewahrungFuerServer(serverId, jobGrenzen, daemonId, ipmServer, dbService, Logger) {
        const { zuEntfernen } = require('./cronEntscheidung');
        const { loeseAufbewahrung } = require('../assets/js/cronPlan');

        const [server] = await dbService.query(
            'SELECT backup_keep, backup_keep_days FROM gameservers WHERE id = ?',
            [serverId]
        );
        const { keep, keepDays, quelle } = loeseAufbewahrung(server || {}, jobGrenzen);
        if (!keep && !keepDays) return;

        const backups = await dbService.query(
            `SELECT id, name, created_at
             FROM gameserver_backups
             WHERE server_id = ? AND created_by = 'cron'
               AND status = 'completed' AND pruned_at IS NULL
             ORDER BY created_at DESC`,
            [serverId]
        );

        const raus = zuEntfernen(backups, { keep, keepDays });
        if (!raus.length) return;

        Logger.debug(`[CronWorker] Aufbewahrung Server ${serverId}: Grenze aus der ${quelle === 'job' ? 'Cronjob-Abweichung' : 'Servereinstellung'}`);

        const nachName = new Map(backups.map(b => [b.id, b.name]));
        let entfernt = 0;

        for (const backupId of raus) {
            const name = nachName.get(backupId);
            try {
                const antwort = await ipmServer.sendCommand(daemonId, 'gameserver.backup_delete', {
                    server_id: String(serverId),
                    backup_name: name,
                }, 30000);

                if (!antwort?.success) {
                    throw new Error(antwort?.error || 'Daemon meldete keinen Erfolg');
                }

                await dbService.query(
                    'UPDATE gameserver_backups SET pruned_at = NOW() WHERE id = ?',
                    [backupId]
                );
                entfernt++;
            } catch (err) {
                // Nicht werfen: das Backup selbst war erfolgreich, und ein
                // misslungenes Aufraeumen darf den Job nicht auf `failed` setzen.
                Logger.warn(`[CronWorker] Aufbewahrung: Backup ${backupId} (${name}) konnte nicht entfernt werden: ${err.message}`);
            }
        }

        if (entfernt) {
            Logger.info(`[CronWorker] Aufbewahrung Server ${serverId}: ${entfernt} von ${raus.length} alten Backup(s) entfernt (behalte ${keep || '∞'}, max. ${keepDays || '∞'} Tage)`);
        }
    }

    /**
     * Taeglicher Durchlauf ueber alle Server mit einer Aufbewahrungsgrenze.
     *
     * Warum zusaetzlich zum Aufraeumen nach jedem Backup: die Grenze haengt am
     * Server, nicht am Cronjob. Wer den Backup-Job loescht oder abschaltet,
     * soll seine alten Backups trotzdem loswerden — sonst liegt der Bestand von
     * damals fuer immer da. Ebenso greift eine gerade erst gesetzte Grenze
     * damit ohne auf das naechste Backup zu warten.
     *
     * Server, deren Daemon offline ist, werden uebersprungen und beim naechsten
     * Durchlauf erneut versucht.
     */
    async aufbewahrungDurchlauf() {
        const Logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');
        const ipmServer = ServiceManager.get('ipmServer');

        const server = await dbService.query(
            `SELECT gs.id, r.daemon_id
             FROM gameservers gs
             LEFT JOIN rootserver r ON gs.rootserver_id = r.id
             WHERE gs.backup_keep > 0 OR gs.backup_keep_days > 0`
        );
        if (!server?.length) return;

        for (const s of server) {
            if (!s.daemon_id || !ipmServer?.isDaemonOnline(s.daemon_id)) continue;
            try {
                await this.aufbewahrungFuerServer(s.id, null, s.daemon_id, ipmServer, dbService, Logger);
            } catch (err) {
                Logger.warn(`[CronWorker] Aufbewahrungs-Durchlauf für Server ${s.id} fehlgeschlagen: ${err.message}`);
            }
        }
    }

    /**
     * Aktualisiert last_run_at, last_status und den Klartext-Grund in der DB.
     *
     * @param {Object} dbService
     * @param {number} jobId
     * @param {'success'|'failed'|'skipped'} status
     * @param {string} [meldung] Grund im Klartext, wird in der Liste angezeigt
     */
    async _updateStatus(dbService, jobId, status, meldung = null) {
        await dbService.query(
            'UPDATE gameserver_cronjobs SET last_run_at = NOW(), last_status = ?, last_message = ? WHERE id = ?',
            [status, meldung ? String(meldung).slice(0, 255) : null, jobId]
        );
    }

    /**
     * Liest den aktuellen Status eines Servers.
     *
     * Bewusst bei jeder Ausführung frisch aus der DB, nicht aus dem gecachten
     * Job: der Status ändert sich staendig, der Job wird beim Einplanen einmal
     * gelesen. Ein unbekannter Server gilt als gestoppt – dann greift die
     * vorsichtige Seite der Entscheidung.
     *
     * @param {number} serverId
     * @param {Object} dbService
     * @returns {Promise<string>}
     */
    async _serverStatus(serverId, dbService) {
        try {
            const [row] = await dbService.query(
                'SELECT status FROM gameservers WHERE id = ?', [serverId]
            );
            return row?.status || 'offline';
        } catch (err) {
            ServiceManager.get('Logger')?.warn(
                `[CronWorker] Status für Server ${serverId} nicht lesbar: ${err.message}`
            );
            return 'offline';
        }
    }
}

module.exports = CronWorker;
