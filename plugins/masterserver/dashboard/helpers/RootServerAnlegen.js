'use strict';
/**
 * Einen RootServer anlegen — für das Formular im Dashboard UND für
 * `/daemon register` im Bot.
 *
 * ## Warum es diese Datei gibt (2026-11-06)
 *
 * Es gab zwei Wege mit verschiedenem Ergebnis. Das Formular
 * (`POST /rootservers`) fragt nur Absicht ab, lässt die Hardware leer, weil der
 * Daemon sie misst, legt bei verbundenem Daemon die Verzeichnisse an und gibt
 * Busadresse und `daemon.yaml` zurück. `/daemon register` verlangte RAM und
 * Platte von Hand, kannte keine IP, keine Domain, kein SFTP, keine
 * Datenbanken, keine Busadresse und verwies auf eine `daemon.yaml`, die er nie
 * lieferte. Betreiber: Der Befehl soll „eher dem Wizard im Dashboard ähneln".
 * Jetzt rufen beide diese Funktion.
 *
 * Die `daemon.yaml` stand bis dahin im Browser (`guild.js`). Sie wird jetzt
 * hier gebaut, damit der Bot dieselbe Datei verschicken kann.
 */
const { ServiceManager } = require('dunebot-core');
const RootServer = require('../models/RootServer');
const Maschinenbefund = require('./Maschinenbefund');
const { busAdresse } = require('../../../../apps/dashboard/helpers/BusAdresse');

/**
 * Datenbanken je Gameserver: eine ganze Zahl von 0 bis 20; mit Häkchen
 * mindestens 1. Auch für das Bearbeiten eines RootServers.
 *
 * @param {boolean} gewuenscht
 * @param {*} jeServer
 * @returns {string|null} Fehlertext oder null
 */
function dbGrenzeFehler(gewuenscht, jeServer) {
    const n = Number(String(jeServer ?? '').trim());
    if (!Number.isInteger(n) || n < 0 || n > 20) return 'Datenbanken je Gameserver: eine ganze Zahl von 0 bis 20.';
    if (gewuenscht && n < 1) return 'Mit Datenbanken braucht jeder Gameserver mindestens eine.';
    return null;
}

const jaNein = (wert) => wert === 'true' || wert === true;

/**
 * Die fertige `daemon.yaml` für einen neuen RootServer.
 *
 * @param {{daemonId: string, apiKey: string, host: ?string, busAdresse: string}} d
 * @returns {string}
 */
function daemonYaml(d) {
    const bindIpLine = d.host ? `  bind_ip: "${d.host}"` : '  bind_ip: ""  # Leer = alle Interfaces (0.0.0.0)';
    return [
        '# FireBot Daemon Konfiguration',
        '# Generiert vom Dashboard – bitte auf deinen Server kopieren',
        '# Pfad: /opt/firebot-daemon/daemon.yaml',
        '',
        'daemon:',
        `  name: "rootserver-${d.daemonId ? d.daemonId.substring(0, 8) : 'neu'}"`,
        '',
        '  # Daemon-ID – Eindeutige ID aus dem Dashboard (NICHT ändern!)',
        `  daemon_id: "${d.daemonId || ''}"`,
        '',
        '  # Setup-Token vom Dashboard – NUR EINMAL SICHTBAR!',
        '  # Er fährt nie über die Leitung: Aus ihm entsteht der Schlüssel, mit dem Daemon und Dashboard ihre Nachrichten versiegeln.',
        `  token: "${d.apiKey || ''}"`,
        '',
        'dashboard:',
        `  url: "${d.busAdresse || ''}"`,
        '',
        'logging:',
        '  level: "info"',
        '  file: "logs/daemon.log"',
        '',
        'gameserver:',
        '  # Port-Allocations werden über das Dashboard verwaltet',
        '',
        'filesystem:',
        '  base_directory: "/var/lib/firebot-daemon/volumes"',
        '  auto_create_base: true',
        '',
        'docker:',
        '  socket: "/var/run/docker.sock"',
        '  network: "firebot"',
        '  # Bind-IP: Gameserver-Ports werden NUR auf dieser IP geöffnet.',
        '  # Wichtig bei Servern mit mehreren öffentlichen IPs!',
        bindIpLine,
        '  dns:',
        '    - "1.1.1.1"',
        '    - "8.8.8.8"',
    ].join('\n');
}

/** Der Befehl, mit dem der Installer auf der Maschine startet. */
function installBefehl() {
    return `curl -fsSL ${process.env.DASHBOARD_BASE_URL || ''}/downloads/daemon/install.sh | sudo bash`;
}

/**
 * Legt einen RootServer an.
 *
 * Was das Formular seit M-6 noch fragt, ist nur ABSICHT. `cpuCores`,
 * `ramTotal` und `diskTotal` sind entfallen: Die Maschine misst sie beim
 * ersten Verbinden genauer, als sie jemand tippen kann. `hostname` ebenso,
 * geblieben ist `fqdn` als Wunsch, den eine Messung bestätigt oder nicht.
 * `dbGewuenscht`/`dbJeServer` ersetzen `mysqlEnabled`/`mysqlDbLimit`, die das
 * INSERT nie kannte.
 *
 * @param {Object} a
 * @param {string} a.guildId
 * @param {?string} a.ownerUserId Discord-ID des Anlegenden
 * @param {Object} a.felder Wie der Body des Formulars
 * @returns {Promise<{ok: true, data: Object} | {ok: false, status: number, fehler: string}>}
 */
async function anlegen({ guildId, ownerUserId, felder }) {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');

    const {
        name, host, description,
        quotaProfileId,
        backupLimit,
        fqdn, fastdlEnabled,
        dbGewuenscht, dbJeServer,
        sftpGewuenscht, sftpPort
    } = felder || {};

    if (!name || !host) {
        return { ok: false, status: 400, fehler: 'Pflichtfelder fehlen: Name und IP-Adresse' };
    }
    // Spielports gibt es beim Anlegen noch nicht — der Bereich wird danach vergeben.
    const sftpPortFehler = Maschinenbefund.sftpPortFehler(sftpPort, null);
    if (sftpPortFehler) return { ok: false, status: 400, fehler: sftpPortFehler };
    const dbAnlegen = jaNein(dbGewuenscht);
    const dbFehler = dbGrenzeFehler(dbAnlegen, dbJeServer ?? 0);
    if (dbFehler) return { ok: false, status: 400, fehler: dbFehler };

    // Guild-ID auf 10 Zeichen kürzen (Linux Username Limit bei System-Usern).
    // Der Daemon fügt das Präfix "gs-" an.
    const systemUser = `guild_${guildId.substring(0, 10)}`;

    const result = await RootServer.create({
        guildId,
        ownerUserId: ownerUserId || null,
        name,
        host,
        systemUser,
        baseDirectory: '/opt/firebot',
        description: description || null,
        fqdn: fqdn || null,
        fastdlEnabled: jaNein(fastdlEnabled),
        // Datenbanken: Wunsch und Grenze. Ob es geht, entscheidet der Befund
        // der Maschine — nicht dieses Häkchen.
        dbGewuenscht: dbAnlegen,
        dbJeServer: Number(dbJeServer ?? 0),
        // SFTP für externe Programme (2026-10-27): Wunsch, geht an den Wizard.
        sftpGewuenscht: jaNein(sftpGewuenscht),
        sftpPortWunsch: String(sftpPort ?? '').trim() ? Number(sftpPort) : null,
        // Hardware bleibt leer: Der Daemon meldet sie beim ersten Verbinden.
        cpuCores: null,
        cpuThreads: null,
        cpuModel: null,
        ramTotalGb: null,
        diskTotalGb: null,
        backupLimit: parseInt(backupLimit) || 3
    });

    Logger.info(`[Masterserver] RootServer created: ${result.id} (${result.daemonId}) by ${systemUser}`);

    // Virtual Server im Daemon erstellen (wenn Daemon online)
    const ipmServer = ServiceManager.get('ipmServer');
    const rows = await RootServer.getByGuild(guildId);
    const daemon = rows[0] || null;

    if (daemon && ipmServer.isDaemonOnline(daemon.daemon_id)) {
        try {
            Logger.info(`[Masterserver] Erstelle Virtual Server für RootServer ${result.id} im Daemon...`);
            // Neue Filesystem-Struktur: {base_dir}/{username}/rootserver_{id}/
            //
            // Hier standen bis zum 2026-08-20 vier weitere Felder:
            // ram_limit_gb, disk_limit_gb, mysql_enabled, web_domain.
            // `handleVirtualCreate` im Daemon liest genau fünf Schlüssel —
            // daemon_id/server_id, server_name, username, rootserver_id,
            // guild_id. Die vier anderen sind nie angekommen.
            const vServerResponse = await ipmServer.sendCommand(daemon.daemon_id, 'virtual.create', {
                daemon_id: daemon.daemon_id,
                rootserver_id: result.id,
                guild_id: guildId,
                server_name: name,
                username: systemUser,
                custom_path: null
            }, 180000);  // 3 Minuten Timeout (SteamCMD Installation!)

            if (vServerResponse.success) {
                Logger.success(`[Masterserver] Virtual Server erstellt: ${vServerResponse.data?.server_path || 'unknown'}`);
                await RootServer.updateInstallStatus(result.daemonId, 'completed');
            } else {
                Logger.error(`[Masterserver] Virtual Server Setup fehlgeschlagen: ${vServerResponse.error}`);
                // Nicht kritisch - User kann Setup später manuell triggern
            }
        } catch (vServerError) {
            Logger.error('[Masterserver] Virtual Server Creation Error:', vServerError);
            // Nicht kritisch - RootServer wurde erstellt, Virtual Server kann später erstellt werden
        }
    } else {
        Logger.warn('[Masterserver] Daemon offline - Virtual Server muss später erstellt werden');
    }

    // Quota-Profil zuweisen (wenn vorhanden UND nicht "none")
    if (quotaProfileId && quotaProfileId !== '' && quotaProfileId !== 'none') {
        try {
            const [profile] = await dbService.query(
                'SELECT * FROM quota_profiles WHERE id = ?',
                [quotaProfileId]
            );

            if (profile) {
                await dbService.query(
                    `INSERT INTO rootserver_quotas
                     (rootserver_id, profile_id, custom_ram_mb, custom_cpu_cores, custom_disk_gb, created_at, updated_at)
                     VALUES (?, ?, NULL, NULL, NULL, NOW(), NOW())`,
                    [result.id, quotaProfileId]
                );
                Logger.info(`[Masterserver] Quota Profile ${quotaProfileId} assigned to RootServer ${result.id}`);
            }
        } catch (quotaError) {
            Logger.error('[Masterserver] Quota assignment failed:', quotaError);
            // Nicht kritisch - RootServer wurde erstellt
        }
    }

    const daten = {
        id: result.id,
        daemonId: result.daemonId,
        apiKey: result.apiKey,
        host: host || null,
        busAdresse: busAdresse(),
    };
    daten.daemonYaml = daemonYaml(daten);
    daten.installBefehl = installBefehl();
    return { ok: true, data: daten };
}

module.exports = { anlegen, daemonYaml, installBefehl, dbGrenzeFehler };
