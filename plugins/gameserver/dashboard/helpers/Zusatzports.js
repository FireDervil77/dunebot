'use strict';
/**
 * Ports, die erst ein Mod mitbringt — vor jedem Start abgleichen.
 *
 * ── Warum es das gibt (Baustelle 156, 2026-09-24) ───────────────────────────
 *
 * Server 202 lief mit dem Modpack Cave Horror, darin Simple Voice Chat. Die Mod
 * startet ihren Sprachserver auf 24454/udp — der Container gab aber nur Spiel-
 * und RCON-Port frei. Kein Fehler, nirgends; die Mitspieler hoeren sich einfach
 * nicht.
 *
 * Betreiber: *„ja das es sowas gibt sollte mit ins paket. die modwahl vom
 * server natürlich am besten automatisch."*
 *
 * ── Wie ──────────────────────────────────────────────────────────────────────
 *
 * Das Paket nennt den Port mit `needed_by`, einem Dateimuster ab der Wurzel des
 * Volumes (`game/mods/voicechat-*.jar`). Vor jedem Start:
 *
 *   Datei da,   Port fehlt   → einen freien aus `port_allocations` buchen
 *   Datei weg,  Port gebucht → freigeben
 *
 * und `gameservers.ports` nachziehen. Der Daemon gibt jeden Port aus dieser
 * Karte im Container frei und setzt ihn per `config[]` in die Datei der Mod.
 *
 * Gesehen wird die PLATTE (Dateiliste vom Daemon), nicht `gameserver_content`:
 * Eine Mod, die per Dateimanager kam, steht dort nicht — und haette dann keinen
 * Port, ohne dass es jemand merkt.
 *
 * ── Was hier NICHT passiert ─────────────────────────────────────────────────
 *
 * Laesst sich die Liste nicht holen (Daemon weg, keine Antwort), bleibt die
 * Buchung, wie sie ist: Ein Port wird nicht freigegeben, nur weil gerade
 * niemand nachsehen konnte. Ein fehlender Ordner ist dagegen eine Antwort —
 * dort liegt keine Mod.
 *
 * @module helpers/Zusatzports
 */

const { ServiceManager } = require('dunebot-core');

/** `game/mods/voicechat-*.jar` → { ordner: 'game/mods', muster: /^voicechat-.*\.jar$/ } */
function zerlegeMuster(neededBy) {
    const text = String(neededBy || '').replace(/^\/+/, '');
    const schnitt = text.lastIndexOf('/');
    const ordner = schnitt >= 0 ? text.slice(0, schnitt) : '';
    const name = schnitt >= 0 ? text.slice(schnitt + 1) : text;
    const quelle = name.split('*').map(t => t.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
    return { ordner, muster: new RegExp('^' + quelle + '$') };
}

/** Die Ports eines Pakets, die nur bei Bedarf gebucht werden. */
function bedarfsports(paket) {
    return (Array.isArray(paket?.ports) ? paket.ports : [])
        .filter(p => p && p.needed_by && p.assign === 'pool');
}

/**
 * Der Ordner fehlt — das ist eine Antwort, kein Fehler.
 *
 * Der Wortlaut ist der des Daemons (`HandleFileList` in
 * internal/gameserver/files.go: „verzeichnis nicht gefunden: %s"), nachgesehen
 * und nicht geraten. Aendert er sich dort, faellt der Fall hier auf „nicht
 * lesbar" — die Buchung bleibt dann stehen, statt still zu verschwinden.
 */
function istNichtDa(fehler) {
    return /verzeichnis nicht gefunden/i.test(String(fehler || ''));
}

/**
 * Den Bedarf abgleichen und buchen bzw. freigeben.
 *
 * @param {{server: object, paket: object}} auftrag
 *        `server` braucht id, rootserver_id, install_path, daemon_id, ports
 * @returns {Promise<{geaendert: boolean, ports: object, gebucht: Array, freigegeben: Array, hinweise: string[]}>}
 */
async function gleicheAb({ server, paket }) {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');

    const ports = (() => {
        if (!server.ports) return {};
        if (typeof server.ports === 'object') return { ...server.ports };
        try { return JSON.parse(server.ports) || {}; } catch { return {}; }
    })();
    const ergebnis = { geaendert: false, ports, gebucht: [], freigegeben: [], hinweise: [] };

    const bedarf = bedarfsports(paket);
    if (bedarf.length === 0) return ergebnis;

    const ipmServer = ServiceManager.has('ipmServer') ? ServiceManager.get('ipmServer') : null;
    if (!ipmServer || !server.daemon_id || !ipmServer.isDaemonOnline(server.daemon_id)) {
        ergebnis.hinweise.push('Zusatzports nicht abgeglichen: Daemon nicht erreichbar');
        return ergebnis;
    }

    // Je Ordner einmal fragen — zwei Ports im selben Ordner kosten eine Liste.
    const listen = new Map();
    const liste = async (ordner) => {
        if (listen.has(ordner)) return listen.get(ordner);
        const antwort = await ipmServer.sendCommand(server.daemon_id, 'gameserver.files.list', {
            server_id: String(server.id),
            rootserver_id: String(server.rootserver_id),
            install_path: server.install_path,
            path: '/' + ordner,
        }, 15000).catch(fehler => ({ success: false, error: fehler.message }));

        let namen = null;
        if (antwort?.success) {
            namen = (antwort.data?.files || []).filter(f => !f.is_dir).map(f => f.name);
        } else if (istNichtDa(antwort?.error)) {
            namen = [];
        }
        listen.set(ordner, { namen, fehler: antwort?.error });
        return listen.get(ordner);
    };

    for (const port of bedarf) {
        const zweck = port.purpose;
        const { ordner, muster } = zerlegeMuster(port.needed_by);
        const { namen, fehler } = await liste(ordner);

        if (namen === null) {
            Logger.warn(`[Gameserver/Zusatzports] Server ${server.id}: ${ordner}/ nicht lesbar `
                + `(${fehler || 'keine Antwort'}) — „${zweck}" bleibt, wie er ist`);
            ergebnis.hinweise.push(`„${zweck}" nicht geprueft: ${ordner}/ nicht lesbar`);
            continue;
        }

        const treffer = namen.find(n => muster.test(n));

        if (treffer && !ports[zweck]) {
            const [frei] = await dbService.query(
                `SELECT id, port FROM port_allocations
                  WHERE rootserver_id = ? AND server_id IS NULL
                  ORDER BY port ASC LIMIT 1`,
                [server.rootserver_id]);
            if (!frei) {
                Logger.warn(`[Gameserver/Zusatzports] Server ${server.id}: ${treffer} braucht einen `
                    + `Port für „${zweck}", im Vorrat der Maschine ist keiner frei`);
                ergebnis.hinweise.push(`${treffer} braucht einen Port für „${zweck}" — kein freier im Vorrat`);
                continue;
            }
            // `server_id IS NULL` auch im UPDATE: Zwischen Lesen und Schreiben
            // kann ein anderes Anlegen dieselbe Zeile genommen haben.
            const r = await dbService.query(
                'UPDATE port_allocations SET server_id = ?, assigned_at = NOW() WHERE id = ? AND server_id IS NULL',
                [server.id, frei.id]);
            if (!r || r.affectedRows !== 1) {
                ergebnis.hinweise.push(`„${zweck}": Port ${frei.port} wurde gleichzeitig vergeben — beim nächsten Start erneut`);
                continue;
            }
            const nummer = Number(frei.port);
            ports[zweck] = { internal: nummer, external: nummer, protocol: port.protocol || 'udp' };
            ergebnis.gebucht.push({ zweck, port: nummer, wegen: treffer });
            ergebnis.geaendert = true;
            Logger.info(`[Gameserver/Zusatzports] Server ${server.id}: ${treffer} → „${zweck}" auf Port ${nummer}`);
        } else if (!treffer && ports[zweck]) {
            const nummer = Number(ports[zweck].external ?? ports[zweck].internal ?? ports[zweck]);
            await dbService.query(
                `UPDATE port_allocations SET server_id = NULL, assigned_at = NULL
                  WHERE rootserver_id = ? AND port = ? AND server_id = ?`,
                [server.rootserver_id, nummer, server.id]);
            delete ports[zweck];
            ergebnis.freigegeben.push({ zweck, port: nummer });
            ergebnis.geaendert = true;
            Logger.info(`[Gameserver/Zusatzports] Server ${server.id}: nichts mehr auf ${port.needed_by} — `
                + `„${zweck}" (Port ${nummer}) freigegeben`);
        }
    }

    if (ergebnis.geaendert) {
        await dbService.query('UPDATE gameservers SET ports = ? WHERE id = ?',
            [JSON.stringify(ports), server.id]);
    }
    return ergebnis;
}

module.exports = { gleicheAb, bedarfsports, zerlegeMuster };
