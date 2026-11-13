'use strict';

/**
 * Zeitplan-Register (G-06, K382, 2026-11-13).
 *
 * Wiederkehrende Aufgaben aller Plugins an einer Stelle statt je Plugin ein
 * eigener `node-cron`. Eingetragen wird über das SDK:
 *
 *     const { Zeitplan } = require('dunebot-sdk');
 *     Zeitplan.eintragen('leveling:saisonwechsel', '5 0 * * *', async ({ anlass }) => {
 *         …
 *         return '3 Saisons gewechselt';   // erscheint unter /admin/zeitplan
 *     });
 *
 * - **Name** `plugin:aufgabe`, klein. Der Teil vor dem Doppelpunkt ist das
 *   Plugin, dem die Aufgabe gehört (Kern: `core`). `scripts/check-zeitplan.js`
 *   prüft, dass er zum Ordner der Datei passt.
 * - **Takt** als Cron-Ausdruck mit fünf Feldern, Zeitzone Europe/Berlin. Ohne
 *   Sekundenfeld: Was öfter als einmal je Minute läuft, gehört nicht hierher.
 * - **Ein Lauf zur Zeit je Name.** Ist der Takt wieder dran, während der
 *   vorige Lauf noch geht, fällt der neue aus (`uebersprungen`, Warnung im
 *   Log). Dasselbe gilt für „Jetzt ausführen“ unter /admin.
 * - **Nachholen** (Vorgabe an): War das Dashboard aus, als die Aufgabe dran
 *   war, oder ist es mitten im Lauf gestorben, läuft sie nach dem Start einmal
 *   nach (`NACHHOLEN_MS` später, dann sind Bot und Daemons wieder verbunden).
 *   Nur einmal, auch wenn mehrere Termine verpasst sind, und nur, wenn der
 *   Takt gleich geblieben ist. Wer das nicht will: `{ nachholen: false }`.
 * - **Frist** (`frist_min`, Vorgabe 60): Läuft ein Lauf länger, steht das als
 *   Fehler im Log und unter /admin. Abgebrochen wird er nicht, JavaScript
 *   kann das nicht. Der nächste Takt fällt aus, bis er fertig ist.
 * - **Der Handler prüft selbst, ob es etwas zu tun gibt.** Nachgeholt, von
 *   Hand gestartet oder nach einem Absturz wiederholt: Ein Lauf kann einmal
 *   mehr kommen als gedacht. Er bekommt `{ name, anlass, start }`, `anlass`
 *   ist `takt`, `nachgeholt` oder `von_hand`. Wirft er, zählt das als Fehler;
 *   seine Rückgabe (Text oder Objekt) wird gekürzt als Ergebnis gespeichert.
 *
 * Neu eintragen unter demselben Namen ersetzt die Aufgabe (Plugin neu
 * geladen). Ein laufender Lauf behält seine Sperre.
 *
 * Nur im Dashboard. Braucht der Bot einen Takt, trägt das Dashboard ihn ein
 * und lässt den Bot über IPC ausführen.
 *
 * Bestehende Taktgeber (Toast-Logs in `index.js`, `gameserver/CronWorker.js`,
 * `streaming/kern/takt.js`, Meldungen in `app.js`) bleiben, bis ohnehin an
 * ihnen gearbeitet wird (Konzept G-06). Neue kommen hierher.
 *
 * @module apps/dashboard/helpers/Zeitplan
 */

const cron = require('node-cron');
const { ServiceManager } = require('dunebot-core');

const NAME = /^([a-z0-9][a-z0-9_-]{0,31}):([a-z0-9][a-z0-9_-]{0,62})$/;
const ZEITZONE = 'Europe/Berlin';
const TEXT_MAX = 500;
const FRIST_MIN = 60;
/** Nachholen erst nach dem Start: Bot und Daemons brauchen eine Weile. */
const NACHHOLEN_MS = 2 * 60 * 1000;
const ABGEBROCHEN = 'abgebrochen: Das Dashboard wurde während des Laufs beendet';

/** name → Aufgabe */
const AUFGABEN = new Map();
/** name → `{ seit, anlass }`; getrennt von der Aufgabe, damit neu eintragen die Sperre nicht verliert. */
const LAEUFT = new Map();
/** Namen, deren Lauf der letzte Neustart abgebrochen hat. */
let abgebrochen = new Set();
/** Promise von `starten()`; bis dahin wird nichts eingeplant. */
let bereit = null;
let nachholenMs = NACHHOLEN_MS;

const db = () => ServiceManager.get('dbService');
const log = () => ServiceManager.get('Logger');

/**
 * Kurzer Text für die Tabelle.
 *
 * @param {*} wert Rückgabe des Handlers oder Fehlermeldung
 * @returns {string|null}
 */
function kurz(wert) {
    if (wert === undefined || wert === null || wert === '') return null;
    let t;
    if (typeof wert === 'string') t = wert;
    else {
        try { t = JSON.stringify(wert); } catch { t = String(wert); }
    }
    return t.length > TEXT_MAX ? `${t.slice(0, TEXT_MAX - 1)}…` : t;
}

/**
 * In die Tabelle schreiben. Scheitert das (Migration fehlt, Datenbank weg),
 * läuft die Aufgabe trotzdem; das Log sagt es.
 *
 * @param {string} sql
 * @param {Array} params
 */
async function schreiben(sql, params) {
    try {
        await db().query(sql, params);
    } catch (e) {
        log().warn(`[Zeitplan] Stand nicht gespeichert: ${e.message}`);
    }
}

/**
 * Ein Lauf. Wirft nie.
 *
 * @param {Object} a Aufgabe
 * @param {'takt'|'nachgeholt'|'von_hand'} anlass
 * @returns {Promise<{ok: boolean, uebersprungen?: boolean, dauer_ms?: number, ergebnis?: string|null, fehler?: string}>}
 */
async function ausloesen(a, anlass) {
    const sperre = LAEUFT.get(a.name);
    if (sperre) {
        log().warn(`[Zeitplan] ${a.name}: ${anlass} fällt aus, der Lauf von ${sperre.seit.toISOString()} (${sperre.anlass}) geht noch`);
        await schreiben('UPDATE zeitplan_laeufe SET uebersprungen = uebersprungen + 1 WHERE name = ?', [a.name]);
        return { ok: false, uebersprungen: true };
    }
    const start = new Date();
    LAEUFT.set(a.name, { seit: start, anlass });
    await schreiben(
        `UPDATE zeitplan_laeufe SET zustand = 'laeuft', letzter_start = ?, letzter_anlass = ?, naechster_lauf = ?
          WHERE name = ?`,
        [start, anlass, a.task.getNextRun(), a.name]);

    const fristUhr = setTimeout(() => {
        const text = `läuft länger als ${a.frist_min} min (seit ${start.toISOString()})`;
        log().error(`[Zeitplan] ${a.name} ${text}. Der nächste Takt fällt aus, bis er fertig ist.`);
        schreiben('UPDATE zeitplan_laeufe SET letzter_fehler = ?, letzter_fehler_am = NOW(3) WHERE name = ?', [text, a.name]);
    }, a.frist_min * 60 * 1000);
    fristUhr.unref();

    let ergebnis = null;
    let fehler = null;
    try {
        ergebnis = kurz(await a.handler({ name: a.name, anlass, start }));
    } catch (e) {
        fehler = e instanceof Error ? e : new Error(String(e));
    }
    clearTimeout(fristUhr);
    const dauer = Date.now() - start.getTime();
    LAEUFT.delete(a.name);

    if (fehler) {
        log().error(`[Zeitplan] ${a.name} (${anlass}) gescheitert nach ${dauer} ms`, fehler);
        await schreiben(
            `UPDATE zeitplan_laeufe SET zustand = 'bereit', laeufe = laeufe + 1, fehler = fehler + 1,
                    letzte_dauer_ms = ?, letzter_fehler = ?, letzter_fehler_am = NOW(3), naechster_lauf = ?
              WHERE name = ?`,
            [dauer, kurz(fehler.message) || 'ohne Meldung', a.task.getNextRun(), a.name]);
        return { ok: false, dauer_ms: dauer, fehler: fehler.message };
    }
    const zeile = `[Zeitplan] ${a.name} (${anlass}) fertig in ${dauer} ms${ergebnis ? `: ${ergebnis}` : ''}`;
    if (anlass === 'takt') log().debug(zeile); else log().info(zeile);
    await schreiben(
        `UPDATE zeitplan_laeufe SET zustand = 'bereit', laeufe = laeufe + 1, letzte_dauer_ms = ?,
                letztes_ergebnis = ?, letzter_erfolg_am = NOW(3), naechster_lauf = ?
          WHERE name = ?`,
        [dauer, ergebnis, a.task.getNextRun(), a.name]);
    return { ok: true, dauer_ms: dauer, ergebnis };
}

/**
 * Zeile anlegen oder auffrischen, Takt starten, wenn nötig nachholen.
 *
 * @param {Object} a Aufgabe
 */
async function planen(a) {
    await bereit;
    if (AUFGABEN.get(a.name) !== a) return; // inzwischen ersetzt
    let verpasst = false;
    try {
        const [vorher] = await db().query(
            `SELECT takt, naechster_lauf IS NOT NULL AND naechster_lauf < NOW(3) AS verpasst
               FROM zeitplan_laeufe WHERE name = ?`, [a.name]);
        verpasst = Boolean(vorher) && vorher.takt === a.takt &&
            (Number(vorher.verpasst) === 1 || abgebrochen.has(a.name));
    } catch (e) {
        log().warn(`[Zeitplan] ${a.name}: Stand nicht lesbar, nachgeholt wird nichts: ${e.message}`);
    }
    abgebrochen.delete(a.name);
    a.task.start();
    await schreiben(
        `INSERT INTO zeitplan_laeufe (name, plugin, takt, nachholen, naechster_lauf, eingetragen_am)
         VALUES (?, ?, ?, ?, ?, NOW(3))
         ON DUPLICATE KEY UPDATE plugin = VALUES(plugin), takt = VALUES(takt), nachholen = VALUES(nachholen),
                                 naechster_lauf = VALUES(naechster_lauf), eingetragen_am = VALUES(eingetragen_am)`,
        [a.name, a.plugin, a.takt, a.nachholen ? 1 : 0, a.task.getNextRun()]);
    if (verpasst && a.nachholen) {
        log().info(`[Zeitplan] ${a.name}: verpasst, solange das Dashboard aus war, wird in ${Math.round(nachholenMs / 1000)} s nachgeholt`);
        setTimeout(() => {
            if (AUFGABEN.get(a.name) === a) ausloesen(a, 'nachgeholt');
        }, nachholenMs).unref();
    }
}

/**
 * Eine Aufgabe eintragen. Wirft bei falschem Namen, Takt oder Handler.
 *
 * @param {string} name `plugin:aufgabe`
 * @param {string} takt Cron-Ausdruck, fünf Felder
 * @param {(lauf: {name: string, anlass: string, start: Date}) => Promise<*>} handler
 * @param {{nachholen?: boolean, frist_min?: number}} [optionen]
 * @returns {{name: string, plugin: string}}
 */
function eintragen(name, takt, handler, optionen = {}) {
    const m = NAME.exec(String(name || ''));
    if (!m) throw new Error(`Zeitplan.eintragen('${name}'): Name muss 'plugin:aufgabe' sein (klein, a-z 0-9 _ -)`);
    if (typeof handler !== 'function') throw new Error(`Zeitplan.eintragen('${name}'): Handler fehlt`);
    const t = String(takt || '').trim().replace(/\s+/g, ' ');
    if (t.split(' ').length !== 5 || !cron.validate(t)) {
        throw new Error(`Zeitplan.eintragen('${name}'): Takt '${takt}' ist kein Cron-Ausdruck mit fünf Feldern`);
    }
    const frist = optionen.frist_min === undefined ? FRIST_MIN : Number(optionen.frist_min);
    if (!(frist > 0)) throw new Error(`Zeitplan.eintragen('${name}'): frist_min muss größer als 0 sein`);

    const alt = AUFGABEN.get(name);
    if (alt) alt.task.destroy();
    const a = {
        name, plugin: m[1], takt: t, handler,
        nachholen: optionen.nachholen !== false,
        frist_min: frist,
        task: null,
    };
    a.task = cron.createTask(t, () => ausloesen(a, 'takt'), { timezone: ZEITZONE, name });
    AUFGABEN.set(name, a);
    if (bereit) {
        planen(a).catch(e => log().error(`[Zeitplan] ${name}: Einplanen gescheitert`, e));
    }
    return { name, plugin: a.plugin };
}

/**
 * Von Hand ausführen (/admin). Wartet nicht auf das Ende.
 *
 * @param {string} name
 * @returns {{gestartet: boolean, seit?: Date}}
 */
function jetzt(name) {
    const a = AUFGABEN.get(name);
    if (!a) throw new Error(`Keine Aufgabe '${name}' eingetragen`);
    const sperre = LAEUFT.get(name);
    if (sperre) return { gestartet: false, seit: sperre.seit };
    ausloesen(a, 'von_hand');
    return { gestartet: true };
}

/**
 * Stand für /admin/zeitplan: eingetragene Aufgaben mit ihrer Zeile, dazu
 * Zeilen von Aufgaben, die seit dem Start niemand mehr eingetragen hat.
 *
 * @returns {Promise<Object[]>}
 */
async function stand() {
    const zeilen = await db().query('SELECT * FROM zeitplan_laeufe');
    const nachName = new Map(zeilen.map(z => [z.name, z]));
    const aus = [];
    for (const a of AUFGABEN.values()) {
        aus.push({
            ...(nachName.get(a.name) || { name: a.name, laeufe: 0, fehler: 0, uebersprungen: 0 }),
            plugin: a.plugin, takt: a.takt, nachholen: a.nachholen, frist_min: a.frist_min,
            eingetragen: true, laeuft: LAEUFT.get(a.name) || null, naechster_lauf: a.task.getNextRun(),
        });
    }
    for (const z of zeilen) {
        if (!AUFGABEN.has(z.name)) aus.push({ ...z, eingetragen: false, laeuft: null, naechster_lauf: null });
    }
    return aus.sort((x, y) => x.plugin.localeCompare(y.plugin) || x.name.localeCompare(y.name));
}

/**
 * Zeile einer Aufgabe entfernen, die niemand mehr einträgt (Plugin hat sie
 * gestrichen). Eingetragene bleiben.
 *
 * @param {string} name
 * @returns {Promise<boolean>} ob eine Zeile ging
 */
async function vergessen(name) {
    if (AUFGABEN.has(name)) throw new Error(`'${name}' ist eingetragen, die Zeile bleibt`);
    const r = await db().query('DELETE FROM zeitplan_laeufe WHERE name = ?', [name]);
    return Boolean(r?.affectedRows);
}

/**
 * Nach den Kern-Migrationen, vor den Plugins. Merkt sich, welche Läufe der
 * letzte Neustart abgebrochen hat, und plant alles schon Eingetragene ein.
 *
 * @param {{nachholenMs?: number}} [optionen] nur für den Wächter
 * @returns {Promise<void>}
 */
function starten(optionen = {}) {
    if (bereit) return bereit;
    if (optionen.nachholenMs !== undefined) nachholenMs = optionen.nachholenMs;
    ServiceManager.register('zeitplan', module.exports);
    bereit = (async () => {
        try {
            const reste = await db().query("SELECT name FROM zeitplan_laeufe WHERE zustand = 'laeuft'");
            abgebrochen = new Set(reste.map(r => r.name));
            if (abgebrochen.size) {
                log().warn(`[Zeitplan] Beim letzten Beenden liefen noch: ${[...abgebrochen].join(', ')}`);
                await db().query(
                    `UPDATE zeitplan_laeufe SET zustand = 'bereit', fehler = fehler + 1, letzter_fehler = ?,
                            letzter_fehler_am = NOW(3) WHERE zustand = 'laeuft'`, [ABGEBROCHEN]);
            }
        } catch (e) {
            log().error('[Zeitplan] Stand nicht lesbar (Kern-Migration zeitplan gelaufen?)', e);
        }
    })();
    for (const a of AUFGABEN.values()) {
        planen(a).catch(e => log().error(`[Zeitplan] ${a.name}: Einplanen gescheitert`, e));
    }
    log().info('[Zeitplan] Register bereit');
    return bereit;
}

/** Alle Takte anhalten (Wächter, Herunterfahren). */
function anhalten() {
    for (const a of AUFGABEN.values()) a.task.destroy();
    AUFGABEN.clear();
}

module.exports = {
    eintragen, jetzt, stand, vergessen, starten, anhalten,
    NAME, ZEITZONE, FRIST_MIN, NACHHOLEN_MS, ABGEBROCHEN,
};
