'use strict';

/**
 * Bildkarten (G-10, K382, 2026-11-14): eine Vorlage als JSON, Werte hinein,
 * ein PNG heraus.
 *
 *     const { Bildkarte } = require('dunebot-sdk');
 *     const karte = await Bildkarte.zeichne('greeting:willkommen', { member, werte: { text: '…' } },
 *                                           { guildId: member.guild.id, plugin: 'greeting' });
 *     anhaenge.push({ name: karte.dateiname('willkommen'), attachment: karte.puffer });
 *
 * # Vorlagen statt Editor
 *
 * Eine Vorlage ist eine Datei `bildkarten/<name>.json`:
 *   - `kern:<name>`   in `packages/dunebot-sdk/bildkarten/` (Schablonen des Kerns)
 *   - `<plugin>:<name>` in `plugins/<plugin>/bildkarten/`
 * Sie beschreibt Größe, Ecken, Werte mit Beispiel, feste Wörter je Sprache und
 * Ebenen (unten nach oben). Der spätere Editor (Leveling LV-5a) schreibt
 * dasselbe Format; `pruefe` ist dann seine Prüfung.
 *
 * # Werte und Platzhalter
 *
 * Jede Zeichenkette einer Ebene geht durch `parsePlaceholders` (dieselbe
 * Ersetzung wie Vorlage, G-08). Dazu kommen:
 *   - `{<wert>}`           was der Aufrufer unter `werte` gibt (erklärt in `werte`)
 *   - `{farbe:<rolle>}`    Palette der Guild für dieses Plugin (Gestaltung, G-09)
 *   - `{gestaltung:logo}`, `{gestaltung:banner}`
 *   - `{text:<name>}`      festes Wort aus `texte` in der Sprache der Guild
 * Ein Wert darf selbst Kern-Platzhalter enthalten (Text aus den Einstellungen
 * einer Guild, „Willkommen {member:nick}!“); sie werden vorher ersetzt.
 *
 * # Bilder: nur zwei Herkünfte
 *
 * Eine Adresse kommt oft aus Eingaben einer Guild. Damit der Bot keine
 * beliebige Adresse abruft (auch keine im eigenen Netz), lädt die Karte nur
 *   - die Medienablage derselben Guild, direkt von der Platte
 *     (`apps/dashboard/uploads/media/<guild>/<datei>`, Bot und Dashboard
 *     laufen auf einer Maschine), und
 *   - Discord (`cdn.discordapp.com`, `media.discordapp.net`) über https.
 * Alles andere fällt weg und steht in `hinweise`. Eine Karte scheitert nie an
 * einem Bild: Avatar ohne Bild zeigt den Anfangsbuchstaben.
 *
 * # Schriften (gemessen 2026-11-14, baustellen.md G-10)
 *
 * Die Schriften des Dashboard-Themes aus den `@fontsource`-Paketen (woff2
 * lädt). Jeder Teilsatz bekommt einen eigenen Namen: Unter einem Namen nimmt
 * Skia nur eine Datei je Gewicht, dann fehlte „Ł“. Danach in der Liste die
 * Systemschriften: Noto Color Emoji (`fonts-noto-color-emoji`; die npm-Fassung
 * COLRv1 zeichnet hier unsichtbar), Noto Sans CJK (`fonts-noto-cjk`) und
 * DejaVu Sans für den Rest (Kyrillisch, Griechisch). Fehlt ein Systempaket,
 * zeichnet die Karte trotzdem, nur mit Kästchen. `schriftStand()` sagt, was da ist.
 * Bricolage ist variabel und zeichnet hier immer mit Gewicht 800: Die Rolle
 * `anzeige` ist deshalb immer fett.
 *
 * # Einstellen je Guild (G-22, F-G11)
 *
 * Ein Wert mit `einstellbar` (`farbe`, `text`, `bild`) und `titel` stellt die
 * Guild im Bereich „Bildkarten“ ein; sein Beispiel ist die Vorgabe.
 * `vorschlaege` sind fertige Sätze solcher Werte. Bot und Seiten zeichnen
 * eine Nutzung über `zeichneNutzung` (Einstellung aus `guild_bildkarten`
 * plus Laufzeitwerte des Plugins), nie mit eigenen Werten für Einstellbares.
 *
 * Bot und Dashboard nutzen dieselbe Datei. Wächter `scripts/check-bildkarten.js`.
 *
 * @module dunebot-sdk/lib/Bildkarte
 */

const fs = require('fs');
const path = require('path');
const { parsePlaceholders, platzhalterIn } = require('dunebot-core/lib/PlaceholderParser');
const Gestaltung = require('./Gestaltung');

const WURZEL = path.join(__dirname, '..', '..', '..');
const KERN_ORDNER = path.join(__dirname, '..', 'bildkarten');
const PLUGINS = path.join(WURZEL, 'plugins');
const MEDIEN = path.join(WURZEL, 'apps', 'dashboard', 'uploads', 'media');

const NAME = /^([a-z0-9_-]{1,32}):([a-z0-9_-]{1,48})$/;
const DATEI = /^[A-Za-z0-9._-]{1,128}$/;
const GUILD = /^\d{5,25}$/;
const FARBE = /^(#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})|rgba?\(\s*[0-9.]+\s*,\s*[0-9.]+\s*,\s*[0-9.]+\s*(,\s*[0-9.]+\s*)?\)|transparent)$/i;
const DISCORD = /^https:\/\/(cdn\.discordapp\.com|media\.discordapp\.net)\//;

/** Grenzen einer Vorlage. */
const GRENZEN = Object.freeze({ seiteMin: 64, seiteMax: 2048, ebenenMax: 64, textMax: 500, bildMaxBytes: 8 * 1024 * 1024, ladenMs: 4000 });

/** Über dieser Größe geht die Karte als JPEG hinaus (Fotos als Hintergrund). */
const PNG_MAX_BYTES = 1024 * 1024;

const ROLLEN = ['anzeige', 'text', 'mono'];

/**
 * Schriftdateien je Rolle, aus den Paketen des Dashboards (`apps/dashboard/package.json`,
 * im Wurzel-`node_modules` liegend; das SDK findet sie über `require.resolve`).
 */
const SCHRIFTDATEIEN = Object.freeze({
    anzeige: { paket: '@fontsource-variable/bricolage-grotesque', dateien: { 'FB Anzeige': ['bricolage-grotesque-latin-opsz-normal.woff2'], 'FB Anzeige Ext': ['bricolage-grotesque-latin-ext-opsz-normal.woff2'] } },
    text: { paket: '@fontsource/public-sans', dateien: { 'FB Text': ['public-sans-latin-400-normal.woff2', 'public-sans-latin-700-normal.woff2'], 'FB Text Ext': ['public-sans-latin-ext-400-normal.woff2', 'public-sans-latin-ext-700-normal.woff2'] } },
    mono: { paket: '@fontsource/jetbrains-mono', dateien: { 'FB Mono': ['jetbrains-mono-latin-400-normal.woff2', 'jetbrains-mono-latin-700-normal.woff2'], 'FB Mono Ext': ['jetbrains-mono-latin-ext-400-normal.woff2', 'jetbrains-mono-latin-ext-700-normal.woff2'] } },
});

/** Systemschriften hinter jeder Rolle, in dieser Reihenfolge. */
const SYSTEM = Object.freeze([
    { familie: 'Noto Color Emoji', paket: 'fonts-noto-color-emoji', wofuer: 'Emoji in Farbe' },
    { familie: 'Noto Sans CJK JP', paket: 'fonts-noto-cjk', wofuer: 'Chinesisch, Japanisch, Koreanisch' },
    { familie: 'DejaVu Sans', paket: 'fonts-dejavu-core', wofuer: 'Kyrillisch, Griechisch, Zeichen' },
]);

/**
 * Was jede Ebene annimmt. `zahl` = feste Zahl (Lage und Größe stehen in der
 * Vorlage, nicht in Werten), `text` = Zeichenkette mit Platzhaltern.
 */
const ARTEN = Object.freeze({
    flaeche: { x: 'zahl', y: 'zahl', b: 'zahl', h: 'zahl', farbe: 'text', verlauf: 'liste', richtung: ['diagonal', 'waagrecht', 'senkrecht'], radius: 'zahl', deckkraft: 'zahl' },
    gitter: { x: 'zahl', y: 'zahl', b: 'zahl', h: 'zahl', abstand: 'zahl', farbe: 'text', breite: 'zahl' },
    leuchten: { mx: 'zahl', my: 'zahl', r_innen: 'zahl', r_aussen: 'zahl', farbe: 'text' },
    bild: { x: 'zahl', y: 'zahl', b: 'zahl', h: 'zahl', quelle: 'text', passung: ['fuellen', 'einpassen'], radius: 'zahl', deckkraft: 'zahl', abdunkeln: 'zahl' },
    avatar: { x: 'zahl', y: 'zahl', groesse: 'zahl', quelle: 'text', ringe: 'ringe', ersatz_farbe: 'text' },
    text: { x: 'zahl', y: 'zahl', text: 'text', schrift: ROLLEN, fett: 'wahr', groesse: 'zahl', min_groesse: 'zahl', farbe: 'text', ausrichtung: ['links', 'mitte', 'rechts'], grundlinie: ['mitte', 'oben', 'unten', 'alphabetisch'], max_breite: 'zahl', gross: 'wahr', deckkraft: 'zahl' },
    balken: { x: 'zahl', y: 'zahl', b: 'zahl', h: 'zahl', wert: 'text', max: 'text', farbe: 'text', grund: 'text', radius: 'zahl' },
    bildreihe: { x: 'zahl', y: 'zahl', groesse: 'zahl', abstand: 'zahl', liste: 'name', max: 'zahl', radius: 'zahl' },
});

/** Pflichtfelder je Art. */
const PFLICHT = Object.freeze({
    flaeche: ['x', 'y', 'b', 'h'], gitter: ['abstand', 'farbe'], leuchten: ['mx', 'my', 'r_aussen', 'farbe'],
    bild: ['x', 'y', 'b', 'h', 'quelle'], avatar: ['x', 'y', 'groesse'], text: ['x', 'y', 'text', 'groesse'],
    balken: ['x', 'y', 'b', 'h', 'wert', 'max'], bildreihe: ['x', 'y', 'groesse', 'liste'],
});

/**
 * Was eine Guild an einer Karte einstellen darf (G-22). Ein Wert der Vorlage
 * mit `einstellbar` erscheint im Bereich „Bildkarten“ als Feld:
 *   - `farbe`  #rrggbb
 *   - `text`   bis 255 Zeichen, Platzhalter von Mitglied und Guild
 *   - `bild`   ein Bild aus der Medienablage der Guild (gespeichert als `guild_media.id`)
 * Das Beispiel ist zugleich die Vorgabe: So zeichnet der Bot, solange die
 * Guild nichts eingestellt hat. Werte ohne `einstellbar` gibt das Plugin.
 */
const EINSTELLBAR = Object.freeze(['farbe', 'text', 'bild']);
const WERT_FELDER = new Set(['name', 'beispiel', 'einstellbar', 'titel']);
const HEX6 = /^#[0-9a-f]{6}$/i;
const TEXT_EINSTELLBAR_MAX = 255;

/**
 * Passt ein Wert zu seiner Art? `vorgabe`: Beispiel in der Vorlage (Bild
 * leer), sonst gespeicherter Wert (Bild als Medien-ID).
 * @returns {string|null} was falsch ist, oder null
 */
function wertFalsch(art, wert, { vorgabe = false } = {}) {
    if (art === 'farbe') return typeof wert === 'string' && HEX6.test(wert) ? null : 'muss eine Farbe wie #3498db sein';
    if (art === 'text') {
        if (typeof wert !== 'string') return 'muss Text sein';
        return wert.length > TEXT_EINSTELLBAR_MAX ? `ist länger als ${TEXT_EINSTELLBAR_MAX} Zeichen` : null;
    }
    if (art === 'bild') {
        if (vorgabe) return wert === '' ? null : 'muss leer sein (das Bild wählt die Guild)';
        return Number.isInteger(wert) && wert > 0 ? null : 'ist keine Medien-ID';
    }
    return `hat die unbekannte Art ${art}`;
}

class Kartenfehler extends Error {}

/** Eingabe aus dem Bereich „Bildkarten“ passt nicht (Meldung für die Guild). */
class Eingabefehler extends Error {}

let canvasModul = null;
function canvas() {
    if (!canvasModul) canvasModul = require('@napi-rs/canvas');
    return canvasModul;
}

function logger() {
    try { return require('dunebot-core').ServiceManager.get('Logger'); } catch { return null; }
}

// ─────────────────────────────────────────────────────────────────────────
// Schriften
// ─────────────────────────────────────────────────────────────────────────

let schriften = null;

/**
 * Einmal je Prozess: die Theme-Schriften anmelden.
 * @returns {{familien: Object<string,string[]>, fehlt: string[]}}
 */
function schriftenLaden() {
    if (schriften) return schriften;
    const { GlobalFonts } = canvas();
    const familien = {};
    const fehlt = [];
    for (const rolle of ROLLEN) {
        const { paket, dateien } = SCHRIFTDATEIEN[rolle];
        familien[rolle] = [];
        let ordner = null;
        try { ordner = path.join(path.dirname(require.resolve(`${paket}/package.json`)), 'files'); } catch { fehlt.push(paket); }
        for (const [familie, liste] of Object.entries(dateien)) {
            let eine = false;
            for (const datei of liste) {
                if (ordner && GlobalFonts.registerFromPath(path.join(ordner, datei), familie)) eine = true;
                else fehlt.push(`${paket}/${datei}`);
            }
            if (eine) familien[rolle].push(familie);
        }
    }
    schriften = { familien, fehlt };
    if (fehlt.length) logger()?.warn(`[Bildkarte] Schriftdateien fehlen: ${fehlt.join(', ')}`);
    return schriften;
}

/** Welche Systemschriften da sind (für Wächter und /admin/bildkarten). */
function schriftStand() {
    const s = schriftenLaden();
    const da = new Set(canvas().GlobalFonts.families.map((f) => f.family));
    return {
        theme: s.familien,
        themeFehlt: s.fehlt,
        system: SYSTEM.map((x) => ({ ...x, da: da.has(x.familie) })),
    };
}

/** `font`-Angabe für Canvas: Rolle, dann die Systemschriften. */
function schrift(rolle, fett, groesse) {
    const s = schriftenLaden();
    const liste = [...(s.familien[rolle] || []), ...SYSTEM.map((x) => x.familie)].map((f) => `"${f}"`).join(', ');
    return `${fett ? 700 : 400} ${groesse}px ${liste}`;
}

// ─────────────────────────────────────────────────────────────────────────
// Vorlagen: laden und prüfen
// ─────────────────────────────────────────────────────────────────────────

function istZahl(w) {
    return typeof w === 'number' && Number.isFinite(w);
}

/**
 * Eine Vorlage prüfen. Wirft `Kartenfehler` mit der Stelle.
 * @param {Object} roh
 * @param {string} [wo] für die Meldung
 * @returns {Object} dieselbe Vorlage, eingefroren
 */
function pruefe(roh, wo = 'Vorlage') {
    const f = (t) => { throw new Kartenfehler(`${wo}: ${t}`); };
    if (!roh || typeof roh !== 'object' || Array.isArray(roh)) f('kein Objekt');
    const erlaubt = new Set(['titel', 'breite', 'hoehe', 'ecken', 'werte', 'texte', 'vorschlaege', 'ebenen']);
    for (const k of Object.keys(roh)) if (!erlaubt.has(k)) f(`unbekanntes Feld „${k}“`);
    for (const k of ['breite', 'hoehe']) {
        if (!Number.isInteger(roh[k]) || roh[k] < GRENZEN.seiteMin || roh[k] > GRENZEN.seiteMax) f(`${k} muss eine ganze Zahl von ${GRENZEN.seiteMin} bis ${GRENZEN.seiteMax} sein`);
    }
    if (roh.ecken !== undefined && (!istZahl(roh.ecken) || roh.ecken < 0)) f('ecken muss eine Zahl ≥ 0 sein');

    const werte = roh.werte || [];
    if (!Array.isArray(werte)) f('werte muss eine Liste sein');
    const wertNamen = new Set();
    const einstellbare = new Map();
    for (const w of werte) {
        if (!w || typeof w.name !== 'string' || !/^[a-z][a-z0-9_]{0,31}$/.test(w.name)) f(`Wert ohne gültigen Namen: ${JSON.stringify(w)}`);
        if (w.name.includes(':')) f(`Wert ${w.name}: kein Doppelpunkt`);
        if (!('beispiel' in w)) f(`Wert ${w.name} ohne Beispiel`);
        if (wertNamen.has(w.name)) f(`Wert ${w.name} doppelt`);
        for (const k of Object.keys(w)) if (!WERT_FELDER.has(k)) f(`Wert ${w.name}: unbekanntes Feld „${k}“`);
        if (w.einstellbar !== undefined) {
            if (!EINSTELLBAR.includes(w.einstellbar)) f(`Wert ${w.name}: einstellbar muss eines von ${EINSTELLBAR.join(', ')} sein`);
            if (!w.titel || typeof w.titel.de !== 'string' || typeof w.titel.en !== 'string' || !w.titel.de || !w.titel.en) f(`Wert ${w.name}: einstellbar braucht titel mit de und en`);
            const falsch = wertFalsch(w.einstellbar, w.beispiel, { vorgabe: true });
            if (falsch) f(`Wert ${w.name}: Beispiel ${falsch}`);
            einstellbare.set(w.name, w.einstellbar);
        } else if (w.titel !== undefined) {
            f(`Wert ${w.name}: titel nur bei einstellbaren Werten`);
        }
        wertNamen.add(w.name);
    }

    // Vorschläge: fertige Sätze einstellbarer Werte (die Hintergründe des
    // Willkommensbilds). Bilder nicht: Ihre Medien-ID gilt nur in einer Guild.
    const vorschlaege = roh.vorschlaege || [];
    if (!Array.isArray(vorschlaege) || vorschlaege.length > 24) f('vorschlaege ist eine Liste mit höchstens 24 Einträgen');
    vorschlaege.forEach((s, i) => {
        const ort = `Vorschlag ${i + 1}`;
        if (!s || typeof s !== 'object' || Object.keys(s).some((k) => !['titel', 'werte'].includes(k))) f(`${ort}: nur titel und werte`);
        if (!s.titel || typeof s.titel.de !== 'string' || typeof s.titel.en !== 'string') f(`${ort}: titel braucht de und en`);
        if (!s.werte || typeof s.werte !== 'object' || !Object.keys(s.werte).length) f(`${ort}: werte fehlt`);
        for (const [n, x] of Object.entries(s.werte)) {
            const art = einstellbare.get(n);
            if (!art) f(`${ort}: ${n} ist kein einstellbarer Wert dieser Vorlage`);
            if (art === 'bild') f(`${ort}: ${n} ist ein Bild, das geht nicht als Vorschlag`);
            const falsch = wertFalsch(art, x, { vorgabe: true });
            if (falsch) f(`${ort}: ${n} ${falsch}`);
        }
    });

    const texte = roh.texte || {};
    if (typeof texte !== 'object' || Array.isArray(texte)) f('texte muss ein Objekt sein');
    for (const [n, t] of Object.entries(texte)) {
        if (!t || typeof t.de !== 'string' || typeof t.en !== 'string') f(`Text ${n} braucht de und en`);
    }

    if (!Array.isArray(roh.ebenen) || !roh.ebenen.length) f('ebenen fehlt');
    if (roh.ebenen.length > GRENZEN.ebenenMax) f(`höchstens ${GRENZEN.ebenenMax} Ebenen`);
    roh.ebenen.forEach((e, i) => {
        const ort = `Ebene ${i + 1}`;
        if (!e || typeof e !== 'object') f(`${ort}: kein Objekt`);
        const plan = ARTEN[e.art];
        if (!plan) f(`${ort}: unbekannte Art „${e.art}“ (erlaubt: ${Object.keys(ARTEN).join(', ')})`);
        for (const p of PFLICHT[e.art]) if (e[p] === undefined) f(`${ort} (${e.art}): ${p} fehlt`);
        for (const [k, w] of Object.entries(e)) {
            if (k === 'art') continue;
            const typ = plan[k];
            if (!typ) f(`${ort} (${e.art}): unbekanntes Feld „${k}“`);
            if (Array.isArray(typ)) { if (!typ.includes(w)) f(`${ort}: ${k} muss eines von ${typ.join(', ')} sein`); continue; }
            if (typ === 'zahl' && !istZahl(w)) f(`${ort}: ${k} muss eine Zahl sein`);
            if (typ === 'wahr' && typeof w !== 'boolean') f(`${ort}: ${k} muss true oder false sein`);
            if (typ === 'text' && !(typeof w === 'string' || istZahl(w))) f(`${ort}: ${k} muss Text sein`);
            if (typ === 'text' && String(w).length > GRENZEN.textMax) f(`${ort}: ${k} länger als ${GRENZEN.textMax} Zeichen`);
            if (typ === 'liste' && (!Array.isArray(w) || w.length < 2 || w.length > 8 || !w.every((x) => typeof x === 'string'))) f(`${ort}: ${k} braucht 2 bis 8 Farben`);
            if (typ === 'name' && !wertNamen.has(w)) f(`${ort}: ${k} nennt den Wert „${w}“, den die Vorlage nicht erklärt`);
            if (typ === 'ringe') {
                if (!Array.isArray(w) || w.length > 4) f(`${ort}: ringe ist eine Liste mit höchstens 4 Ringen`);
                for (const r of w) if (!r || !istZahl(r.abstand) || !istZahl(r.breite) || typeof r.farbe !== 'string' || Object.keys(r).some((x) => !['abstand', 'breite', 'farbe'].includes(x))) f(`${ort}: Ring braucht abstand, breite, farbe`);
            }
        }
        if (e.art === 'text' && e.min_groesse !== undefined && e.min_groesse > e.groesse) f(`${ort}: min_groesse größer als groesse`);
    });

    // Jeder eigene Platzhalter muss erklärt sein: ein Tippfehler zeichnet sonst still „{levle}“.
    const kern = new Set(require('dunebot-core/lib/PlaceholderParser').PLATZHALTER.map((p) => p.name));
    for (const n of platzhalterIn(JSON.stringify(roh.ebenen))) {
        if (kern.has(n) || wertNamen.has(n)) continue;
        const [vorn, hinten] = n.split(':');
        if (vorn === 'farbe' && Gestaltung.ROLLEN.includes(hinten)) continue;
        if (vorn === 'gestaltung' && ['logo', 'banner'].includes(hinten)) continue;
        if (vorn === 'text' && hinten in texte) continue;
        f(`Platzhalter {${n}} ist weder Kern, Wert, Farbe noch Text dieser Vorlage`);
    }
    return Object.freeze(roh);
}

const vorlagen = new Map();

/** Datei zu einem Namen, oder Fehler. */
function dateiVon(name) {
    const m = NAME.exec(String(name || ''));
    if (!m) throw new Kartenfehler(`Bildkarte: ungültiger Name „${name}“ (erwartet plugin:name)`);
    const [, besitzer, karte] = m;
    return besitzer === 'kern' ? path.join(KERN_ORDNER, `${karte}.json`) : path.join(PLUGINS, besitzer, 'bildkarten', `${karte}.json`);
}

/**
 * Vorlage nach Namen, einmal je Prozess gelesen und geprüft.
 * @param {string} name `kern:rangkarte`, `greeting:willkommen`
 */
function vorlage(name) {
    if (vorlagen.has(name)) return vorlagen.get(name);
    const datei = dateiVon(name);
    let roh;
    try { roh = JSON.parse(fs.readFileSync(datei, 'utf8')); } catch (err) {
        throw new Kartenfehler(`Bildkarte ${name}: ${path.relative(WURZEL, datei)} nicht lesbar (${err.message})`);
    }
    const v = pruefe(roh, `Bildkarte ${name}`);
    vorlagen.set(name, v);
    return v;
}

/** Alle Vorlagen auf der Platte: Kern zuerst, dann je Plugin. */
function liste() {
    const aus = [];
    const lies = (ordner, besitzer) => {
        let dateien = [];
        try { dateien = fs.readdirSync(ordner).filter((d) => d.endsWith('.json')).sort(); } catch { return; }
        for (const d of dateien) aus.push(`${besitzer}:${d.slice(0, -5)}`);
    };
    lies(KERN_ORDNER, 'kern');
    let plugins = [];
    try { plugins = fs.readdirSync(PLUGINS).sort(); } catch { /* ohne Plugins */ }
    for (const p of plugins) lies(path.join(PLUGINS, p, 'bildkarten'), p);
    return aus;
}

// ─────────────────────────────────────────────────────────────────────────
// Bilder
// ─────────────────────────────────────────────────────────────────────────

/**
 * Puffer zu Bild. `loadImage` mit leerem Puffer kehrt nie zurück (gemessen
 * 2026-11-14, @napi-rs/canvas 0.1.97): kein Fehler, das Promise bleibt offen.
 * Deshalb leer vorher abweisen und jedes Dekodieren mit einer Frist.
 */
async function dekodiere(puffer) {
    if (!puffer || !puffer.length) throw new Error('leere Antwort');
    let uhr;
    const frist = new Promise((_, nein) => { uhr = setTimeout(() => nein(new Error('Dekodieren dauert zu lange')), GRENZEN.ladenMs); });
    try {
        return await Promise.race([canvas().loadImage(puffer), frist]);
    } finally {
        clearTimeout(uhr);
    }
}

/**
 * Ein Bild laden, nur aus der Medienablage dieser Guild oder von Discord.
 * @returns {Promise<import('@napi-rs/canvas').Image|null>}
 */
async function ladeBild(adresse, guildId, hinweise) {
    const a = String(adresse || '').trim();
    if (!a) return null;
    try {
        const basis = String(process.env.DASHBOARD_BASE_URL || '').replace(/\/+$/, '');
        let pfad = null;
        if (a.startsWith('/uploads/media/')) pfad = a;
        else if (basis && a.startsWith(`${basis}/uploads/media/`)) pfad = a.slice(basis.length);
        if (pfad) {
            const [gid, datei] = decodeURIComponent(pfad.slice('/uploads/media/'.length)).split('/');
            if (!GUILD.test(gid || '') || gid !== String(guildId) || !DATEI.test(datei || '') || datei.startsWith('.')) {
                hinweise.push(`Bild ${a}: nicht aus der Medienablage dieser Guild, weggelassen`);
                return null;
            }
            const datei2 = path.join(MEDIEN, gid, datei);
            const st = await fs.promises.stat(datei2);
            if (st.size > GRENZEN.bildMaxBytes) { hinweise.push(`Bild ${datei}: größer als 8 MB, weggelassen`); return null; }
            return await dekodiere(await fs.promises.readFile(datei2));
        }
        if (!DISCORD.test(a)) {
            hinweise.push(`Bild ${a.slice(0, 80)}: nur Medienablage oder Discord erlaubt, weggelassen`);
            return null;
        }
        const antwort = await fetch(a, { redirect: 'error', signal: AbortSignal.timeout(GRENZEN.ladenMs) });
        if (!antwort.ok) { hinweise.push(`Bild ${a.slice(0, 80)}: HTTP ${antwort.status}`); return null; }
        const laenge = Number(antwort.headers.get('content-length') || 0);
        if (laenge > GRENZEN.bildMaxBytes) { hinweise.push(`Bild ${a.slice(0, 80)}: größer als 8 MB, weggelassen`); return null; }
        const puffer = Buffer.from(await antwort.arrayBuffer());
        if (puffer.length > GRENZEN.bildMaxBytes) { hinweise.push(`Bild ${a.slice(0, 80)}: größer als 8 MB, weggelassen`); return null; }
        return await dekodiere(puffer);
    } catch (err) {
        hinweise.push(`Bild ${a.slice(0, 80)}: ${err.message}`);
        return null;
    }
}

// ─────────────────────────────────────────────────────────────────────────
// Zeichnen
// ─────────────────────────────────────────────────────────────────────────

function rundesRechteck(ctx, x, y, b, h, r) {
    const rr = Math.max(0, Math.min(r || 0, b / 2, h / 2));
    ctx.beginPath();
    if (rr === 0) { ctx.rect(x, y, b, h); return; }
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + b, y, x + b, y + h, rr);
    ctx.arcTo(x + b, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + b, y, rr);
    ctx.closePath();
}

/** Bild in ein Feld legen: füllen (beschneiden) oder einpassen. */
function legeBild(ctx, bild, x, y, b, h, passung) {
    const s = passung === 'einpassen' ? Math.min(b / bild.width, h / bild.height) : Math.max(b / bild.width, h / bild.height);
    const bb = bild.width * s;
    const bh = bild.height * s;
    ctx.drawImage(bild, x + (b - bb) / 2, y + (h - bh) / 2, bb, bh);
}

/**
 * Eine Vorlage zeichnen.
 *
 * @param {string|Object} vorlageOderName Name (`kern:rangkarte`) oder geprüfte Vorlage
 * @param {Object} kontext
 * @param {import('discord.js').GuildMember} [kontext.member]
 * @param {import('discord.js').Guild} [kontext.guild]
 * @param {Object<string, string|number|string[]>} [kontext.werte] die Werte der Vorlage
 * @param {Object} optionen
 * @param {string} optionen.guildId Palette, Logo, Medienablage
 * @param {string} [optionen.plugin] wer fragt (Farben des Plugins, G-09)
 * @param {string} [optionen.sprache] `de-DE`/`en-GB`; sonst `guild.locale`, sonst Deutsch
 * @returns {Promise<{puffer: Buffer, typ: 'png'|'jpeg', breite: number, hoehe: number, bytes: number, ms: number, hinweise: string[], dateiname: Function}>}
 */
async function zeichne(vorlageOderName, kontext = {}, optionen = {}) {
    const start = process.hrtime.bigint();
    const v = typeof vorlageOderName === 'string' ? vorlage(vorlageOderName) : pruefe(vorlageOderName);
    const guildId = String(optionen.guildId || kontext.guild?.id || kontext.member?.guild?.id || '');
    const hinweise = [];
    const member = kontext.member || null;
    const guild = kontext.guild || member?.guild || null;
    const sprache = String(optionen.sprache || guild?.locale || 'de-DE').toLowerCase().startsWith('de') ? 'de' : 'en';

    // Werte: zuerst ihre eigenen Kern-Platzhalter ersetzen, dann als extra.
    const extra = {};
    const listen = {};
    const gegeben = kontext.werte || {};
    for (const w of v.werte || []) {
        const roh = w.name in gegeben ? gegeben[w.name] : w.beispiel;
        if (Array.isArray(roh)) { listen[w.name] = roh.map(String); continue; }
        extra[w.name] = String(parsePlaceholders(String(roh ?? ''), { member, guild }) ?? '');
    }
    for (const [n, t] of Object.entries(v.texte || {})) extra[`text:${n}`] = t[sprache];

    const quelltext = JSON.stringify(v.ebenen);
    if (quelltext.includes('{farbe:')) {
        try {
            const p = await Gestaltung.farben(guildId, optionen.plugin);
            for (const r of Gestaltung.ROLLEN) extra[`farbe:${r}`] = p[r].hex;
        } catch (err) {
            hinweise.push(`Palette nicht lesbar, nehme die Vorgabe: ${err.message}`);
            for (const r of Gestaltung.ROLLEN) extra[`farbe:${r}`] = Gestaltung.erklaerung(optionen.plugin)?.rollen[r] || Gestaltung.KERN_VORGABE[r];
        }
    }
    if (quelltext.includes('{gestaltung:')) {
        const b = await Gestaltung.bilder(guildId);
        extra['gestaltung:logo'] = b.logo || '';
        extra['gestaltung:banner'] = b.banner || '';
    }
    const fuell = (t) => String(parsePlaceholders(String(t ?? ''), { member, guild, extra }) ?? '');
    const farbe = (t, fallback) => {
        const w = fuell(t).trim();
        if (FARBE.test(w)) return w;
        if (w) hinweise.push(`Farbe „${w.slice(0, 40)}“ ungültig`);
        return fallback;
    };

    // Bilder vorab und gleichzeitig laden: Das Laden ist der teure Teil.
    const avatarVon = (e) => {
        if (e.quelle !== undefined) return fuell(e.quelle);
        if (!member) return '';
        try { return member.displayAvatarURL({ extension: 'png', size: 256, forceStatic: true }); } catch { return ''; }
    };
    const auftraege = v.ebenen.map((e) => {
        if (e.art === 'bild') return ladeBild(fuell(e.quelle), guildId, hinweise);
        if (e.art === 'avatar') return ladeBild(avatarVon(e), guildId, hinweise);
        if (e.art === 'bildreihe') return Promise.all((listen[e.liste] || []).slice(0, e.max ?? 12).map((a) => ladeBild(a, guildId, hinweise)));
        return null;
    });
    const bilder = await Promise.all(auftraege);

    const { createCanvas } = canvas();
    const leinwand = createCanvas(v.breite, v.hoehe);
    const ctx = leinwand.getContext('2d');
    if (v.ecken) { rundesRechteck(ctx, 0, 0, v.breite, v.hoehe, v.ecken); ctx.clip(); }

    v.ebenen.forEach((e, i) => {
        ctx.save();
        try {
            zeichneEbene(ctx, e, bilder[i], { v, fuell, farbe, member, hinweise });
        } finally {
            ctx.restore();
        }
    });

    let puffer = leinwand.toBuffer('image/png');
    let typ = 'png';
    if (puffer.length > PNG_MAX_BYTES) {
        puffer = leinwand.toBuffer('image/jpeg', 90);
        typ = 'jpeg';
    }
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    return {
        puffer, typ, breite: v.breite, hoehe: v.hoehe, bytes: puffer.length, ms: Math.round(ms), hinweise,
        dateiname: (basis) => `${basis}.${typ === 'png' ? 'png' : 'jpg'}`,
    };
}

function zeichneEbene(ctx, e, bild, { v, fuell, farbe, member, hinweise }) {
    const x = e.x ?? 0;
    const y = e.y ?? 0;
    const b = e.b ?? v.breite;
    const h = e.h ?? v.hoehe;
    if (e.deckkraft !== undefined) ctx.globalAlpha = Math.max(0, Math.min(1, e.deckkraft));

    switch (e.art) {
        case 'flaeche': {
            if (e.verlauf) {
                const ende = { diagonal: [x + b, y + h], waagrecht: [x + b, y], senkrecht: [x, y + h] }[e.richtung || 'diagonal'];
                const g = ctx.createLinearGradient(x, y, ende[0], ende[1]);
                e.verlauf.forEach((f, n) => g.addColorStop(n / (e.verlauf.length - 1), farbe(f, '#000000')));
                ctx.fillStyle = g;
            } else {
                ctx.fillStyle = farbe(e.farbe ?? '#000000', '#000000');
            }
            if (e.radius) { rundesRechteck(ctx, x, y, b, h, e.radius); ctx.fill(); } else ctx.fillRect(x, y, b, h);
            return;
        }
        case 'gitter': {
            ctx.strokeStyle = farbe(e.farbe, 'transparent');
            ctx.lineWidth = e.breite ?? 1;
            const abstand = Math.max(4, e.abstand);
            for (let gx = x; gx < x + b; gx += abstand) { ctx.beginPath(); ctx.moveTo(gx, y); ctx.lineTo(gx, y + h); ctx.stroke(); }
            for (let gy = y; gy < y + h; gy += abstand) { ctx.beginPath(); ctx.moveTo(x, gy); ctx.lineTo(x + b, gy); ctx.stroke(); }
            return;
        }
        case 'leuchten': {
            const g = ctx.createRadialGradient(e.mx, e.my, e.r_innen ?? 0, e.mx, e.my, e.r_aussen);
            g.addColorStop(0, farbe(e.farbe, 'transparent'));
            g.addColorStop(1, 'transparent');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(e.mx, e.my, e.r_aussen, 0, Math.PI * 2);
            ctx.fill();
            return;
        }
        case 'bild': {
            if (!bild) return;
            if (e.radius) { rundesRechteck(ctx, x, y, b, h, e.radius); ctx.clip(); }
            legeBild(ctx, bild, x, y, b, h, e.passung);
            if (e.abdunkeln) { ctx.globalAlpha = Math.max(0, Math.min(1, e.abdunkeln)); ctx.fillStyle = '#000000'; ctx.fillRect(x, y, b, h); }
            return;
        }
        case 'avatar': {
            const r = e.groesse / 2;
            const mx = x + r;
            const my = y + r;
            const ersatz = farbe(e.ersatz_farbe ?? '#5865f2', '#5865f2');
            if (bild) {
                ctx.save();
                ctx.beginPath();
                ctx.arc(mx, my, r, 0, Math.PI * 2);
                ctx.closePath();
                ctx.clip();
                ctx.drawImage(bild, x, y, e.groesse, e.groesse);
                ctx.restore();
            } else {
                ctx.fillStyle = ersatz;
                ctx.beginPath();
                ctx.arc(mx, my, r, 0, Math.PI * 2);
                ctx.fill();
                const name = member?.user?.username || member?.displayName || '?';
                ctx.fillStyle = '#ffffff';
                ctx.font = schrift('text', true, Math.round(e.groesse * 0.45));
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(([...name][0] || '?').toUpperCase(), mx, my);
            }
            for (const ring of e.ringe || []) {
                ctx.strokeStyle = farbe(ring.farbe, 'transparent');
                ctx.lineWidth = ring.breite;
                ctx.beginPath();
                ctx.arc(mx, my, r + ring.abstand, 0, Math.PI * 2);
                ctx.stroke();
            }
            return;
        }
        case 'text': {
            let text = fuell(e.text);
            if (e.gross) text = text.toUpperCase();
            if (!text) return;
            const rolle = e.schrift || 'text';
            let groesse = e.groesse;
            const min = e.min_groesse ?? Math.max(8, Math.round(e.groesse * 0.6));
            ctx.font = schrift(rolle, e.fett, groesse);
            if (e.max_breite) {
                while (groesse > min && ctx.measureText(text).width > e.max_breite) {
                    groesse -= 1;
                    ctx.font = schrift(rolle, e.fett, groesse);
                }
                if (ctx.measureText(text).width > e.max_breite) {
                    const zeichen = [...text];
                    while (zeichen.length > 1 && ctx.measureText(zeichen.join('') + '…').width > e.max_breite) zeichen.pop();
                    text = zeichen.join('') + '…';
                }
            }
            ctx.fillStyle = farbe(e.farbe ?? '#ffffff', '#ffffff');
            ctx.textAlign = { links: 'left', mitte: 'center', rechts: 'right' }[e.ausrichtung || 'links'];
            ctx.textBaseline = { mitte: 'middle', oben: 'top', unten: 'bottom', alphabetisch: 'alphabetic' }[e.grundlinie || 'alphabetisch'];
            ctx.fillText(text, x, y);
            return;
        }
        case 'balken': {
            const wert = Number(fuell(e.wert));
            const max = Number(fuell(e.max));
            const anteil = Number.isFinite(wert) && Number.isFinite(max) && max > 0 ? Math.max(0, Math.min(1, wert / max)) : 0;
            if (!(Number.isFinite(wert) && Number.isFinite(max))) hinweise.push(`Balken: „${fuell(e.wert)}“ von „${fuell(e.max)}“ ist keine Zahl`);
            const r = e.radius ?? h / 2;
            ctx.fillStyle = farbe(e.grund ?? 'rgba(255,255,255,0.12)', 'rgba(255,255,255,0.12)');
            rundesRechteck(ctx, x, y, b, h, r);
            ctx.fill();
            if (anteil > 0) {
                ctx.save();
                rundesRechteck(ctx, x, y, b, h, r);
                ctx.clip();
                ctx.fillStyle = farbe(e.farbe ?? '{farbe:akzent}', '#3498db');
                rundesRechteck(ctx, x, y, Math.max(b * anteil, Math.min(b, 2 * r)), h, r);
                ctx.fill();
                ctx.restore();
            }
            return;
        }
        case 'bildreihe': {
            const abstand = e.abstand ?? 8;
            (bild || []).forEach((einzel, n) => {
                if (!einzel) return;
                const bx = x + n * (e.groesse + abstand);
                ctx.save();
                if (e.radius) { rundesRechteck(ctx, bx, y, e.groesse, e.groesse, e.radius); ctx.clip(); }
                legeBild(ctx, einzel, bx, y, e.groesse, e.groesse, 'einpassen');
                ctx.restore();
            });
            return;
        }
        default:
            throw new Kartenfehler(`unbekannte Art ${e.art}`);
    }
}

/**
 * Karte mit den Beispielwerten der Vorlage, für Seiten und Wächter.
 * Mitglied ist der angemeldete Nutzer (wie `Vorlage.beispielKontext`).
 */
async function beispiel(name, { guildId, guildName, nutzer, werte, sprache, plugin } = {}) {
    const { beispielKontext } = require('./Vorlage');
    const { member, guild } = beispielKontext(nutzer, { id: guildId, name: guildName });
    const besitzer = String(name).split(':')[0];
    return zeichne(name, { member, guild, werte }, { guildId, sprache, plugin: plugin || (besitzer === 'kern' ? undefined : besitzer) });
}

// ─────────────────────────────────────────────────────────────────────────
// Wer welche Karte nutzt (G-21, F-G11)
// ─────────────────────────────────────────────────────────────────────────

const NUTZUNG_FELDER = new Set(['titel', 'wo', 'seite', 'stand', 'schablonen']);
const SEITE = /^[a-z0-9_-]{1,32}(\/[a-z0-9_-]{1,32}){0,3}$/;
const STAND = /^[a-z0-9_-]{1,32}(\/[a-z0-9_-]{1,32}){0,3}\.js$/;

/** Werte, die das Plugin zur Laufzeit gibt (alle ohne `einstellbar`). */
function laufzeitWerte(v) {
    return new Set((v.werte || []).filter((w) => !w.einstellbar).map((w) => w.name));
}

/**
 * `schablonen` einer Erklärung (G-22): weitere Vorlagen, aus denen die Guild
 * für diese Nutzung wählen darf. Die erklärte Karte ist immer die erste und
 * die Vorgabe. Jede weitere ist eine eigene (`<p>:…`) oder eine des Kerns
 * und braucht keinen Laufzeitwert, den die erklärte nicht kennt: Sonst
 * zeichnete sie ihr Beispiel („Level 12“) statt der Werte des Plugins. Ein
 * Name in mehreren Vorlagen hat überall dieselbe Art, damit ein gespeicherter
 * Wert beim Wechsel passt.
 * `laden` nur für den Wächter (Vorlagen ohne Datei).
 * @returns {string[]|string} die Liste, oder was falsch ist
 */
function schablonenFehler(p, name, roh, vorhanden, laden = vorlage) {
    if (roh === undefined) return [name];
    if (!Array.isArray(roh) || !roh.length || roh.length > 8) return 'schablonen ist eine Liste mit 1 bis 8 Vorlagen';
    const liste = [name];
    let basis;
    try { basis = laden(name); } catch (err) { return err.message; }
    const kennt = laufzeitWerte(basis);
    const arten = new Map((basis.werte || []).map((w) => [w.name, w.einstellbar || null]));
    for (const s of roh) {
        const m = NAME.exec(String(s));
        if (!m || (m[1] !== p && m[1] !== 'kern')) return `schablonen: ${s} ist weder eigene (${p}:…) noch des Kerns`;
        if (s === name || liste.includes(s)) return `schablonen: ${s} doppelt (die erklärte Karte steht schon vorn)`;
        if (!vorhanden.has(s)) return `schablonen: keine Vorlage ${s}`;
        let v;
        try { v = laden(s); } catch (err) { return err.message; }
        const fremd = [...laufzeitWerte(v)].filter((w) => !kennt.has(w));
        if (fremd.length) return `schablonen: ${s} braucht ${fremd.join(', ')}, das ${name} nicht kennt`;
        for (const w of v.werte || []) {
            const art = w.einstellbar || null;
            if (arten.has(w.name) && arten.get(w.name) !== art) return `schablonen: ${w.name} ist in ${s} ${art || 'ein Laufzeitwert'}, anderswo ${arten.get(w.name) || 'ein Laufzeitwert'}`;
            arten.set(w.name, art);
        }
        liste.push(s);
    }
    return liste;
}

let nutzungenGelesen = null;

/**
 * Wer welche Karte nutzt, aus `bildkarten` in jeder `plugins/<p>/package.json`:
 *
 *     "bildkarten": {
 *       "greeting:willkommen": {
 *         "titel": "greeting:BILDKARTEN.TITEL_WILLKOMMEN",  // Pflicht bei eigenen Karten
 *         "wo":    "greeting:BILDKARTEN.WO_WILLKOMMEN",     // wo der Bot sie zeigt
 *         "seite": "nachrichten",                           // /guild/<id>/plugins/<p>/<seite>
 *         "stand": "shared/willkommensbild.js",             // exportiert stand(guildId) → {an, werte}
 *         "schablonen": ["greeting:willkommen-schlicht"]     // optional: weitere zur Wahl (G-22)
 *       }
 *     }
 *
 * `werte` aus `stand` sind die Laufzeitwerte des Plugins; Einstellbares
 * kommt aus der Einstellung der Guild (G-22).
 *
 * Ein Plugin erklärt nur eigene Karten (`<p>:…`) oder Schablonen des Kerns
 * (`kern:…`). Jede Karte eines Plugins muss erklärt sein, sonst sähe die Guild
 * sie ohne Ort. Einmal je Prozess gelesen; Fehler stehen in `fehler` (Wächter),
 * die Seite zeigt den Rest.
 *
 * @returns {{karten: Map<string, Array<{plugin: string, titel: string|null, wo: string, seite: string|null, stand: string|null}>>, fehler: string[]}}
 */
function nutzungen() {
    if (nutzungenGelesen) return nutzungenGelesen;
    const karten = new Map();
    const fehler = [];
    const vorhanden = new Set(liste());
    let plugins = [];
    try { plugins = fs.readdirSync(PLUGINS).sort(); } catch { /* ohne Plugins */ }
    for (const p of plugins) {
        let pkg;
        try { pkg = JSON.parse(fs.readFileSync(path.join(PLUGINS, p, 'package.json'), 'utf8')); } catch { continue; }
        const erkl = pkg.bildkarten;
        if (erkl === undefined) continue;
        if (!erkl || typeof erkl !== 'object' || Array.isArray(erkl)) { fehler.push(`${p}: bildkarten muss ein Objekt sein`); continue; }
        for (const [name, e] of Object.entries(erkl)) {
            const ort = `${p} → ${name}`;
            const m = NAME.exec(name);
            if (!m) { fehler.push(`${ort}: kein Name der Form plugin:karte`); continue; }
            if (m[1] !== p && m[1] !== 'kern') { fehler.push(`${ort}: nur eigene Karten (${p}:…) oder Schablonen des Kerns (kern:…)`); continue; }
            if (!vorhanden.has(name)) { fehler.push(`${ort}: keine Vorlage ${path.relative(WURZEL, dateiVon(name))}`); continue; }
            if (!e || typeof e !== 'object' || Array.isArray(e)) { fehler.push(`${ort}: kein Objekt`); continue; }
            const fremd = Object.keys(e).filter((k) => !NUTZUNG_FELDER.has(k));
            if (fremd.length) { fehler.push(`${ort}: unbekannte Felder ${fremd.join(', ')}`); continue; }
            if (typeof e.wo !== 'string' || !e.wo.startsWith(`${p}:`)) { fehler.push(`${ort}: wo braucht einen Übersetzungsschlüssel ${p}:…`); continue; }
            if (m[1] === p && (typeof e.titel !== 'string' || !e.titel.startsWith(`${p}:`))) { fehler.push(`${ort}: titel braucht einen Übersetzungsschlüssel ${p}:…`); continue; }
            if (m[1] === 'kern' && e.titel !== undefined) { fehler.push(`${ort}: Schablonen des Kerns haben ihren Titel im Kern`); continue; }
            if (e.seite !== undefined && (typeof e.seite !== 'string' || !SEITE.test(e.seite))) { fehler.push(`${ort}: seite ist ein Pfad unter /plugins/${p}/`); continue; }
            if (e.stand !== undefined && (typeof e.stand !== 'string' || !STAND.test(e.stand) || !fs.existsSync(path.join(PLUGINS, p, e.stand)))) {
                fehler.push(`${ort}: stand nennt keine Datei im Plugin (${e.stand})`);
                continue;
            }
            const schablonen = schablonenFehler(p, name, e.schablonen, vorhanden);
            if (typeof schablonen === 'string') { fehler.push(`${ort}: ${schablonen}`); continue; }
            if (!karten.has(name)) karten.set(name, []);
            karten.get(name).push({ plugin: p, karte: name, titel: e.titel || null, wo: e.wo, seite: e.seite || null, stand: e.stand || null, schablonen });
        }
    }
    for (const name of vorhanden) {
        const besitzer = name.split(':')[0];
        if (besitzer !== 'kern' && !(karten.get(name) || []).some((n) => n.plugin === besitzer)) {
            fehler.push(`${name}: steht nicht unter bildkarten in plugins/${besitzer}/package.json`);
        }
    }
    nutzungenGelesen = { karten, fehler };
    return nutzungenGelesen;
}

/**
 * Stand einer Nutzung in einer Guild: an oder aus, und die Werte, mit denen
 * der Bot die Karte dort zeichnet. Ohne `stand` in der Erklärung: unbekannt.
 * Scheitert das Plugin, steht der Grund in `fehler`, die Seite zeigt dann
 * die Beispielwerte.
 * @returns {Promise<{an: boolean|null, werte: Object|null, fehler: string|null}>}
 */
async function nutzungStand(nutzung, guildId) {
    if (!nutzung?.stand) return { an: null, werte: null, fehler: null };
    try {
        const modul = require(path.join(PLUGINS, nutzung.plugin, nutzung.stand));
        if (typeof modul.stand !== 'function') throw new Error(`${nutzung.stand} exportiert kein stand()`);
        const s = await modul.stand(String(guildId));
        return { an: typeof s?.an === 'boolean' ? s.an : null, werte: s?.werte && typeof s.werte === 'object' ? s.werte : null, fehler: null };
    } catch (err) {
        return { an: null, werte: null, fehler: err.message };
    }
}

// ─────────────────────────────────────────────────────────────────────────
// Einstellungen je Guild (G-22, F-G11)
// ─────────────────────────────────────────────────────────────────────────
//
// Kern-Tabelle `guild_bildkarten`, eine Zeile je Guild, Plugin und Karte
// (die erklärte, `greeting:willkommen`). `vorlage` ist die gewählte Schablone
// (NULL = die erklärte), `werte` nur, was von der Vorgabe abweicht. Bilder
// stehen als `guild_media.id` darin; gelesen wird nur ein Bild derselben
// Guild. Keine Mitgliederdaten, geht mit der Guild (core `guildInhalte`).
//
// Eingestellt wird nur im Bereich „Bildkarten“ (F-G11 Punkt 2). Der Bot
// zeichnet über `zeichneNutzung`, die Seiten über `beispielNutzung`: dieselbe
// Rechnung, keine Kopie im Plugin.

function db() {
    return require('dunebot-core').ServiceManager.get('dbService');
}

/** Die Nutzung eines Plugins, oder Eingabefehler. */
function nutzungVon(plugin, karte) {
    const n = (nutzungen().karten.get(String(karte)) || []).find((x) => x.plugin === String(plugin));
    if (!n) throw new Eingabefehler(`${plugin} erklärt keine Bildkarte ${karte}.`);
    return n;
}

/** Die einstellbaren Werte einer Vorlage, in ihrer Reihenfolge. */
function einstellbar(v) {
    return (v.werte || []).filter((w) => w.einstellbar);
}

function alsJson(roh) {
    if (!roh) return {};
    if (typeof roh === 'object') return roh;
    try { const p = JSON.parse(roh); return p && typeof p === 'object' && !Array.isArray(p) ? p : {}; } catch { return {}; }
}

/**
 * Gespeichertes gegen die Vorlage prüfen und zum Zeichnen auflösen. Was nicht
 * (mehr) passt, fällt auf die Vorgabe und steht in `hinweise`: eine Schablone,
 * die das Plugin nicht mehr anbietet, ein Wert falscher Art, ein gelöschtes Bild.
 *
 * @param {Object} nutzung aus `nutzungen()`
 * @param {string} guildId
 * @param {{vorlage?: string|null, werte?: Object}} gespeichert Bilder als Medien-ID
 * @returns {Promise<{vorlage: string, werte: Object<string,string>, gespeichert: {vorlage: string|null, werte: Object}, hinweise: string[]}>}
 */
async function einstellungAufloesen(nutzung, guildId, gespeichert = {}) {
    const hinweise = [];
    let name = nutzung.karte;
    if (gespeichert.vorlage && gespeichert.vorlage !== nutzung.karte) {
        if (nutzung.schablonen.includes(gespeichert.vorlage)) name = gespeichert.vorlage;
        else hinweise.push(`Schablone ${gespeichert.vorlage} bietet ${nutzung.plugin} nicht mehr an, nehme ${nutzung.karte}`);
    }
    const v = vorlage(name);
    const roh = alsJson(gespeichert.werte);
    const werte = {};
    const behalten = {};
    const bilder = new Map();
    for (const w of einstellbar(v)) {
        werte[w.name] = w.beispiel;
        if (!(w.name in roh)) continue;
        const falsch = wertFalsch(w.einstellbar, roh[w.name]);
        if (falsch) { hinweise.push(`${w.name} ${falsch}, nehme die Vorgabe`); continue; }
        behalten[w.name] = roh[w.name];
        if (w.einstellbar === 'bild') bilder.set(w.name, roh[w.name]);
        else werte[w.name] = roh[w.name];
    }
    if (bilder.size) {
        const ids = [...new Set(bilder.values())];
        const zeilen = await db().query(
            `SELECT id, stored_name FROM guild_media WHERE guild_id = ? AND mime_type LIKE 'image/%' AND id IN (${ids.map(() => '?').join(', ')})`,
            [String(guildId), ...ids]
        );
        const datei = new Map((zeilen || []).map((z) => [Number(z.id), z.stored_name]));
        for (const [n, id] of bilder) {
            if (datei.has(id)) werte[n] = `/uploads/media/${encodeURIComponent(String(guildId))}/${encodeURIComponent(datei.get(id))}`;
            else hinweise.push(`${n}: Das Bild liegt nicht mehr in der Medienablage, nehme keins`);
        }
    }
    return { vorlage: name, werte, gespeichert: { vorlage: name === nutzung.karte ? null : name, werte: behalten }, hinweise };
}

/**
 * Was eine Guild für eine Nutzung eingestellt hat, aufgelöst zum Zeichnen.
 * Ohne Zeile: die erklärte Karte mit ihren Vorgaben.
 */
async function einstellung(plugin, karte, guildId) {
    const n = nutzungVon(plugin, karte);
    const zeilen = await db().query(
        'SELECT vorlage, werte FROM guild_bildkarten WHERE guild_id = ? AND plugin = ? AND karte = ?',
        [String(guildId), n.plugin, n.karte]
    );
    const z = zeilen?.[0];
    return einstellungAufloesen(n, guildId, z ? { vorlage: z.vorlage, werte: z.werte } : {});
}

/** Adresse aus der Medienwahl → `guild_media.id` dieser Guild (wie Logo und Banner, G-09). */
async function medienId(guildId, adresse, titel) {
    const a = String(adresse || '').trim();
    if (!a) return null;
    const basis = String(process.env.DASHBOARD_BASE_URL || '').replace(/\/+$/, '');
    const pfad = basis && a.startsWith(basis) ? a.slice(basis.length) : a;
    const praefix = `/uploads/media/${guildId}/`;
    let datei = '';
    try { datei = pfad.startsWith(praefix) ? decodeURIComponent(pfad.slice(praefix.length)) : ''; } catch { datei = ''; }
    if (!datei || datei.includes('/')) throw new Eingabefehler(`${titel}: Bitte ein Bild aus der Medienablage dieses Servers wählen.`);
    const zeilen = await db().query(
        "SELECT id FROM guild_media WHERE guild_id = ? AND stored_name = ? AND mime_type LIKE 'image/%'",
        [String(guildId), datei]
    );
    if (!zeilen?.[0]) throw new Eingabefehler(`${titel}: Das Bild liegt nicht in der Medienablage dieses Servers.`);
    return Number(zeilen[0].id);
}

/** Platzhalter in einem Text der Guild, die der Renderer nicht kennt. */
function fremdePlatzhalter(text) {
    const kern = new Set(require('dunebot-core/lib/PlaceholderParser').PLATZHALTER.map((p) => p.name));
    return platzhalterIn(text).filter((n) => !kern.has(n));
}

/**
 * Eingabe aus dem Bereich prüfen, in die Form der Tabelle. Nur, was von der
 * Vorgabe abweicht, bleibt; leerer Text heißt Vorgabe, leeres Bild keins.
 * Werte anderer Schablonen werden übergangen (Wechsel der Schablone).
 *
 * @param {Object} nutzung
 * @param {string} guildId
 * @param {{vorlage?: string, werte?: Object<string,string>}} eingabe Bilder als Adresse aus der Medienwahl
 * @param {'de'|'en'} [sprache] für die Titel in Meldungen
 * @returns {Promise<{vorlage: string|null, werte: Object}>}
 */
async function eingabePruefen(nutzung, guildId, eingabe = {}, sprache = 'de') {
    const gewaehlt = String(eingabe.vorlage || '') || nutzung.karte;
    if (!nutzung.schablonen.includes(gewaehlt)) throw new Eingabefehler(`Die Schablone ${gewaehlt} gibt es für diese Karte nicht.`);
    const v = vorlage(gewaehlt);
    const roh = eingabe.werte && typeof eingabe.werte === 'object' ? eingabe.werte : {};
    const werte = {};
    for (const w of einstellbar(v)) {
        if (!(w.name in roh)) continue;
        const titel = w.titel[sprache] || w.titel.de;
        const x = roh[w.name];
        if (x !== null && typeof x !== 'string') throw new Eingabefehler(`${titel}: kein Text.`);
        const s = String(x ?? '').trim();
        if (w.einstellbar === 'farbe') {
            if (!s) continue;
            if (!HEX6.test(s)) throw new Eingabefehler(`${titel}: „${s.slice(0, 20)}“ ist kein Farbwert wie #3498db.`);
            if (s.toLowerCase() !== w.beispiel.toLowerCase()) werte[w.name] = s.toLowerCase();
        } else if (w.einstellbar === 'text') {
            if (!s || s === w.beispiel) continue;
            if (s.length > TEXT_EINSTELLBAR_MAX) throw new Eingabefehler(`${titel}: höchstens ${TEXT_EINSTELLBAR_MAX} Zeichen.`);
            const fremd = fremdePlatzhalter(s);
            if (fremd.length) throw new Eingabefehler(`${titel}: Platzhalter ${fremd.map((n) => `{${n}}`).join(', ')} gibt es hier nicht.`);
            werte[w.name] = s;
        } else if (w.einstellbar === 'bild') {
            const id = await medienId(guildId, s, titel);
            if (id !== null) werte[w.name] = id;
        }
    }
    return { vorlage: gewaehlt === nutzung.karte ? null : gewaehlt, werte };
}

/**
 * Einstellung speichern. Bleibt nichts Abweichendes, verschwindet die Zeile
 * (die Karte zeichnet dann wieder die Vorgabe). Das Recht prüft die Route.
 * @returns {Promise<Object>} die neue Einstellung wie `einstellung()`
 */
async function speichereEinstellung(plugin, karte, guildId, eingabe, sprache) {
    const n = nutzungVon(plugin, karte);
    const g = await eingabePruefen(n, guildId, eingabe, sprache);
    if (!g.vorlage && !Object.keys(g.werte).length) {
        await db().query('DELETE FROM guild_bildkarten WHERE guild_id = ? AND plugin = ? AND karte = ?', [String(guildId), n.plugin, n.karte]);
    } else {
        await db().query(
            `INSERT INTO guild_bildkarten (guild_id, plugin, karte, vorlage, werte) VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE vorlage = VALUES(vorlage), werte = VALUES(werte)`,
            [String(guildId), n.plugin, n.karte, g.vorlage, JSON.stringify(g.werte)]
        );
    }
    return einstellung(plugin, karte, guildId);
}

/** Werte zum Zeichnen: Einstellung der Guild, dazu die Laufzeitwerte des Plugins. */
function werteZusammen(e, laufzeit) {
    const v = vorlage(e.vorlage);
    const eigen = new Set(einstellbar(v).map((w) => w.name));
    const werte = { ...e.werte };
    for (const [k, x] of Object.entries(laufzeit || {})) if (!eigen.has(k)) werte[k] = x;
    return werte;
}

/**
 * Eine Nutzung zeichnen, wie die Guild sie eingestellt hat: gewählte
 * Schablone, ihre Werte, dazu die Laufzeitwerte des Plugins unter
 * `kontext.werte` (einstellbare Namen darin zählen nicht). Ist die
 * Einstellung nicht lesbar, zeichnet die Karte die Vorgabe und sagt es in
 * `hinweise`.
 *
 *     const karte = await Bildkarte.zeichneNutzung('greeting', 'greeting:willkommen', { member }, { guildId });
 *
 * @param {string} plugin
 * @param {string} karte die erklärte Karte
 * @param {Object} kontext wie `zeichne` (member, guild, werte)
 * @param {{guildId: string, sprache?: string, einstellung?: Object}} optionen `einstellung` nur für Vorschauen
 */
async function zeichneNutzung(plugin, karte, kontext = {}, optionen = {}) {
    const n = nutzungVon(plugin, karte);
    const guildId = String(optionen.guildId || kontext.guild?.id || kontext.member?.guild?.id || '');
    let e = optionen.einstellung;
    if (!e) {
        try {
            e = await einstellung(plugin, karte, guildId);
        } catch (err) {
            e = await einstellungAufloesen(n, guildId, {});
            e.hinweise.push(`Einstellung nicht lesbar, nehme die Vorgabe: ${err.message}`);
        }
    }
    const bild = await zeichne(e.vorlage, { ...kontext, werte: werteZusammen(e, kontext.werte) }, { guildId, plugin: n.plugin, sprache: optionen.sprache });
    bild.hinweise.unshift(...e.hinweise);
    return bild;
}

/** Wie `beispiel`, aber für eine Nutzung samt Einstellung (Seiten im Bereich). */
async function beispielNutzung(plugin, karte, { guildId, guildName, nutzer, werte, sprache, einstellung: e } = {}) {
    const { beispielKontext } = require('./Vorlage');
    const { member, guild } = beispielKontext(nutzer, { id: guildId, name: guildName });
    return zeichneNutzung(plugin, karte, { member, guild, werte }, { guildId, sprache, einstellung: e });
}

/** Gelesene Vorlagen und Erklärungen vergessen (Wächter, nach dem Bearbeiten einer Datei). */
function vergiss() {
    vorlagen.clear();
    nutzungenGelesen = null;
}

module.exports = {
    ARTEN, PFLICHT, GRENZEN, PNG_MAX_BYTES, SYSTEM, EINSTELLBAR, TEXT_EINSTELLBAR_MAX, Kartenfehler, Eingabefehler,
    pruefe, vorlage, liste, zeichne, beispiel, schriftStand, nutzungen, nutzungStand, vergiss,
    einstellbar, einstellung, einstellungAufloesen, eingabePruefen, speichereEinstellung, zeichneNutzung, beispielNutzung,
    schablonenFehler, wertFalsch,
};
