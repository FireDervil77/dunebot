'use strict';

/**
 * Streaming - was taeglich weggeraeumt wird.
 *
 * Vier Laeufe, und **einer davon raeumt bewusst nicht auf**: Was schiefging,
 * bleibt liegen. Ein Aufraeumlauf, der auch die Fehler mitnimmt, macht aus
 * einem Problem eine leere Tabelle - und die sieht aus wie "alles in Ordnung".
 *
 * Der fuenfte Lauf aus dem Arbeitsplan (Zustand: "live" seit ueber 24 Stunden
 * gegen die Plattform pruefen) **fehlt hier mit Absicht**: Den gibt es schon.
 * `takt.js` fragt jeden laufenden Stream alle fuenf Minuten bei der Plattform
 * nach und setzt ihn zurueck, wenn er dort nicht mehr sendet - die
 * Selbstheilung, die am 2026-08-24 bewiesen wurde. Ein stuendlicher Lauf
 * daneben waere langsamer und eine zweite Wahrheit
 * ([[erst-suchen-dann-bauen]]).
 *
 * @module streaming/dashboard/kern/aufraeumen
 */

const { ServiceManager } = require('dunebot-core');

/** Wie lange ein erledigter Posteingang aufgehoben wird. */
const AUFBEWAHRUNG_TAGE = Number(require('../../config.json').AUFBEWAHRUNG_TAGE || 30);

/** Der Ausgang darf frueher weg: Er ist Arbeitsvorrat, kein Nachweis. */
const AUSGANG_TAGE = 7;

/**
 * @returns {Object} Datenbankdienst
 */
function db() {
    return ServiceManager.get('dbService');
}

/**
 * @returns {Object} Logger
 */
function log() {
    return ServiceManager.get('Logger');
}

/**
 * Ein Lauf ueber alles.
 *
 * Jeder Schritt faengt seinen eigenen Fehler ab: Ein kaputter Schritt darf die
 * uebrigen nicht mitnehmen ([[melden-statt-ausweichen]]).
 *
 * @returns {Promise<Object>} was weggeraeumt wurde
 */
async function lauf() {
    const bericht = { gelaufen_am: new Date().toISOString() };

    const schritte = [
        ['posteingang', posteingang],
        ['ausgang',     ausgang],
        ['nachrichten', nachrichten],
        ['streamer',    streamer]
    ];

    for (const [name, schritt] of schritte) {
        try {
            bericht[name] = await schritt();
        } catch (err) {
            bericht[name] = { fehler: err.message };
            log().error(`[Streaming/Aufraeumen] Schritt "${name}" fehlgeschlagen:`, err);
        }
    }

    const summe = Object.values(bericht)
        .filter(w => w && typeof w === 'object' && typeof w.geloescht === 'number')
        .reduce((n, w) => n + w.geloescht, 0);

    if (summe > 0) log().info(`[Streaming/Aufraeumen] ${summe} Zeile(n) weggeraeumt`);

    try {
        await db().setConfig('streaming', 'AUFRAEUM_BERICHT', bericht, 'shared', '', true);
    } catch (err) {
        log().warn(`[Streaming/Aufraeumen] Bericht nicht speicherbar: ${err.message}`);
    }

    return bericht;
}

/**
 * Posteingang: erledigte Zustellungen.
 *
 * `fehler` bleibt **liegen**. Das ist der Unterschied zwischen Aufraeumen und
 * Vertuschen: Wer wissen will, warum vor zwei Wochen nichts ankam, findet die
 * Zeile noch.
 *
 * @returns {Promise<{geloescht: number, aelter_als_tage: number}>} Ergebnis
 */
async function posteingang() {
    const ergebnis = await db().query(`
        DELETE FROM streaming_events
         WHERE zustand IN ('fertig', 'dublette')
           AND empfangen_am < DATE_SUB(NOW(), INTERVAL ? DAY)
    `, [AUFBEWAHRUNG_TAGE]);

    return { geloescht: Number(ergebnis?.affectedRows || 0), aelter_als_tage: AUFBEWAHRUNG_TAGE };
}

/**
 * Ausgang: erledigte Auftraege.
 *
 * `aufgegeben` bleibt sichtbar - das sind die Nachrichten, die nie ankamen.
 *
 * @returns {Promise<{geloescht: number, aelter_als_tage: number}>} Ergebnis
 */
async function ausgang() {
    const ergebnis = await db().query(`
        DELETE FROM streaming_outbox
         WHERE zustand = 'fertig'
           AND angelegt_am < DATE_SUB(NOW(), INTERVAL ? DAY)
    `, [AUSGANG_TAGE]);

    return { geloescht: Number(ergebnis?.affectedRows || 0), aelter_als_tage: AUSGANG_TAGE };
}

/**
 * Nachrichten-Verweise zu Zielen, die es nicht mehr gibt.
 *
 * Eigentlich raeumt der Fremdschluessel das mit ab (`ON DELETE CASCADE`).
 * Dieser Lauf faengt, was **daran vorbei** entstanden ist: von Hand geloeschte
 * Zeilen, ein Umzug, eine Wiederherstellung aus einer Sicherung. Er findet
 * ueblicherweise nichts - und genau dann ist es richtig.
 *
 * @returns {Promise<{geloescht: number}>} Ergebnis
 */
async function nachrichten() {
    const ergebnis = await db().query(`
        DELETE m FROM streaming_messages m
          LEFT JOIN streaming_targets t ON t.id = m.target_id
         WHERE t.id IS NULL
    `);

    const anzahl = Number(ergebnis?.affectedRows || 0);
    if (anzahl > 0) {
        // Wenn hier etwas gefunden wird, ist der Fremdschluessel umgangen
        // worden. Das gehoert gesagt, nicht stillschweigend behoben.
        log().warn(`[Streaming/Aufraeumen] ${anzahl} Nachrichten-Verweis(e) ohne Ziel gefunden - der Fremdschluessel wurde umgangen`);
    }
    return { geloescht: anzahl };
}

/**
 * Streamer ohne Ziel und ohne Abo.
 *
 * **Zwei Bedingungen, nicht eine.** Ein Streamer ohne Ziel, der noch ein Abo
 * hat, gehoert dem Abgleich (der bestellt es ab); ihn hier zu loeschen wuerde
 * das Abo bei der Plattform zuruecklassen, ohne dass noch jemand davon weiss.
 *
 * @returns {Promise<{geloescht: number}>} Ergebnis
 */
async function streamer() {
    const ergebnis = await db().query(`
        DELETE s FROM streaming_streamers s
         WHERE NOT EXISTS (SELECT 1 FROM streaming_targets t       WHERE t.streamer_id = s.id)
           AND NOT EXISTS (SELECT 1 FROM streaming_subscriptions a WHERE a.streamer_id = s.id)
    `);
    return { geloescht: Number(ergebnis?.affectedRows || 0) };
}

/**
 * Den letzten Bericht lesen.
 *
 * @returns {Promise<Object|null>} Bericht oder null
 */
async function letzterBericht() {
    const wert = await db().getConfig('streaming', 'AUFRAEUM_BERICHT', 'shared', null);
    return wert && typeof wert === 'object' ? wert : null;
}

module.exports = {
    AUFBEWAHRUNG_TAGE, AUSGANG_TAGE,
    lauf, letzterBericht,
    posteingang, ausgang, nachrichten, streamer
};
