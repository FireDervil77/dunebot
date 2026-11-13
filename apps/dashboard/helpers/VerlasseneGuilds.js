'use strict';

/**
 * Verlassene Guilds löschen (G-04d, K381, F-G3 C, 2026-11-13).
 *
 * Fliegt der Bot aus einer Guild oder geht er, setzt der Bot `guilds.left_at`
 * (`GuildManager.removeGuild`) und stößt dieses Modul über IPC an
 * (`core:VERLASSEN_ANSTOSS`). Gelöscht wird hier, sofort, über
 * `Datenauskunft.guildLoeschen`, denselben Weg wie „Server löschen“ unter
 * Einstellungen → Allgemein:
 *
 * 1. Jedes eingeschaltete Plugin über `disableInGuild` abschalten. gameserver
 *    löscht dabei seine Server über `Loeschung` (Container gestoppt, Ports,
 *    Dateien und Datenbanken freigegeben), masterserver kommt zuletzt.
 * 2. Die `guildInhalte.loeschen` aller Plugins und zuletzt die des Kerns, in
 *    einer Transaktion. Die Zeile in `guilds` geht als letzte.
 *
 * Bis dahin löschte der Bot selbst über `SHOW TABLES` aus jeder Tabelle mit
 * `guild_id`. Gameserver-Zeilen gingen dabei ohne Stoppen (K381), und die
 * Kontroll-Guild war nicht ausgenommen.
 *
 * # Die Zeile ist der Auftrag
 *
 * Eine Guild mit `left_at` ist noch nicht gelöscht. Ist sie gelöscht, gibt es
 * ihre Zeile nicht mehr. Deshalb geht nichts verloren, wenn der Anstoß
 * ausfällt (Dashboard aus, IPC weg) oder das Löschen scheitert (ein Gameserver
 * kommt nicht herunter, ein Daemon ist weg): Die Zeile bleibt stehen, und der
 * nächste Lauf versucht es wieder.
 *
 * Läufe: auf jeden Anstoß des Bots, `START_MS` nach dem Start des Dashboards
 * (dann sind die Daemons wieder verbunden, sonst scheiterte jeder Gameserver)
 * und danach stündlich. Es läuft immer nur ein Lauf, Guild für Guild.
 *
 * # Was nicht gelöscht wird
 *
 * - **Die Kontroll-Guild.** Ihr gehören die Rootserver. Verliert der Bot sie,
 *   steht das jeden Lauf als Fehler im Log, gelöscht wird nichts.
 * - **Eine Guild, die der Bot wieder betreten hat.** `registerGuild` setzt
 *   `left_at` zurück. Unmittelbar vor dem Löschen wird nachgesehen.
 * - **Was die Erklärungen behalten:** `user_feedback` (Kern), `donations`
 *   (Beleg, G-05), öffentliche Pakete in `addon_marketplace`.
 *
 * # Was es nicht kann
 *
 * Betritt der Bot die Guild wieder, **während** gelöscht wird, geht die
 * frische Zeile in `guilds` mit. Der nächste Start des Bots legt sie wieder an
 * (`syncGuild`), leer wie eine neue Guild.
 *
 * @module apps/dashboard/helpers/VerlasseneGuilds
 */

const { ServiceManager } = require('dunebot-core');
const Datenauskunft = require('./Datenauskunft');

/** Erster Lauf nach dem Start: Die Daemons brauchen eine Weile, bis sie wieder verbunden sind. */
const START_MS = 2 * 60 * 1000;
/** Danach stündlich, für alles, was gescheitert ist. */
const TAKT_MS = 60 * 60 * 1000;
const ANLASS = 'Bot hat die Guild verlassen';

let uhr = null;
let laeuft = false;
let nochmal = false;
/** Letzter Lauf, für das Log und den Wächter. */
let letzter = null;

const db = () => ServiceManager.get('dbService');
const log = () => ServiceManager.get('Logger');
const kontrollGuild = () => String(process.env.CONTROL_GUILD_ID || '');

/**
 * Was abgeschaltet wurde, je Plugin, in einer Zeile.
 *
 * @param {Object[]} abgeschaltet aus `guildLoeschen`
 * @returns {string}
 */
function abgeschaltetText(abgeschaltet) {
    return abgeschaltet.map(a => a.ok
        ? `${a.plugin}${a.hinweis ? ` (${a.hinweis})` : ''}`
        : `${a.plugin} GESCHEITERT: ${a.fehler}`).join(', ') || 'keine';
}

/**
 * Was gelöscht wurde, je Plugin und Tabelle, in einer Zeile.
 *
 * @param {Object<string, Object<string, number>>} geloescht aus `guildLoeschen`
 * @returns {string}
 */
function geloeschtText(geloescht) {
    return Object.entries(geloescht)
        .map(([p, t]) => `${p}: ${Object.entries(t).map(([tab, n]) => `${tab} ${n}`).join(', ')}`)
        .join(' · ') || 'keine Zeilen';
}

/**
 * Eine Guild löschen und die Rückmeldung je Plugin ins Log schreiben.
 *
 * @param {{_id: string, guild_name: string|null}} g
 * @returns {Promise<'geloescht'|'zurueck'|'gescheitert'>}
 */
async function eine(g) {
    const name = `„${g.guild_name || '?'}“ (${g._id})`;
    // Unmittelbar vorher: Ist der Bot inzwischen zurück, bleibt alles.
    const [jetzt] = await db().query('SELECT left_at FROM guilds WHERE _id = ?', [g._id]);
    if (!jetzt?.left_at) {
        log().info(`[Verlassen] Guild ${name}: Der Bot ist wieder dort, nichts gelöscht`);
        return 'zurueck';
    }
    let erg;
    try {
        erg = await Datenauskunft.guildLoeschen(g._id, { anlass: ANLASS });
    } catch (e) {
        log().error(`[Verlassen] Guild ${name}: Löschen gescheitert, die Zeile bleibt für den nächsten Lauf`, e);
        return 'gescheitert';
    }
    if (!erg.ok) {
        log().error(`[Verlassen] Guild ${name}: nicht gelöscht, nächster Versuch spätestens in einer Stunde. ` +
            `Grund: ${erg.fehler}. Abgeschaltet: ${abgeschaltetText(erg.abgeschaltet)}`);
        return 'gescheitert';
    }
    log().info(`[Verlassen] Guild ${name} gelöscht. Abgeschaltet: ${abgeschaltetText(erg.abgeschaltet)}. ` +
        `Zeilen: ${geloeschtText(erg.geloescht)}`);
    return 'geloescht';
}

/**
 * Ein Lauf über alle Guilds mit `left_at`. Läuft schon einer, folgt direkt
 * danach ein weiterer (der Anstoß kam vielleicht für eine Guild, die der
 * laufende nicht mehr sah).
 *
 * @returns {Promise<{geloescht: number, zurueck: number, gescheitert: number, kontrollGuild: boolean}|null>}
 *          null, wenn schon ein Lauf ging
 */
async function lauf() {
    if (laeuft) { nochmal = true; return null; }
    laeuft = true;
    const stand = { geloescht: 0, zurueck: 0, gescheitert: 0, kontrollGuild: false };
    try {
        do {
            nochmal = false;
            const offen = await db().query(
                'SELECT _id, guild_name FROM guilds WHERE left_at IS NOT NULL ORDER BY left_at, _id');
            for (const g of offen) {
                if (String(g._id) === kontrollGuild()) {
                    stand.kontrollGuild = true;
                    log().error(`[Verlassen] Der Bot ist nicht mehr in der Kontroll-Guild (${g._id}). ` +
                        'Ihre Inhalte werden nicht gelöscht. Bot wieder einladen.');
                    continue;
                }
                stand[await eine(g)]++;
            }
        } while (nochmal);
    } catch (e) {
        log().error('[Verlassen] Lauf gescheitert', e);
    } finally {
        laeuft = false;
    }
    letzter = { zeit: new Date(), ...stand };
    return stand;
}

/** Sofort einen Lauf (Anstoß des Bots). Wartet nicht. */
function wecken() {
    lauf();
}

/** Nach dem Laden der Plugins: erster Lauf nach `START_MS`, dann stündlich. */
function starten() {
    if (uhr) return;
    ServiceManager.register('verlasseneGuilds', module.exports);
    setTimeout(() => {
        lauf();
        uhr = setInterval(() => { lauf(); }, TAKT_MS);
        uhr.unref();
    }, START_MS).unref();
    log().info(`[Verlassen] Aufräumer bereit (erster Lauf in ${START_MS / 60000} min, dann stündlich, sofort auf Anstoß des Bots)`);
}

module.exports = { starten, wecken, lauf, letzter: () => letzter, START_MS, TAKT_MS, ANLASS };
