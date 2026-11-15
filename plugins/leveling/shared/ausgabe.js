'use strict';

/**
 * Leveling: Level-up-Ausgabe (LV-1f, F-LV1, 2026-11-15).
 *
 * Wohin und wann der Bot einen Aufstieg meldet, steht in `level_einstellungen`:
 *
 *   ausgabe_modus         aus | kanal_der_nachricht | level_kanal (Vorgabe) | direktnachricht
 *   ausgabe_kanal         der Level-Kanal; bei „Kanal der Nachricht“ der Ersatz,
 *                         wenn die XP keinen Kanal haben
 *   nur_meilensteine      nur bei den Stufen aus `meilensteine` (JSON-Liste)
 *   rangkarte_anhaengen   Rangkarte (`kern:rangkarte`, G-10) als Bild dazu
 *
 * Ohne gewählten Level-Kanal geht keine Nachricht hinaus (F-LV1 A); die
 * Verwaltung sieht dafür einen Hinweis in der Übersicht und oben im
 * Guild-Bereich (Filter `guild_notices`, `dashboard/index.js`).
 *
 * Die Nachricht ist die Vorlage `leveling:aufstieg` (G-08). Ohne gespeicherte
 * Vorlage gilt `vorgabe()`, Text aus der Sprachdatei des Bots.
 *
 * Reine Entscheidungen oben (prüft `scripts/check-leveling.js`), Texte unten.
 * Bot und Dashboard laden diese Datei.
 *
 * @module leveling/shared/ausgabe
 */

const fs = require('fs');
const path = require('path');

const ANLASS = 'leveling:aufstieg';
const MODI = Object.freeze(['aus', 'kanal_der_nachricht', 'level_kanal', 'direktnachricht']);
/** Höchstens so viele Meilensteine, jeder von 1 bis STUFE_MAX. */
const MEILENSTEINE_MAX = 100;
const STUFE_MAX = 1000;

const SPRACHEN = path.join(__dirname, '..', 'bot', 'locales');
const STANDARD_SPRACHE = 'de-DE';

/**
 * Der Text der Vorgabe in der Sprachdatei des Bots. Als Konstante, weil
 * Bot und Dashboard diese Datei laden (wie `ticket/shared/eroeffnung.js`).
 */
const SCHLUESSEL = Object.freeze({ text: 'leveling:AUSGABE.VORGABE_TEXT' });

// ---------------------------------------------------------------------------
// Reine Entscheidungen
// ---------------------------------------------------------------------------

/**
 * Meilensteine aus der Spalte (JSON-Text, Array oder null) oder aus einer
 * Eingabe („5, 10, 25“): ganze Zahlen 1…1000, ohne Doppelte, aufsteigend.
 *
 * @param {*} roh
 * @returns {number[]}
 */
function meilensteine(roh) {
    let liste = roh;
    if (typeof roh === 'string') {
        const t = roh.trim();
        if (!t) return [];
        try { liste = JSON.parse(t); } catch { liste = t.split(/[\s,;]+/); }
    }
    if (typeof liste === 'number') liste = [liste];
    if (!Array.isArray(liste)) return [];
    const zahlen = liste.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= STUFE_MAX);
    return [...new Set(zahlen)].sort((a, b) => a - b).slice(0, MEILENSTEINE_MAX);
}

/**
 * Soll dieser Aufstieg gemeldet werden? Nur bei echtem Aufstieg, nicht im
 * Modus „aus“. Mit „nur Meilensteine“: wenn zwischen alter (ausschließlich)
 * und neuer Stufe (einschließlich) einer liegt. Ein Prestige zählt ab Stufe 0.
 *
 * @param {object} e Zeile aus `level_einstellungen`
 * @param {{level: number, prestige?: number}} vorher
 * @param {{level: number, prestige?: number}} nachher
 * @returns {{ja: boolean, grund: string|null}}
 */
function sollMelden(e, vorher, nachher) {
    if (!e || !MODI.includes(e.ausgabe_modus) || e.ausgabe_modus === 'aus') return { ja: false, grund: 'aus' };
    const pv = Number(vorher?.prestige || 0);
    const pn = Number(nachher?.prestige || 0);
    const lv = Number(vorher?.level || 0);
    const ln = Number(nachher?.level || 0);
    const auf = pn > pv || (pn === pv && ln > lv);
    if (!auf) return { ja: false, grund: 'kein_aufstieg' };
    if (Number(e.nur_meilensteine)) {
        const ab = pn > pv ? 0 : lv;
        if (!meilensteine(e.meilensteine).some((m) => m > ab && m <= ln)) return { ja: false, grund: 'kein_meilenstein' };
    }
    return { ja: true, grund: null };
}

/**
 * Wohin? `kanal` ist der Kanal, in dem die XP entstanden (Nachricht,
 * Sprachkanal, Befehl), falls es einen gibt.
 *
 * @param {object} e Zeile aus `level_einstellungen`
 * @param {{kanal?: string|null}} [quelle]
 * @returns {{art: 'kanal'|'direkt'|'keine', kanal: string|null, grund: string|null}}
 */
function ziel(e, { kanal = null } = {}) {
    const levelKanal = e?.ausgabe_kanal ? String(e.ausgabe_kanal) : null;
    switch (e?.ausgabe_modus) {
        case 'direktnachricht': return { art: 'direkt', kanal: null, grund: null };
        case 'kanal_der_nachricht':
            if (kanal) return { art: 'kanal', kanal: String(kanal), grund: null };
            return levelKanal ? { art: 'kanal', kanal: levelKanal, grund: null } : { art: 'keine', kanal: null, grund: 'kein_kanal' };
        case 'level_kanal':
            return levelKanal ? { art: 'kanal', kanal: levelKanal, grund: null } : { art: 'keine', kanal: null, grund: 'kein_level_kanal' };
        default: return { art: 'keine', kanal: null, grund: 'aus' };
    }
}

/**
 * Fehlt der Level-Kanal, obwohl der Modus ihn braucht? Für den Hinweis im
 * Dashboard (F-LV1).
 *
 * @param {object|null} e Zeile aus `level_einstellungen`
 */
function kanalFehlt(e) {
    return Boolean(e) && e.ausgabe_modus === 'level_kanal' && !e.ausgabe_kanal;
}

/**
 * Laufzeitwerte der Vorlage (Platzhalter des Anlasses, erklärt in der
 * package.json). `rang` nur, wenn bekannt.
 *
 * @param {object} e Ergebnis aus `Fortschritt.buche` (level, xp, vorher, stufe, naechste)
 * @param {{rang?: number|null}} [mehr]
 * @returns {Object<string, string>}
 */
function platzhalter(e, { rang = null } = {}) {
    return {
        level: String(Number(e?.level || 0)),
        'level:vorher': String(Number(e?.vorher?.level || 0)),
        'level:name': e?.stufe?.name ? String(e.stufe.name) : String(Number(e?.level || 0)),
        xp: String(Number(e?.xp || 0)),
        'xp:fehlt': e?.naechste ? String(Math.max(0, Number(e.naechste.fehlt))) : '0',
        rang: rang == null ? '–' : String(rang),
    };
}

// ---------------------------------------------------------------------------
// Vorgabe
// ---------------------------------------------------------------------------

/**
 * Die Vorgabe der Nachricht: ein Satz mit Erwähnung.
 * @param {(schluessel: string) => string} t Übersetzer für `leveling:AUSGABE.*`
 */
function vorgabe(t) {
    return { form: 'text', text: t(SCHLUESSEL.text) };
}

/** sprache → Inhalt der Sprachdatei (einmal je Prozess) */
const gelesen = new Map();

/**
 * Übersetzer aus der Sprachdatei des Bots, fürs Dashboard (dort gibt es kein
 * `guild.getT`). Unbekannte Sprache: Deutsch, wie der Bot.
 * @param {string} [sprache] z. B. `de-DE`
 * @returns {(schluessel: string) => string}
 */
function texteAus(sprache) {
    let s = /^[a-z]{2}-[A-Z]{2}$/.test(String(sprache || '')) ? sprache : STANDARD_SPRACHE;
    if (!fs.existsSync(path.join(SPRACHEN, `${s}.json`))) s = STANDARD_SPRACHE;
    if (!gelesen.has(s)) gelesen.set(s, JSON.parse(fs.readFileSync(path.join(SPRACHEN, `${s}.json`), 'utf8')));
    const daten = gelesen.get(s);
    return (schluessel) => {
        const pfad = String(schluessel).replace(/^leveling:/, '').split('.');
        const w = pfad.reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), daten);
        return typeof w === 'string' ? w : schluessel;
    };
}

module.exports = { ANLASS, MODI, SCHLUESSEL, MEILENSTEINE_MAX, meilensteine, sollMelden, ziel, kanalFehlt, platzhalter, vorgabe, texteAus };
