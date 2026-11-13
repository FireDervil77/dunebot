'use strict';

/**
 * Der Zusteller der Fachereignisse (G-02, K382, 2026-11-13).
 *
 * Läuft nur im Dashboard. Er liest neue Zeilen aus `ereignisbuch`, legt je
 * Abnehmer eine Quittung an und ruft die Hörer. Gemeldet wird in Bot und
 * Dashboard (`Ereignisse.melde` im SDK), gehört nur hier.
 *
 * # Ablauf
 *
 * 1. **Verteilen:** Für jede Zeile im Zustand `neu` fragt er das SDK, welche
 *    Plugins einen passenden Hörer haben und das Ereignis hören dürfen. Je
 *    Plugin eine Quittung, dann `verteilt`. Gezählt wird beim Verteilen, nicht
 *    später: Ein Hörer, der erst danach eingetragen wird, bekommt ältere
 *    Ereignisse nicht nachgeliefert.
 * 2. **Zustellen:** Je fällige Quittung fragt er, ob das Plugin **in dieser
 *    Guild** an ist (`Nachbar.pluginAn`, G-03). Aus → `plugin_aus`. Nicht
 *    prüfbar → später noch einmal. An → Hörer rufen, mit Frist.
 * 3. **Fehler:** Wirft der Hörer oder fehlt er, wartet die Quittung länger
 *    (2, 4, 8 … höchstens 600 s) und wird erneut versucht. Nach zehn Versuchen
 *    bleibt sie `liegen_geblieben`. Das steht unter /admin/ereignisse und im
 *    Log, verschwunden ist nichts.
 *
 * # Wann er läuft
 *
 * Alle 2 s und sofort, wenn jemand meldet: im Dashboard über `wecken()`, aus
 * dem Bot über IPC (`core:EREIGNISSE_ANSTOSS`). Gestartet wird er nach dem
 * Laden der Plugins, sonst fänden die ersten Ereignisse nach einem Neustart
 * keine Hörer und wären ohne Quittung verteilt.
 *
 * # Was er nicht kann
 *
 * - Er läuft seriell. Ein langsamer Hörer hält die übrigen auf, höchstens
 *   `FRIST_MS` lang. Danach gilt der Versuch als gescheitert.
 * - Die Reihenfolge je Abnehmer ist nur ohne Fehler die der Meldung. Ein
 *   wiederholtes Ereignis kommt nach späteren an.
 * - Mindestens einmal: Stirbt das Dashboard zwischen Hörer und Quittung, ruft
 *   er den Hörer nach dem Start noch einmal.
 *
 * @module apps/dashboard/helpers/EreignisZusteller
 */

const { ServiceManager } = require('dunebot-core');
const { Ereignisse, Nachbar } = require('dunebot-sdk');

const TAKT_MS = 2000;
const JE_LAUF = 50;
const HOECHSTVERSUCHE = 10;
const HOECHSTABSTAND_S = 600;
const FRIST_MS = 30000;

/** Wie viele Male die Probe in diesem Vorgang angekommen ist, je Ereignis. */
const probeAufrufe = new Map();

let uhr = null;
let laeuft = false;
let nochmal = false;

const db = () => ServiceManager.get('dbService');
const log = () => ServiceManager.get('Logger');

/** Wartezeit nach dem n-ten Fehlversuch. */
const abstandS = (versuche) => Math.min(HOECHSTABSTAND_S, 2 ** versuche);

/** JSON-Spalte lesen; MariaDB liefert LONGTEXT als Text. */
function json(wert) {
    if (wert === null || wert === undefined) return null;
    if (typeof wert !== 'string') return wert;
    try { return JSON.parse(wert); } catch { return null; }
}

/** Was ein Hörer bekommt: der Umschlag aus `liste.json`, eingefroren. */
function umschlag(zeile) {
    return Object.freeze({
        id: Number(zeile.ereignis_id),
        name: zeile.name,
        version: zeile.version,
        guild_id: zeile.guild_id,
        quelle: zeile.quelle,
        schluessel: zeile.schluessel,
        schutz: zeile.schutz,
        schwere: zeile.schwere,
        akteur: zeile.akteur,
        betroffen: zeile.betroffen,
        bezug: Object.freeze(json(zeile.bezug)),
        daten: Object.freeze(json(zeile.daten) || {}),
        zeit: zeile.zeit,
    });
}

/** Etwas mit Frist; wirft, wenn sie abläuft. */
function mitFrist(ms, tun) {
    let wecker = null;
    const ablauf = new Promise((_, nein) => {
        wecker = setTimeout(() => nein(new Error(`Frist von ${ms / 1000} s überschritten`)), ms);
    });
    return Promise.race([Promise.resolve().then(tun), ablauf]).finally(() => clearTimeout(wecker));
}

// ── Verteilen ────────────────────────────────────────────────────────────────

async function verteilen() {
    const neue = await db().query(
        `SELECT id, name FROM ereignisbuch WHERE zustand = 'neu' ORDER BY id LIMIT ${JE_LAUF}`);
    for (const e of neue) {
        for (const plugin of Ereignisse.abnehmerFuer(e.name)) {
            await db().query(
                `INSERT INTO ereignis_quittungen (ereignis_id, abnehmer) VALUES (?, ?)
                 ON DUPLICATE KEY UPDATE ereignis_id = ereignis_id`, [e.id, plugin]);
        }
        await db().query(
            "UPDATE ereignisbuch SET zustand = 'verteilt', verteilt_am = NOW(3) WHERE id = ? AND zustand = 'neu'", [e.id]);
    }
    return neue.length;
}

// ── Zustellen ────────────────────────────────────────────────────────────────

async function fehlschlag(q, grund) {
    const versuche = q.versuche + 1;
    const aufgeben = versuche >= HOECHSTVERSUCHE;
    await db().query(
        `UPDATE ereignis_quittungen
            SET versuche = ?, fehlertext = ?, zustand = ?,
                faellig_ab = NOW(3) + INTERVAL ? SECOND
          WHERE id = ?`,
        [versuche, String(grund).slice(0, 512), aufgeben ? 'liegen_geblieben' : 'offen', abstandS(versuche), q.quittung_id]);
    const was = `[Ereignisse] ${q.name} #${q.ereignis_id} an ${q.abnehmer}`;
    if (aufgeben) log().error(`${was}: liegen geblieben nach ${versuche} Versuchen: ${grund}`);
    else log().warn(`${was}: Versuch ${versuche} gescheitert, nächster in ${abstandS(versuche)} s: ${grund}`);
}

async function zustellenEine(q) {
    const handler = Ereignisse.hoererFuer(q.abnehmer, q.name);
    if (!handler) return fehlschlag(q, `kein Hörer von ${q.abnehmer} eingetragen (Plugin nicht geladen?)`);

    const { an, pruefbar } = await Nachbar.pluginAn(q.abnehmer, q.guild_id);
    if (!pruefbar) return fehlschlag(q, 'nicht prüfbar, ob das Plugin in der Guild an ist');
    if (!an) {
        await db().query(
            "UPDATE ereignis_quittungen SET zustand = 'plugin_aus', erledigt_am = NOW(3), fehlertext = NULL WHERE id = ?",
            [q.quittung_id]);
        return;
    }

    try {
        await mitFrist(FRIST_MS, () => handler(umschlag(q)));
    } catch (err) {
        return fehlschlag(q, err?.message || String(err));
    }
    await db().query(
        "UPDATE ereignis_quittungen SET zustand = 'erledigt', erledigt_am = NOW(3), fehlertext = NULL WHERE id = ?",
        [q.quittung_id]);
}

async function zustellen() {
    const faellig = await db().query(
        `SELECT q.id AS quittung_id, q.abnehmer, q.versuche,
                e.id AS ereignis_id, e.name, e.version, e.guild_id, e.quelle, e.schluessel,
                e.schutz, e.schwere, e.akteur, e.betroffen, e.bezug, e.daten, e.zeit
           FROM ereignis_quittungen q
           JOIN ereignisbuch e ON e.id = q.ereignis_id
          WHERE q.zustand = 'offen' AND q.faellig_ab <= NOW(3)
          ORDER BY q.id
          LIMIT ${JE_LAUF}`);
    for (const q of faellig) {
        try {
            await zustellenEine(q);
        } catch (err) {
            // Datenbank weg o. ä.: Der Lauf bricht ab, der nächste Takt versucht es neu.
            log().error(`[Ereignisse] Zustellen von #${q.ereignis_id} an ${q.abnehmer} abgebrochen:`, err);
            return faellig.length;
        }
    }
    return faellig.length;
}

// ── Lauf ─────────────────────────────────────────────────────────────────────

/**
 * Ein Lauf. Läuft schon einer, wird danach gleich noch einer gemacht. So geht
 * kein Anstoß verloren, und es laufen nie zwei zugleich.
 */
async function lauf() {
    if (laeuft) { nochmal = true; return; }
    laeuft = true;
    try {
        do {
            nochmal = false;
            const verteilt = await verteilen();
            const zugestellt = await zustellen();
            // Volle Seiten: gleich weiter statt 2 s zu warten.
            if (verteilt === JE_LAUF || zugestellt === JE_LAUF) nochmal = true;
        } while (nochmal);
    } catch (err) {
        log().error('[Ereignisse] Lauf des Zustellers gescheitert:', err);
    } finally {
        laeuft = false;
    }
}

/** Sofort einen Lauf anstoßen (Meldung im Dashboard, Anstoß vom Bot). */
function wecken() {
    setImmediate(() => { lauf(); });
}

/**
 * Der Hörer der Probe (`kern.ereignis.probe`). Er zählt nur, wie oft er
 * gerufen wurde, und schreibt es ins Log. Gezählt wird im Speicher: Nach
 * einem Neustart beginnt die Zählung von vorn, die Quittung bleibt.
 */
async function probeHoeren(ereignis) {
    const n = (probeAufrufe.get(ereignis.id) || 0) + 1;
    probeAufrufe.set(ereignis.id, n);
    if (probeAufrufe.size > 200) probeAufrufe.delete(probeAufrufe.keys().next().value);
    const verzug = Date.now() - new Date(ereignis.zeit).getTime();
    log().info(`[Ereignisse] Probe #${ereignis.id} (${ereignis.schluessel}) angekommen, ${n}. Aufruf, ${verzug} ms nach dem Melden`);
}

/**
 * Starten: Probe-Hörer eintragen, Takt beginnen, sofort einmal laufen.
 * Erst nach dem Laden der Plugins rufen.
 */
function starten() {
    if (uhr) return;
    Ereignisse.hoere('kern.ereignis.probe', 'core', probeHoeren);
    ServiceManager.register('ereignisZusteller', module.exports);
    uhr = setInterval(() => { lauf(); }, TAKT_MS);
    uhr.unref();
    wecken();
    log().info(`[Ereignisse] Zusteller läuft (Takt ${TAKT_MS / 1000} s, ${Ereignisse.hoererListe().length} Plugin(s) hören)`);
}

/**
 * Für /admin/ereignisse: Zahlen, Hörer, Liegengebliebenes, letzte Proben.
 *
 * @returns {Promise<Object>} Stand
 */
async function stand() {
    const buch = await db().query('SELECT zustand, COUNT(*) AS n FROM ereignisbuch GROUP BY zustand');
    const quittungen = await db().query('SELECT zustand, COUNT(*) AS n FROM ereignis_quittungen GROUP BY zustand');
    const liegen = await db().query(
        `SELECT q.id, q.abnehmer, q.versuche, q.fehlertext, q.angelegt_am,
                e.id AS ereignis_id, e.name, e.guild_id, e.schwere, e.zeit
           FROM ereignis_quittungen q
           JOIN ereignisbuch e ON e.id = q.ereignis_id
          WHERE q.zustand = 'liegen_geblieben'
          ORDER BY q.id DESC
          LIMIT 100`);
    const proben = await db().query(
        `SELECT e.id, e.schluessel, e.zeit, e.zustand, e.doppelt, e.angelegt_am,
                q.zustand AS quittung, q.versuche, q.erledigt_am, q.fehlertext
           FROM ereignisbuch e
           LEFT JOIN ereignis_quittungen q ON q.ereignis_id = e.id AND q.abnehmer = 'core'
          WHERE e.name = 'kern.ereignis.probe'
          ORDER BY e.id DESC
          LIMIT 10`);
    const zahl = (zeilen) => Object.fromEntries(zeilen.map(z => [z.zustand, Number(z.n)]));
    return {
        buch: zahl(buch),
        quittungen: zahl(quittungen),
        liegen,
        proben: proben.map(p => ({ ...p, aufrufe: probeAufrufe.get(Number(p.id)) || 0 })),
        hoerer: Ereignisse.hoererListe(),
        laeuft: Boolean(uhr),
        hoechstversuche: HOECHSTVERSUCHE,
    };
}

/**
 * Liegengebliebenes erneut zustellen, alles oder ausgewählte Quittungen.
 *
 * @param {number[]|null} ids Quittungen; `null` heißt alle
 * @returns {Promise<number>} wie viele wieder offen sind
 */
async function erneut(ids) {
    const sauber = Array.isArray(ids) ? ids.map(Number).filter(n => Number.isInteger(n) && n > 0) : null;
    if (sauber && !sauber.length) return 0;
    const ergebnis = await db().query(
        `UPDATE ereignis_quittungen
            SET zustand = 'offen', versuche = 0, faellig_ab = NOW(3), fehlertext = NULL
          WHERE zustand = 'liegen_geblieben'${sauber ? ` AND id IN (${sauber.map(() => '?').join(',')})` : ''}`,
        sauber || []);
    if (ergebnis.affectedRows) wecken();
    return ergebnis.affectedRows;
}

module.exports = { starten, wecken, lauf, stand, erneut, HOECHSTVERSUCHE, TAKT_MS };
