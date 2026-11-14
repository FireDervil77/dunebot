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

class Kartenfehler extends Error {}

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
    const erlaubt = new Set(['titel', 'breite', 'hoehe', 'ecken', 'werte', 'texte', 'ebenen']);
    for (const k of Object.keys(roh)) if (!erlaubt.has(k)) f(`unbekanntes Feld „${k}“`);
    for (const k of ['breite', 'hoehe']) {
        if (!Number.isInteger(roh[k]) || roh[k] < GRENZEN.seiteMin || roh[k] > GRENZEN.seiteMax) f(`${k} muss eine ganze Zahl von ${GRENZEN.seiteMin} bis ${GRENZEN.seiteMax} sein`);
    }
    if (roh.ecken !== undefined && (!istZahl(roh.ecken) || roh.ecken < 0)) f('ecken muss eine Zahl ≥ 0 sein');

    const werte = roh.werte || [];
    if (!Array.isArray(werte)) f('werte muss eine Liste sein');
    const wertNamen = new Set();
    for (const w of werte) {
        if (!w || typeof w.name !== 'string' || !/^[a-z][a-z0-9_]{0,31}$/.test(w.name)) f(`Wert ohne gültigen Namen: ${JSON.stringify(w)}`);
        if (w.name.includes(':')) f(`Wert ${w.name}: kein Doppelpunkt`);
        if (!('beispiel' in w)) f(`Wert ${w.name} ohne Beispiel`);
        wertNamen.add(w.name);
    }

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

/** Gelesene Vorlagen vergessen (Wächter, nach dem Bearbeiten einer Datei). */
function vergiss() {
    vorlagen.clear();
}

module.exports = { ARTEN, PFLICHT, GRENZEN, PNG_MAX_BYTES, SYSTEM, Kartenfehler, pruefe, vorlage, liste, zeichne, beispiel, schriftStand, vergiss };
