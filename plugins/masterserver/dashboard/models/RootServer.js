/**
 * RootServer Model
 *
 * Repräsentiert eine physische Maschine (Node) auf der der FireBot Daemon läuft.
 * Entspricht einem "Node" in Pelican/Pterodactyl.
 *
 * Enthält alle Verbindungs-, Status- und Hardware-Informationen direkt —
 * daemon_instances existiert nicht mehr (seit Migration 2.0.0).
 *
 * @module RootServer
 * @author FireBot Team
 */

const { ServiceManager } = require('dunebot-core');
const crypto = require('crypto');

class RootServer {

    // =========================================================
    // CRUD
    // =========================================================

    /**
     * Neuen RootServer erstellen (= neue physische Maschine / neuen Daemon registrieren)
     */
    static async create(data) {
        const dbService = ServiceManager.get('dbService');

        const daemonId = crypto.randomUUID();
        const apiKey   = crypto.randomBytes(32).toString('hex');

        const result = await dbService.query(
            `INSERT INTO rootserver
             (daemon_id, guild_id, owner_user_id, name, description, hostname, host,
              daemon_port, base_directory, api_key,
              daemon_status, install_status,
              cpu_cores, ram_total_gb, disk_total_gb,
              datacenter, country_code,
              fqdn, fastdl_enabled,
              db_gewuenscht, db_je_server,
              created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'offline', 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
            [
                daemonId,
                data.guildId,
                data.ownerUserId   || null,
                data.name,
                data.description   || null,
                data.hostname      || null,
                data.host,
                data.daemonPort    || 9340,
                data.baseDirectory || '/opt/firebot',
                apiKey,
                data.cpuCores      || null,
                data.ramTotalGb    || null,
                data.diskTotalGb   || null,
                data.datacenter    || null,
                data.countryCode   || null,
                data.fqdn          || null,
                data.fastdlEnabled ? 1 : 0,
                // Absicht, nicht Fähigkeit: `db_moeglich` setzt ausschliesslich
                // der Maschinenbefund beim Verbinden des Daemons.
                data.dbGewuenscht  ? 1 : 0,
                Number.isFinite(data.dbJeServer) ? data.dbJeServer : 0
            ]
        );

        return { id: result.insertId, daemonId, apiKey };
    }

    static async getById(id) {
        const dbService = ServiceManager.get('dbService');
        const hasGs = await dbService.tableExists('gameservers');
        let query;
        if (hasGs) {
            query = `SELECT r.*,
                COUNT(DISTINCT g.id) AS gameserver_count,
                SUM(CASE WHEN g.status = 'online' THEN 1 ELSE 0 END) AS gameserver_running_count
             FROM rootserver r LEFT JOIN gameservers g ON r.id = g.rootserver_id
             WHERE r.id = ? GROUP BY r.id LIMIT 1`;
        } else {
            query = `SELECT r.*, 0 AS gameserver_count, 0 AS gameserver_running_count
                     FROM rootserver r WHERE r.id = ? LIMIT 1`;
        }
        const [row] = await dbService.query(query, [id]);
        return row || null;
    }

    static async getByDaemonId(daemonId) {
        const dbService = ServiceManager.get('dbService');
        const [row] = await dbService.query(
            'SELECT * FROM rootserver WHERE daemon_id = ? LIMIT 1',
            [daemonId]
        );
        return row || null;
    }

    static async getByGuild(guildId) {
        const dbService = ServiceManager.get('dbService');
        const hasGs = await dbService.tableExists('gameservers');
        let query;
        if (hasGs) {
            query = `SELECT r.*,
                COUNT(DISTINCT g.id) AS gameserver_count,
                SUM(CASE WHEN g.status = 'online' THEN 1 ELSE 0 END) AS gameserver_running_count
             FROM rootserver r LEFT JOIN gameservers g ON r.id = g.rootserver_id
             WHERE r.guild_id = ? GROUP BY r.id ORDER BY r.created_at DESC`;
        } else {
            query = `SELECT r.*, 0 AS gameserver_count, 0 AS gameserver_running_count
                     FROM rootserver r WHERE r.guild_id = ? ORDER BY r.created_at DESC`;
        }
        return await dbService.query(query, [guildId]);
    }

    static async getAll() {
        const dbService = ServiceManager.get('dbService');
        return await dbService.query('SELECT * FROM rootserver ORDER BY created_at DESC');
    }

    static async update(id, data) {
        const dbService = ServiceManager.get('dbService');
        const allowed = [
            'name', 'description', 'host', 'hostname',
            'daemon_port', 'base_directory',
            'ram_total_gb', 'disk_total_gb', 'cpu_cores', 'cpu_threads', 'cpu_model',
            'ram_limit_gb', 'disk_limit_gb', 'cpu_limit_percent',
            'datacenter', 'country_code',
            'fqdn', 'fastdl_enabled', 'fastdl_url'
        ];
        const fields = [];
        const values = [];
        for (const f of allowed) {
            if (data[f] !== undefined) { fields.push(`${f} = ?`); values.push(data[f]); }
        }
        if (fields.length === 0) throw new Error('Keine gültigen Felder zum Aktualisieren');
        values.push(id);
        await dbService.query(
            `UPDATE rootserver SET ${fields.join(', ')}, updated_at = NOW() WHERE id = ?`, values
        );
    }

    static async delete(id) {
        const dbService = ServiceManager.get('dbService');
        await dbService.query('DELETE FROM rootserver WHERE id = ?', [id]);
    }

    // =========================================================
    // Daemon-Verbindungs-Management
    //
    // Alle Schreibzugriffe auf den Verbindungszustand laufen über diese
    // Methoden. Bis zum 2026-08-02 schrieb der IPMServer sein SQL selbst und
    // rief vom Modell nur `updateHardwareStats()` auf — ein Umbau, der nach der
    // ersten Methode stehengeblieben war. Sichtbar wurde das an
    // `missed_heartbeats`: Die RootServer-Detailseite zeigt den Zähler an, aber
    // `incrementMissedHeartbeat()` hatte keinen Aufrufer, also stand dort immer
    // eine 0.
    // =========================================================

    /**
     * Setzt einen Daemon auf "online" — beim Register und beim Reconnect.
     *
     * Bewusst ein einziges UPDATE statt drei Einzelaufrufe: Version,
     * Sitzungsschlüssel und Status gehören zu einem Vorgang und sollen nicht
     * halb geschrieben stehen bleiben, wenn etwas dazwischen fehlschlägt.
     *
     * @param {string} daemonId
     * @param {object} daten
     * @param {string} [daten.version]           vom Daemon gemeldete Version
     * @param {string} [daten.sessionToken]      neuer JWT
     * @param {number} [daten.sessionTageGueltig] Gültigkeit in Tagen (Standard 30)
     * @param {string} [daten.installStatus]     z.B. 'completed' bei Erstregistrierung
     */
    static async markOnline(daemonId, daten = {}) {
        const dbService = ServiceManager.get('dbService');

        const fields = ['daemon_status = ?', 'last_seen = NOW()', 'missed_heartbeats = 0'];
        const values = ['online'];

        if (daten.version) { fields.push('daemon_version = ?'); values.push(daten.version); }
        // Fingerabdruck des SFTP-Host-Keys. Der Daemon meldet ihn bei jeder
        // Anmeldung; er aendert sich nur, wenn der Schluessel neu erzeugt wurde
        // — dann soll auch die Anzeige sofort den neuen Wert nennen.
        if (daten.sftpFingerprint) { fields.push('sftp_fingerprint = ?'); values.push(daten.sftpFingerprint); }
        // Port, auf dem der SFTP-Server dort wirklich lauscht. Er stand im
        // Dashboard fest im Code und stimmte nicht mehr, sobald jemand die
        // daemon.yaml anpasste — der Kunde bekam dann einen Port angezeigt,
        // an dem niemand antwortet.
        if (daten.sftpPort) { fields.push('sftp_port = ?'); values.push(parseInt(daten.sftpPort, 10)); }
        if (daten.installStatus) { fields.push('install_status = ?'); values.push(daten.installStatus); }
        if (daten.sessionToken) {
            fields.push('session_token = ?');
            values.push(daten.sessionToken);
            fields.push(`session_token_expires_at = DATE_ADD(NOW(), INTERVAL ${parseInt(daten.sessionTageGueltig, 10) || 30} DAY)`);
        }

        values.push(daemonId);
        await dbService.query(
            `UPDATE rootserver SET ${fields.join(', ')} WHERE daemon_id = ?`, values
        );
    }

    /**
     * Setzt einen Daemon auf "offline" — beim Verbindungsabbruch.
     *
     * Ersetzt das frühere `updateStatus()`, das am 2026-08-01 entfernt wurde,
     * weil es keinen Aufrufer hatte. Den Aufrufer gibt es jetzt: der
     * Heartbeat-Monitor des IPMServers.
     */
    static async markOffline(daemonId) {
        const dbService = ServiceManager.get('dbService');
        await dbService.query(
            'UPDATE rootserver SET daemon_status = ? WHERE daemon_id = ?',
            ['offline', daemonId]
        );
    }

    /**
     * Setzt alle Daemons auf "offline" — beim Start des IPMServers.
     *
     * Ein frisch gestarteter Prozess hat keine Verbindungen. Alles, was in der
     * Datenbank noch auf `online` steht, stammt aus dem vorigen Leben des
     * Dashboards und ist unbelegt: Beim Beenden läuft der `close`-Handler nicht
     * mehr zuverlässig, und der Heartbeat-Monitor kann es nicht nachholen, weil
     * er nur über bestehende Verbindungen läuft.
     *
     * Ohne dieses Zurücksetzen blieb ein Daemon, der sich nach einem Neustart
     * des Dashboards nie wieder meldete, dauerhaft als `online` verzeichnet —
     * die Übersicht zeigte "Online", während jede Aktion mit "Daemon nicht
     * verbunden" scheiterte. Zwei Wahrheiten, die auseinanderlaufen.
     *
     * Wer wirklich läuft, meldet sich innerhalb von Sekunden zurück.
     *
     * @returns {Promise<number>} Anzahl der zurückgesetzten Einträge
     */
    static async markAllOffline() {
        const dbService = ServiceManager.get('dbService');
        const ergebnis = await dbService.query(
            "UPDATE rootserver SET daemon_status = 'offline' WHERE daemon_status <> 'offline'"
        );
        return ergebnis?.affectedRows || 0;
    }

    /**
     * Lädt einen RootServer anhand von daemon_id UND API-Key.
     *
     * Für die Erstanmeldung: Der IPMServer braucht nicht nur die Auskunft
     * "Schlüssel stimmt", sondern den Datensatz selbst (guild_id,
     * base_directory, system_user). Das frühere `validateApiKey()` gab nur
     * true/false zurück und war deshalb an dieser Stelle nicht verwendbar —
     * genau deswegen stand dort ein eigenes SELECT.
     *
     * @returns {Promise<object|null>}
     */
    static async getByDaemonIdAndApiKey(daemonId, apiKey) {
        const dbService = ServiceManager.get('dbService');
        const [row] = await dbService.query(
            'SELECT * FROM rootserver WHERE daemon_id = ? AND api_key = ? LIMIT 1',
            [daemonId, apiKey]
        );
        return row || null;
    }

    static async processHeartbeat(daemonId, latencyMs = null) {
        const dbService = ServiceManager.get('dbService');
        const fields = ['daemon_status = ?', 'last_seen = NOW()', 'missed_heartbeats = 0'];
        const values = ['online'];
        if (latencyMs !== null) { fields.push('last_ping_ms = ?'); values.push(latencyMs); }
        values.push(daemonId);
        await dbService.query(
            `UPDATE rootserver SET ${fields.join(', ')} WHERE daemon_id = ?`, values
        );
    }

    static async incrementMissedHeartbeat(daemonId) {
        const dbService = ServiceManager.get('dbService');
        await dbService.query(
            'UPDATE rootserver SET missed_heartbeats = missed_heartbeats + 1 WHERE daemon_id = ?',
            [daemonId]
        );
    }

    // `updateSessionToken()` stand hier bis zum 2026-08-02. Ein Sitzungsschlüssel
    // entsteht ausschließlich beim Anmelden, und dort schreibt ihn `markOnline()`
    // im selben UPDATE wie Status und Version — eine zweite Methode dafür hätte
    // wieder keinen Aufrufer.

    static async updateHardwareStats(daemonId, stats) {
        const dbService = ServiceManager.get('dbService');
        await dbService.query(
            `UPDATE rootserver SET
                cpu_cores = ?, cpu_threads = ?, cpu_model = ?,
                ram_total_gb = ?, disk_total_gb = ?,
                cpu_usage_percent = ?, ram_usage_gb = ?, disk_usage_gb = ?,
                os_info = ?, last_stats_update = NOW()
             WHERE daemon_id = ?`,
            [
                stats.cpu?.cores         || null,
                stats.cpu?.threads       || null,
                stats.cpu?.model_name    || null,
                stats.ram?.total_gb      || null,
                stats.disk?.total_gb     || null,
                stats.cpu?.usage_percent || null,
                stats.ram?.used_gb       || null,
                stats.disk?.used_gb      || null,
                stats.system ? `${stats.system.platform || ''} ${stats.system.platform_version || ''}`.trim() || null : (stats.os_info || null),
                daemonId
            ]
        );
    }

    /**
     * Übernimmt den Maschinenbefund, den der Daemon beim Verbinden meldet.
     *
     * ── Warum das eine eigene Methode ist ───────────────────────────────────
     *
     * `updateHardwareStats()` schreibt Zahlen, die sich im Minutentakt ändern.
     * Hier geht es um Eigenschaften der Maschine, die sich fast nie ändern —
     * und um die daraus abgeleiteten Fähigkeiten, an denen Funktionen hängen.
     * Beides in einem UPDATE würde bedeuten, bei jedem Herzschlag eine
     * DNS-Auflösung zu fahren.
     *
     * Die Reihenfolge ist wichtig: Erst wird geprüft (Name, Webserver,
     * Datenbank), dann geschrieben. Ein `fqdn_gilt = 1` entsteht ausschliesslich
     * aus einer Messung — nie aus einer Eingabe.
     *
     * @param {string} daemonId
     * @param {object} befund     was der Daemon gemessen hat
     * @param {string} gesehenIp  die IP, von der er verbindet
     */
    static async uebernimmMaschinenbefund(daemonId, befund, gesehenIp) {
        const dbService = ServiceManager.get('dbService');
        const M = require('../helpers/Maschinenbefund');

        // Die Absicht steht schon in der Zeile — sie kommt aus dem Formular.
        const [zeile] = await dbService.query(
            'SELECT id, host, fqdn, fastdl_enabled, db_gewuenscht FROM rootserver WHERE daemon_id = ?',
            [daemonId]
        );
        if (!zeile) return null;

        const name   = await M.pruefeNamen(zeile.fqdn, gesehenIp, zeile.host);
        const fastdl = M.leiteFastdlAb(!!zeile.fastdl_enabled, befund && befund.webserver);
        const db     = M.leiteDatenbankAb(!!zeile.db_gewuenscht, befund && befund.datenbank);

        await dbService.query(
            `UPDATE rootserver SET
                gesehene_ip      = ?,
                virtualisierung  = ?,
                webserver        = ?,
                webserver_grund  = ?,
                fqdn_zeigt_auf   = ?,
                fqdn_geprueft_am = NOW(),
                fqdn_gilt        = ?,
                fqdn_grund       = ?,
                fastdl_moeglich  = ?,
                fastdl_grund     = ?,
                db_moeglich      = ?,
                db_grund         = ?
             WHERE daemon_id = ?`,
            [
                M.nackteIp(gesehenIp),
                befund?.virtualisierung   || null,
                befund?.webserver?.art    || null,
                befund?.webserver?.grund  || null,
                name.zeigtAuf,
                name.gilt,
                name.grund,
                fastdl.moeglich,
                fastdl.grund,
                db.moeglich,
                db.grund,
                daemonId,
            ]
        );

        return { name, fastdl, db, hardwareBelastbar: M.hardwareIstBelastbar(befund?.virtualisierung) };
    }

    /**
     * Setzt den Installationsfortschritt eines RootServers.
     *
     * Adressiert über `daemon_id` statt wie früher über `id`: Alle anderen
     * Methoden dieses Abschnitts sprechen den Daemon an, und die Aufrufer
     * (IPMServer, Provisionierung) kennen die daemon_id, nicht die Tabellen-ID.
     * Die alte Signatur war einer der Gründe, warum die Methode nie benutzt
     * wurde.
     */
    static async updateInstallStatus(daemonId, installStatus, installLog = null) {
        const dbService = ServiceManager.get('dbService');
        const fields = ['install_status = ?'];
        const values = [installStatus];
        if (installLog !== null) { fields.push('install_log = ?'); values.push(installLog); }
        values.push(daemonId);
        await dbService.query(`UPDATE rootserver SET ${fields.join(', ')} WHERE daemon_id = ?`, values);
    }

    // =========================================================
    // Hilfsmethoden
    // =========================================================

    static async guildHasRootServer(guildId) {
        const dbService = ServiceManager.get('dbService');
        const [row] = await dbService.query(
            'SELECT id FROM rootserver WHERE guild_id = ? LIMIT 1', [guildId]
        );
        return row !== undefined;
    }

    // `validateApiKey()` stand hier bis zum 2026-08-02 und gab nur true/false
    // zurück. Die einzige Stelle, die einen API-Key prüft — die Erstanmeldung im
    // IPMServer — braucht den Datensatz selbst und hatte deshalb ein eigenes
    // SELECT. Übrig bleibt `getByDaemonIdAndApiKey()` weiter oben, das beides
    // leistet.

    static async getStatusSummary() {
        const dbService = ServiceManager.get('dbService');
        const [row] = await dbService.query(
            `SELECT
                SUM(CASE WHEN daemon_status = 'online'      THEN 1 ELSE 0 END) AS online,
                SUM(CASE WHEN daemon_status = 'offline'     THEN 1 ELSE 0 END) AS offline,
                SUM(CASE WHEN daemon_status = 'error'       THEN 1 ELSE 0 END) AS error,
                SUM(CASE WHEN install_status = 'installing' THEN 1 ELSE 0 END) AS installing
             FROM rootserver`
        );
        return {
            online:     parseInt(row.online     || 0),
            offline:    parseInt(row.offline    || 0),
            error:      parseInt(row.error      || 0),
            installing: parseInt(row.installing || 0)
        };
    }

    static async getStats(guildId) {
        const dbService = ServiceManager.get('dbService');
        const [row] = await dbService.query(
            `SELECT COUNT(*) AS total,
                SUM(CASE WHEN daemon_status = 'online'      THEN 1 ELSE 0 END) AS online,
                SUM(CASE WHEN daemon_status = 'offline'     THEN 1 ELSE 0 END) AS offline,
                SUM(CASE WHEN install_status = 'installing' THEN 1 ELSE 0 END) AS installing,
                SUM(CASE WHEN daemon_status = 'error'       THEN 1 ELSE 0 END) AS error
             FROM rootserver WHERE guild_id = ?`,
            [guildId]
        );
        const [gsRow] = await dbService.query(
            `SELECT COUNT(*) AS total FROM server_registry sr
             JOIN rootserver rs ON sr.daemon_id = rs.daemon_id
             WHERE rs.guild_id = ?`,
            [guildId]
        );
        return {
            total:           parseInt(row.total      || 0),
            online:          parseInt(row.online     || 0),
            offline:         parseInt(row.offline    || 0),
            installing:      parseInt(row.installing || 0),
            error:           parseInt(row.error      || 0),
            totalGameservers: parseInt(gsRow.total   || 0)
        };
    }

    static async nameExists(guildId, name, excludeId = null) {
        const dbService = ServiceManager.get('dbService');
        let query = 'SELECT COUNT(*) AS count FROM rootserver WHERE guild_id = ? AND name = ?';
        const params = [guildId, name];
        if (excludeId) { query += ' AND id != ?'; params.push(excludeId); }
        const [row] = await dbService.query(query, params);
        return row.count > 0;
    }

    // =========================================================
    // Quota-Management
    // =========================================================

    static async initializeQuota(rootserverId, config = {}) {
        const dbService = ServiceManager.get('dbService');
        const Logger    = ServiceManager.get('Logger');

        const existing = await dbService.query(
            'SELECT id FROM rootserver_quotas WHERE rootserver_id = ?', [rootserverId]
        );
        if (existing.length > 0) throw new Error('Quota existiert bereits');

        let profileId = config.profileId || null;
        if (!profileId && !config.customRamMB) {
            const QuotaProfile = require('./QuotaProfile');
            const def = await QuotaProfile.getDefault();
            if (def) { profileId = def.id; Logger.info(`[RootServer] Default-Profil: ${def.name}`); }
        }

        // `??` statt `||`: Eine ausdrücklich übergebene 0 ist eine gültige
        // Reserve ("nichts für das Wirtssystem zurückhalten") und wurde vorher
        // stillschweigend zum Standardwert hochgesetzt.
        await dbService.query(
            `INSERT INTO rootserver_quotas
             (rootserver_id, profile_id, custom_ram_mb, custom_cpu_cores, custom_disk_gb,
              reserved_ram_mb, reserved_cpu_cores, reserved_disk_gb)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                rootserverId, profileId,
                config.customRamMB    ?? null, config.customCpuCores   ?? null, config.customDiskGB  ?? null,
                config.reservedRamMB  ?? 2048, config.reservedCpuCores ?? 1,    config.reservedDiskGB ?? 50
            ]
        );
        return this.getQuota(rootserverId);
    }

    /**
     * Stellt sicher, dass ein RootServer eine Quota hat, und gibt sie zurück.
     *
     * Ohne Quota liefert `getAvailableResources()` `hasQuota: false`, und jede
     * Kapazitätsprüfung würde fehlschlagen — ein RootServer ohne Quota-Zeile
     * könnte also gar keinen Gameserver mehr aufnehmen.
     *
     * Angelegt werden **nur die Reserven**. Die Kapazität selbst kommt aus der
     * vom Daemon erkannten Hardware; `rootserver_quotas_effective` löst das auf
     * (custom → erkannt → Profil). Bis zum 2026-08-02 schrieb diese Methode die
     * Hardware-Werte in `custom_*` — dort standen sie dann für immer, und wer
     * RAM nachrüstete, sah die Änderung nie. Ausserdem war danach nicht mehr
     * unterscheidbar, ob eine Zahl erkannt oder eingestellt war.
     *
     * Lag bis zum 2026-08-02 als `autoInitQuota()` im Quotas-Router und stand
     * damit nur der Ressourcen-Seite zur Verfügung.
     *
     * @param {object|number} rootserver - RootServer-Datensatz oder dessen ID
     * @returns {Promise<object|null>} Die effektive Quota
     */
    static async ensureQuota(rootserver) {
        const rs = typeof rootserver === 'object' && rootserver !== null
            ? rootserver
            : await this.getById(rootserver);
        if (!rs) return null;

        const vorhanden = await this.getQuota(rs.id);
        if (vorhanden) return vorhanden;

        try {
            await this.initializeQuota(rs.id, {
                // Reserven für das Wirtssystem — das ist eine Annahme über den
                // Betrieb, keine Hardware-Eigenschaft, und gehört deshalb hierher.
                reservedRamMB:    1024,
                reservedCpuCores: 0,
                reservedDiskGB:   10
            });
        } catch (_) {
            // Parallel angelegt (initializeQuota wirft bei vorhandener Zeile) —
            // das Nachladen unten liefert dann die fremd erzeugte Quota.
        }
        return this.getQuota(rs.id);
    }

    static async getQuota(rootserverId) {
        const dbService = ServiceManager.get('dbService');
        const [row] = await dbService.query(
            'SELECT * FROM rootserver_quotas_effective WHERE rootserver_id = ?', [rootserverId]
        );
        return row || null;
    }

    static async updateQuota(rootserverId, updates) {
        const dbService = ServiceManager.get('dbService');
        const allowed = [
            'profile_id', 'custom_ram_mb', 'custom_cpu_cores', 'custom_disk_gb',
            'custom_max_gameservers', 'reserved_ram_mb', 'reserved_cpu_cores', 'reserved_disk_gb'
        ];
        const fields = []; const values = [];
        for (const [k, v] of Object.entries(updates)) {
            if (allowed.includes(k)) { fields.push(`${k} = ?`); values.push(v); }
        }
        if (fields.length === 0) throw new Error('Keine gültigen Felder');
        values.push(rootserverId);
        await dbService.query(`UPDATE rootserver_quotas SET ${fields.join(', ')} WHERE rootserver_id = ?`, values);
        return this.getQuota(rootserverId);
    }

    static async getAvailableResources(rootserverId) {
        const dbService = ServiceManager.get('dbService');
        const [row] = await dbService.query(
            'SELECT * FROM rootserver_resource_summary WHERE rootserver_id = ?', [rootserverId]
        );
        if (!row) return { available_ram_mb: 0, available_cpu_cores: 0, available_disk_gb: 0, hasQuota: false };
        return {
            available_ram_mb:    row.available_ram_mb    || 0,
            available_cpu_cores: row.available_cpu_cores || 0,
            available_disk_gb:   row.available_disk_gb   || 0,
            total_ram_mb: row.total_ram_mb, total_cpu_cores: row.total_cpu_cores, total_disk_gb: row.total_disk_gb,
            allocated_ram_mb: row.allocated_ram_mb, allocated_cpu_cores: row.allocated_cpu_cores, allocated_disk_gb: row.allocated_disk_gb,
            ram_usage_percent: row.ram_usage_percent, cpu_usage_percent: row.cpu_usage_percent, disk_usage_percent: row.disk_usage_percent,
            gameserver_count: row.gameserver_count, max_gameservers: row.max_gameservers,
            hasQuota: true
        };
    }

    static async checkResourceAvailability(rootserverId, required) {
        const available = await this.getAvailableResources(rootserverId);
        if (!available.hasQuota) return { available: false, reason: 'Kein Quota konfiguriert', missing: null };
        const missing = {}; let ok = true;
        if (required.ramMB    > available.available_ram_mb)    { missing.ram  = { required: required.ramMB,    available: available.available_ram_mb    }; ok = false; }
        if (required.cpuCores > available.available_cpu_cores) { missing.cpu  = { required: required.cpuCores, available: available.available_cpu_cores }; ok = false; }
        if (required.diskGB   > available.available_disk_gb)   { missing.disk = { required: required.diskGB,   available: available.available_disk_gb   }; ok = false; }
        if (available.max_gameservers !== null && available.gameserver_count >= available.max_gameservers) {
            missing.gameserver_limit = { current: available.gameserver_count, max: available.max_gameservers }; ok = false;
        }
        return { available: ok, missing: Object.keys(missing).length > 0 ? missing : null, current: available };
    }

    static async getResourceSummaryByGuild(guildId) {
        const dbService = ServiceManager.get('dbService');
        if (!await dbService.tableExists('rootserver_resource_summary')) {
            return await dbService.query(
                `SELECT r.id AS rootserver_id, r.name AS rootserver_name, r.guild_id,
                    NULL AS total_ram_mb, NULL AS total_cpu_cores, NULL AS total_disk_gb,
                    0 AS allocated_ram_mb, 0 AS allocated_cpu_cores, 0 AS allocated_disk_gb,
                    0 AS available_ram_mb, 0 AS available_cpu_cores, 0 AS available_disk_gb,
                    0 AS ram_usage_percent, 0 AS cpu_usage_percent, 0 AS disk_usage_percent,
                    0 AS gameserver_count, NULL AS max_gameservers,
                    NULL AS profile_name, NULL AS profile_display_name
                 FROM rootserver r WHERE r.guild_id = ? ORDER BY r.name`,
                [guildId]
            );
        }
        return await dbService.query(
            'SELECT * FROM rootserver_resource_summary WHERE guild_id = ? ORDER BY rootserver_name',
            [guildId]
        );
    }

    static async getGameserverCounts(rootserverId) {
        const dbService = ServiceManager.get('dbService');
        if (!await dbService.tableExists('gameservers')) return { total: 0, running: 0, stopped: 0 };
        const [row] = await dbService.query(
            // Statuswerte laut ENUM in `gameservers`: installing, installed,
            // starting, online, stopping, offline, error, updating. Hier stand
            // bis zum 2026-08-02 'running'/'stopped' — Werte, die die Spalte nie
            // annimmt; beide Zaehler meldeten deshalb immer 0.
            `SELECT COUNT(*) AS total,
                SUM(CASE WHEN status = 'online'  THEN 1 ELSE 0 END) AS running,
                SUM(CASE WHEN status = 'offline' THEN 1 ELSE 0 END) AS stopped
             FROM gameservers WHERE rootserver_id = ?`,
            [rootserverId]
        );
        return { total: parseInt(row.total || 0), running: parseInt(row.running || 0), stopped: parseInt(row.stopped || 0) };
    }
}

module.exports = RootServer;
