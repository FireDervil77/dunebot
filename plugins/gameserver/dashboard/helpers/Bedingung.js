'use strict';
/**
 * Bedingungen im Paket — `from` + `when`, wie in der Startzeile.
 *
 * ── Warum es diese Nachbildung gibt (Stufe 9, 2026-10-25) ───────────────────
 *
 * Fälle im Paket (`ready_when.cases`, `connect.cases`, `settings[].applies_when`)
 * hängen an einer Einstellung. Entschieden wird die Bereitschaft im Daemon
 * (pkgspec.gilt, argv.go) — fb-init meldet den gewählten Plan zurück, und die
 * Serverseite zeichnet DEN. Das Dashboard braucht die Bedingung trotzdem
 * selbst: für die Verbindungsangabe, für „wirkt nur, wenn …" an einer
 * Einstellung, und für die Vorschau der Leiter, solange kein Lauf gemeldet hat.
 *
 * Zwei Auswertungen derselben Regel laufen auseinander, sobald eine geändert
 * wird. Deshalb prüfen beide gegen EINE Tabelle im Daemon-Repo
 * (`internal/pkgspec/testdata/bedingungen.json`): der Go-Test dort,
 * `scripts/check-bedingungen.js` hier.
 *
 * Formen: `true` · `false` · `empty` · `not_empty` · `=a,b` · `!=a,b`, leer =
 * immer. Eine unbekannte Bedingung trifft NIE zu.
 *
 * @module helpers/Bedingung
 */

/** Dieselben Schreibweisen wie pkgspec.wahr: 1/true/yes/on, Gross/klein egal. */
function wahr(wert) {
    return ['1', 'true', 'yes', 'on'].includes(String(wert ?? '').trim().toLowerCase());
}

/** Steht `wert` in der kommagetrennten Liste? Leere Einträge zählen nicht. */
function einesVon(liste, wert) {
    const w = String(wert ?? '').trim();
    return String(liste).split(',').map(t => t.trim()).filter(Boolean).includes(w);
}

/**
 * @param {string} bedingung
 * @param {string} wert
 * @returns {boolean}
 */
function gilt(bedingung, wert) {
    const b = bedingung ?? '';
    switch (b) {
        case '':          return true;
        case 'true':      return wahr(wert);
        case 'false':     return !wahr(wert);
        case 'not_empty': return String(wert ?? '').trim() !== '';
        case 'empty':     return String(wert ?? '').trim() === '';
    }
    if (b.startsWith('!=')) return !einesVon(b.slice(2), wert);
    if (b.startsWith('='))  return einesVon(b.slice(1), wert);
    return false;
}

/**
 * Der Wert hinter `from`. Fälle hängen nur an Einstellungen (`setting:<key>`);
 * alles andere ist leer — so trifft `when: "false"` zu, wie im Daemon bei
 * einem fehlenden Wert.
 *
 * @param {string} from
 * @param {object} settings  Werte, wie der Daemon sie bekommt (werteFuerDaemon)
 */
function wertVon(from, settings) {
    const m = /^setting:(.+)$/.exec(String(from || ''));
    if (!m) return '';
    const v = (settings || {})[m[1]];
    return v === undefined || v === null ? '' : String(v);
}

/** Trifft die Bedingung `{from, when}` auf diese Werte zu? */
function trifftZu(bed, settings) {
    if (!bed) return true;
    return gilt(bed.when, wertVon(bed.from, settings));
}

/**
 * Der erste passende Fall — sein Index, oder -1 für den Grundfall.
 *
 * @param {Array<{from: string, when: string}>} faelle
 * @param {object} settings
 * @returns {number}
 */
function waehleFall(faelle, settings) {
    const liste = Array.isArray(faelle) ? faelle : [];
    for (let i = 0; i < liste.length; i++) {
        if (trifftZu(liste[i], settings)) return i;
    }
    return -1;
}

module.exports = { gilt, wahr, wertVon, trifftZu, waehleFall };
