'use strict';

/**
 * Leveling: Datenverwaltung ohne Datenbank (LV-1i Teil 2, F-LV7, K382, 2026-11-15).
 *
 * Reine Entscheidungen, damit `scripts/check-leveling.js` sie ohne Dashboard
 * prüft. Die Seite „Datenverwaltung“ (`dashboard/routes/guild.router.js`)
 * liest und schreibt.
 *
 *   leseCsv         Import-Datei lesen: Trenner `,` `;` oder Tab, Kopfzeile
 *                   wahlweise, Spalten über bekannte Namen (`user_id`, `xp` …)
 *                   oder die ersten beiden. Fehler je Zeile, nichts geraten.
 *   plane           je Zeile vorher → nachher und die Buchung dafür
 *                   (`setzen`: Stand wird der Wert, `addieren`: Wert kommt dazu)
 *   laufVon         Kennung eines Imports im Buchungsschlüssel
 *                   `import:<lauf>:<mitglied>`: Beim Addieren der Inhalt der
 *                   Datei (dieselbe Datei zweimal = einmal), beim Setzen neu
 *                   je Probelauf (setzen ist ohnehin wiederholbar)
 *   zelle, zeile    CSV schreiben, Text gegen Formeln in Tabellenprogrammen
 *                   geschützt (`=`, `+`, `-`, `@` am Anfang)
 *   pruefeVerlassen Frist beim Verlassen: behalten oder löschen nach N Tagen
 *
 * @module leveling/shared/daten
 */

const crypto = require('crypto');
const { Eingabefehler } = require('./einstellen');

const ID = /^\d{17,20}$/;
const GRENZEN = Object.freeze({
    /** Größe der Datei; eine Zeile ist ~30 Byte, also gut 60.000 Mitglieder. */
    bytes: 2 * 1024 * 1024,
    zeilen: 100_000,
    /** Größte Menge einer Buchung im Kern (G-20). */
    xp: 1_000_000_000_000,
    verlassen_tage: [0, 3653],
});
const MODI = Object.freeze(['setzen', 'addieren']);
const VERLASSEN = Object.freeze(['behalten', 'loeschen']);
const LAUF = /^[0-9a-f]{16}$/;
/** Spaltennamen, wie sie andere Bots und Tabellen nennen (klein, ohne Leer- und Sonderzeichen). */
const ID_SPALTEN = Object.freeze(['mitgliedid', 'mitglied', 'userid', 'user', 'memberid', 'member', 'discordid', 'id']);
const XP_SPALTEN = Object.freeze(['xp', 'exp', 'experience', 'totalxp', 'gesamtxp', 'punkte', 'points']);
/** Höchstens so viele Zeilenfehler werden einzeln genannt. */
const FEHLER_MAX = 50;

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * CSV in Datensätze, mit Zeilennummer (1-basiert, wie im Editor) je Datensatz.
 * Anführungszeichen nach RFC 4180, auch Zeilenumbrüche darin.
 *
 * @returns {Array<{zeile: number, felder: string[]}>}
 */
function zerlege(text, trenner) {
    const aus = [];
    let felder = [];
    let feld = '';
    let inAnf = false;
    let zeile = 1;
    let start = 1;
    let leer = true;
    const schliesse = () => {
        felder.push(feld);
        // Leere Zeilen und solche nur aus Trennern (Tabellenprogramme hängen sie an) zählen nicht.
        if (!(leer && felder.every((f) => f.trim() === ''))) aus.push({ zeile: start, felder });
        felder = [];
        feld = '';
        leer = true;
    };
    for (let i = 0; i < text.length; i++) {
        const z = text[i];
        if (inAnf) {
            if (z === '"') {
                if (text[i + 1] === '"') { feld += '"'; i++; } else inAnf = false;
            } else {
                if (z === '\n') zeile++;
                feld += z;
            }
            continue;
        }
        if (z === '"' && feld.trim() === '') { feld = ''; inAnf = true; leer = false; continue; }
        if (z === trenner) { felder.push(feld); feld = ''; continue; }
        if (z === '\r' || z === '\n') {
            if (z === '\r' && text[i + 1] === '\n') i++;
            schliesse();
            zeile++;
            start = zeile;
            continue;
        }
        feld += z;
        if (z.trim() !== '') leer = false;
    }
    if (inAnf) throw new Eingabefehler('CSV_ANFUEHRUNG', { zeile: start });
    if (feld !== '' || felder.length) schliesse();
    return aus;
}

/** Trenner aus der ersten Zeile: der häufigste von `;`, Tab, `,` außerhalb von Anführungszeichen. */
function trennerVon(text) {
    const erste = text.split(/\r?\n|\r/, 1)[0].replace(/"[^"]*"/g, '');
    const zahl = (t) => erste.split(t).length - 1;
    const wahl = [';', '\t', ','].map((t) => [t, zahl(t)]).sort((a, b) => b[1] - a[1])[0];
    return wahl[1] > 0 ? wahl[0] : ',';
}

/**
 * Import-Datei lesen. Ganze Datei oder nichts: Wer Fehler hat, bekommt sie
 * alle genannt (bis FEHLER_MAX), und eingelesen wird nichts.
 *
 * @param {string} text
 * @returns {{zeilen: Array<{zeile, mitglied, xp}>, fehler: Array<{zeile, grund, werte?}>, fehlerGesamt: number, trenner: string, kopf: string[]|null}}
 * @throws {Eingabefehler} leer, zu groß, Spalten nicht gefunden, offenes Anführungszeichen
 */
function leseCsv(text) {
    if (typeof text !== 'string' || !text.trim()) throw new Eingabefehler('CSV_LEER');
    if (Buffer.byteLength(text, 'utf8') > GRENZEN.bytes) throw new Eingabefehler('CSV_ZU_GROSS', { mb: GRENZEN.bytes / 1024 / 1024, zeilen: GRENZEN.zeilen });
    const t = text.replace(/^﻿/, '');
    const trenner = trennerVon(t);
    const saetze = zerlege(t, trenner);
    if (!saetze.length) throw new Eingabefehler('CSV_LEER');

    let kopf = null;
    let idI = 0;
    let xpI = 1;
    const erste = saetze[0].felder.map((f) => f.trim());
    if (!ID.test(erste[0] || '')) {
        kopf = erste;
        const namen = erste.map(norm);
        idI = ID_SPALTEN.map((n) => namen.indexOf(n)).find((i) => i >= 0) ?? -1;
        xpI = XP_SPALTEN.map((n) => namen.indexOf(n)).find((i) => i >= 0) ?? -1;
        if (idI < 0 || xpI < 0) throw new Eingabefehler('CSV_SPALTEN', { spalten: erste.join(', ').slice(0, 200) });
    }
    const daten = kopf ? saetze.slice(1) : saetze;
    if (daten.length > GRENZEN.zeilen) throw new Eingabefehler('CSV_ZU_GROSS', { mb: GRENZEN.bytes / 1024 / 1024, zeilen: GRENZEN.zeilen });

    const zeilen = [];
    const fehler = [];
    const gesehen = new Map();
    for (const { zeile, felder } of daten) {
        const id = String(felder[idI] ?? '').trim();
        // Tausenderpunkte und Leerzeichen sind keine Nachkommastellen; 1,5 oder 1.5 wird abgelehnt.
        const roh = String(felder[xpI] ?? '').trim().replace(/[\s  ']/g, '');
        let grund = null;
        let werte;
        if (felder.length <= Math.max(idI, xpI)) grund = 'SPALTEN_FEHLEN';
        else if (!ID.test(id)) grund = 'ID_FALSCH';
        else if (!/^\d{1,3}(\.\d{3})+$|^\d{1,3}(,\d{3})+$|^\d+$/.test(roh)) grund = 'XP_KEINE_ZAHL';
        else if (gesehen.has(id)) { grund = 'DOPPELT'; werte = { erste: gesehen.get(id) }; }
        const xp = grund ? 0 : Number(roh.replace(/[.,]/g, ''));
        if (!grund && !(xp <= GRENZEN.xp)) grund = 'XP_ZU_GROSS';
        if (grund) {
            fehler.push({ zeile, grund, ...(werte ? { werte } : {}) });
            continue;
        }
        gesehen.set(id, zeile);
        zeilen.push({ zeile, mitglied: id, xp });
    }
    if (!zeilen.length && !fehler.length) throw new Eingabefehler('CSV_LEER');
    return { zeilen, fehler: fehler.slice(0, FEHLER_MAX), fehlerGesamt: fehler.length, trenner, kopf };
}

/**
 * Was der Import täte.
 *
 * @param {Array<{mitglied, xp}>} zeilen aus `leseCsv`
 * @param {Map<string, number>} staende XP je Mitglied jetzt (fehlt = 0, neu)
 * @param {'setzen'|'addieren'} modus
 * @returns {{eintraege: Array<{mitglied, vorher, nachher, menge, neu}>, neu, aendern, gleich, summeVorher, summeNachher}}
 */
function plane(zeilen, staende, modus) {
    if (!MODI.includes(modus)) throw new Eingabefehler('FALSCHER_MODUS');
    const eintraege = zeilen.map(({ mitglied, xp }) => {
        const vorher = Number(staende.get(mitglied) || 0);
        const nachher = modus === 'setzen' ? xp : vorher + xp;
        return { mitglied, vorher, nachher, menge: nachher - vorher, neu: !staende.has(mitglied) };
    });
    return {
        eintraege,
        neu: eintraege.filter((e) => e.neu && e.menge !== 0).length,
        aendern: eintraege.filter((e) => e.menge !== 0).length,
        gleich: eintraege.filter((e) => e.menge === 0).length,
        summeVorher: eintraege.reduce((a, e) => a + e.vorher, 0),
        summeNachher: eintraege.reduce((a, e) => a + e.nachher, 0),
    };
}

/**
 * Kennung des Imports für den Buchungsschlüssel.
 * Addieren: aus Inhalt und Modus, damit dieselbe Datei nicht zweimal zählt.
 * Setzen: zufällig je Probelauf; wiederholte Stücke desselben Laufs sind doppelt.
 */
function laufVon(modus, zeilen) {
    if (modus !== 'addieren') return crypto.randomBytes(8).toString('hex');
    const h = crypto.createHash('sha256').update(modus);
    for (const z of zeilen) h.update(`\n${z.mitglied}:${z.xp}`);
    return h.digest('hex').slice(0, 16);
}

/** Eine CSV-Zelle. Text beginnt nie mit einem Formelzeichen. */
function zelle(w) {
    if (w === null || w === undefined) return '';
    if (typeof w === 'number' || typeof w === 'bigint') return String(w);
    if (w instanceof Date) return Number.isNaN(w.getTime()) ? '' : w.toISOString();
    let s = String(w);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\r\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Eine CSV-Zeile mit Komma und CRLF (RFC 4180). */
function zeile(werte) {
    return `${werte.map(zelle).join(',')}\r\n`;
}

/**
 * Frist beim Verlassen.
 *
 * @returns {{verlassen: 'behalten'|'loeschen', verlassen_tage: number}}
 */
function pruefeVerlassen(body = {}) {
    const v = String(body.verlassen ?? '');
    if (!VERLASSEN.includes(v)) throw new Eingabefehler('FALSCHE_ART');
    const s = String(body.verlassen_tage ?? '').trim();
    if (!/^\d+$/.test(s)) throw new Eingabefehler('KEINE_ZAHL', { feld: 'verlassen_tage' });
    const n = Number(s);
    const [min, max] = GRENZEN.verlassen_tage;
    if (n < min || n > max) throw new Eingabefehler('AUSSERHALB', { feld: 'verlassen_tage', min, max });
    return { verlassen: v, verlassen_tage: n };
}

module.exports = {
    GRENZEN, MODI, VERLASSEN, LAUF, ID_SPALTEN, XP_SPALTEN, FEHLER_MAX,
    leseCsv, plane, laufVon, zelle, zeile, pruefeVerlassen, zerlege, trennerVon,
};
