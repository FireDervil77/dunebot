'use strict';

/**
 * Nachrichtenvorlagen (G-08, K382, 2026-11-14).
 *
 *     const { Vorlage } = require('dunebot-sdk');
 *     const v = await Vorlage.lade(guild.id, 'greeting:willkommen');
 *     const { nachricht } = await Vorlage.fuelle(v, { member }, { guildId: guild.id, erwaehnen: [member.id] });
 *     if (nachricht) await kanal.send(nachricht);
 *
 * # Eine Vorlage, drei Formen (F-G10 Punkt 4 A)
 *
 * Eine Vorlage hat immer dieselben Felder (`FELDER`) und eine Ausgabeform:
 *   - `text`:  nur der Nachrichtentext.
 *   - `embed`: Nachrichtentext über einem klassischen Embed.
 *   - `v2`:    Components V2. Nachrichtentext als erster Textblock, darunter
 *              ein Container mit Akzentleiste, Überschrift, Beschreibung,
 *              Vorschaubild rechts, Bild als Galerie, Trenner und Fußzeile.
 * Umschalten verliert nichts: Die Felder bleiben, nur die Ausgabe ändert sich.
 * Eine gesendete V2-Nachricht bleibt V2 (Discord lehnt das Zurücknehmen der
 * Markierung ab, gemessen 2026-11-14). Wer die Form einer stehenden Nachricht
 * wechselt, sendet neu statt zu bearbeiten.
 *
 * # Was beim Füllen gilt (gemessen 2026-11-14, baustellen.md G-08)
 *
 *   - Erwähnungen in V2-Textblöcken pingen, anders als im Embed. Deshalb trägt
 *     jede Ausgabe ausdrücklich `allowedMentions`: gepingt wird nur, wen der
 *     Aufrufer unter `erwaehnen` nennt, sonst niemand.
 *   - V2 nimmt höchstens 4000 Zeichen Text über alle Blöcke zusammen, und kein
 *     leerer Container. Beides fängt `fuelle` vorher ab (kürzen mit „…“, ohne
 *     Inhalt kein Container), damit eine Nachricht nicht still scheitert.
 *   - Das Vorschaubild schneidet Discord quadratisch zu: für Avatar und Logo.
 *     Breite Bilder gehören ins Feld „Bild“.
 *   - Dateien, auf die V2 mit `attachment://` verweist, stehen danach nicht in
 *     `message.attachments`, sondern in der Komponente.
 *   - Eine Adresse, die nach dem Füllen keine http(s)-Adresse ist, fällt weg
 *     (sonst lehnt Discord die ganze Nachricht ab).
 *
 * # Farbe
 *
 * Ebene 3 der Gestaltung (G-09): Eine Vorlage kann eine eigene Farbe tragen.
 * Ohne eigene Farbe gilt der Akzent der Guild (`Gestaltung.farbe`).
 *
 * # Ablage und Register
 *
 * Kern-Tabelle `guild_vorlagen (guild_id, anlass, stelle, inhalt)` (F-G10
 * Punkt 2 A). Der Anlass beginnt mit dem Plugin: `greeting:willkommen`. Jedes
 * Plugin erklärt seine Anlässe und Platzhalter in der package.json:
 *
 *     "vorlagen": {
 *       "recht": "GREETING.SETTINGS.EDIT",
 *       "platzhalter": [ { "name": "invites", "bedeutung": "greeting:…", "beispiel": "5" } ],
 *       "anlaesse": {
 *         "willkommen": { "titel": "greeting:…", "kern": ["member", "guild", "gestaltung"], "platzhalter": ["invites"] }
 *       }
 *     }
 *
 * # Stellen (K389, 2026-11-14)
 *
 * Hat ein Anlass mehrere Vorlagen je Guild (Ticket: eine Eröffnungsnachricht
 * je Kategorie), erklärt er `"je": "<Bedeutung>"` und jeder Aufruf der Ablage
 * nennt die Stelle als letztes Argument: `lade(guildId, 'ticket:eroeffnung',
 * String(kategorie.id))`. Die leere Stelle ist die Vorlage ohne Stelle. Ein
 * Anlass ohne `je` nimmt nur die leere Stelle; eine andere wirft.
 *
 * # Feste Teile (K389)
 *
 * Was eine Guild nicht gestaltet, aber in die Nachricht gehört, reicht der
 * Aufrufer an `fuelle`: `felder` (Name und Wert, z. B. die Antworten aus dem
 * Ticket-Formular; ohne Platzhalter-Ersetzung) und `komponenten` (Zeilen mit
 * Knöpfen). Sie stehen in jeder Form an ihrem Platz: im Embed als Felder, in
 * V2 als Textblock im Container, im Text als Zeilen.
 *
 * Die Platzhalter des Kerns stehen in `dunebot-core/lib/PlaceholderParser`
 * (`PLATZHALTER`) neben ihrer Ersetzung, dazu hier `{gestaltung:logo}` und
 * `{gestaltung:banner}` aus G-09.
 *
 * Bot und Dashboard nutzen dieselbe Datei. Wächter `scripts/check-vorlagen.js`.
 *
 * @module dunebot-sdk/lib/Vorlage
 */

const path = require('path');
const fs = require('fs');
const { parsePlaceholders, PLATZHALTER, platzhalterIn } = require('dunebot-core/lib/PlaceholderParser');
const Gestaltung = require('./Gestaltung');

const FORMEN = Object.freeze(['text', 'embed', 'v2']);

/** Textfelder mit ihrer Höchstlänge (Grenzen von Discord). */
const FELDER = Object.freeze({
    text: 2000,
    titel: 256,
    beschreibung: 4096,
    fusszeile: 2048,
    vorschaubild: 1000,
    bild: 1000,
});

/** Felder, die in Embed und V2 sichtbar sind (nicht in `text`). */
const AUFBAU = Object.freeze(['titel', 'beschreibung', 'vorschaubild', 'bild', 'fusszeile']);

const V2_TEXT_MAX = 4000;
const EMBED_GESAMT_MAX = 6000;
const GALERIE_MAX = 10;
/** `MessageFlags.IsComponentsV2` (gemessen in discord.js 14.28.1). */
const FLAG_V2 = 1 << 15;
const TYP = Object.freeze({ SECTION: 9, TEXT: 10, THUMBNAIL: 11, GALERIE: 12, TRENNER: 14, CONTAINER: 17 });

const HEX = /^#[0-9a-f]{6}$/;
const ADRESSE = /^https?:\/\/[^\s<>"]+$/;
const ANLASS = /^([a-z0-9_-]{1,32}):([a-z0-9_-]{1,40})$/;
const PLUGIN_NAME = /^[a-z0-9_-]{1,32}$/;
const PLATZHALTER_NAME = /^[A-Za-z][A-Za-z0-9_]*(?::[A-Za-z][A-Za-z0-9_]*)?$/;
const STELLE = /^[A-Za-z0-9_-]{0,40}$/;
/** Grenzen von Discord für Embed-Felder. */
const FELD_MAX = Object.freeze({ anzahl: 25, name: 256, wert: 1024 });
const PLUGINS = path.join(__dirname, '..', '..', '..', 'plugins');

/** Gruppen des Kerns, die ein Anlass unter `kern` nennen kann. */
const KERN_GRUPPEN = Object.freeze(['member', 'guild', 'gestaltung']);

/** Platzhalter aus der Gestaltung (G-09), gefüllt in `fuelle`. */
const GESTALTUNG_PLATZHALTER = Object.freeze([
    { name: 'gestaltung:logo', gruppe: 'gestaltung', schluessel: 'GESTALTUNG_LOGO' },
    { name: 'gestaltung:banner', gruppe: 'gestaltung', schluessel: 'GESTALTUNG_BANNER' },
]);

/** Beispielwerte des Kerns für die Vorschau, wo der Kontext nichts hergibt. */
const KERN_BEISPIEL = Object.freeze({
    'guild:memberCount': '42',
    count: '42',
    'guild:boostCount': '3',
    'guild:boostLevel': '1',
});

/**
 * Fehler in einer Eingabe. `schluessel` ist ein Kern-Text unter
 * `core:VORLAGEN.FEHLER.*`, `werte` füllt ihn.
 */
class Eingabefehler extends Error {
    constructor(schluessel, werte = {}, text) {
        super(text || `${schluessel} ${JSON.stringify(werte)}`);
        this.schluessel = schluessel;
        this.werte = werte;
    }
}

/**
 * Fehler oder Hinweis als Text in der Sprache der Seite.
 * @param {Function} tr Übersetzer `(schluessel, werte) => text`
 * @param {'FEHLER'|'HINWEIS'} art
 * @param {{schluessel: string, werte?: Object}} eintrag
 */
function alsText(tr, art, eintrag) {
    const werte = { ...(eintrag.werte || {}) };
    if (werte.feld) werte.feld = tr(`core:VORLAGEN.FELD_${String(werte.feld).toUpperCase()}`);
    return tr(`core:VORLAGEN.${art}.${eintrag.schluessel}`, werte);
}

function db() {
    const { ServiceManager } = require('dunebot-core');
    return ServiceManager.get('dbService');
}

function logger() {
    try { return require('dunebot-core').ServiceManager.get('Logger'); } catch { return null; }
}

/** Eine leere Vorlage. */
function leer() {
    return { form: 'text', text: '', titel: '', beschreibung: '', farbe: '', vorschaubild: '', bild: '', fusszeile: '', zeitstempel: false };
}

/**
 * Jede Eingabe in die eine Form bringen, ohne zu werfen: bekannte Felder,
 * Zeichenketten ohne Rand, Zeilenumbrüche als `\n`, Farbe klein oder leer.
 * Unbekannte Felder fallen weg. Für Gespeichertes und als erster Schritt von
 * `pruefe`.
 * @param {*} roh
 * @returns {Object}
 */
function normalisiere(roh) {
    const v = leer();
    if (!roh || typeof roh !== 'object') return v;
    v.form = FORMEN.includes(roh.form) ? roh.form : 'text';
    for (const feld of Object.keys(FELDER)) {
        const w = roh[feld];
        v[feld] = (typeof w === 'string' ? w : (typeof w === 'number' ? String(w) : '')).replace(/\r\n?/g, '\n').trim();
    }
    const f = typeof roh.farbe === 'string' ? roh.farbe.trim().toLowerCase() : '';
    v.farbe = HEX.test(f) ? f : '';
    v.zeitstempel = roh.zeitstempel === true || roh.zeitstempel === 'true' || roh.zeitstempel === 1;
    return v;
}

/** Steht in der Vorlage überhaupt etwas? */
function istLeer(v) {
    return !Object.keys(FELDER).some((f) => v[f]) && !v.zeitstempel;
}

/**
 * Eingabe prüfen. Wirft `Eingabefehler` mit Kern-Schlüssel.
 * @param {*} roh
 * @returns {Object} normalisierte Vorlage
 */
function pruefe(roh) {
    if (!roh || typeof roh !== 'object' || Array.isArray(roh)) throw new Eingabefehler('KEINE_VORLAGE');
    if (roh.form !== undefined && !FORMEN.includes(roh.form)) throw new Eingabefehler('FORM', { form: String(roh.form) });
    const farbe = typeof roh.farbe === 'string' ? roh.farbe.trim() : '';
    if (farbe && !HEX.test(farbe.toLowerCase())) throw new Eingabefehler('FARBE', { farbe });
    const v = normalisiere(roh);
    for (const [feld, max] of Object.entries(FELDER)) {
        if (v[feld].length > max) throw new Eingabefehler('ZU_LANG', { feld, max, laenge: v[feld].length });
    }
    if (v.form === 'v2') {
        const summe = v.text.length + v.titel.length + v.beschreibung.length + v.fusszeile.length;
        if (summe > V2_TEXT_MAX) throw new Eingabefehler('V2_ZU_LANG', { max: V2_TEXT_MAX, laenge: summe });
    }
    if (v.form === 'embed') {
        const summe = v.titel.length + v.beschreibung.length + v.fusszeile.length;
        if (summe > EMBED_GESAMT_MAX) throw new Eingabefehler('EMBED_ZU_LANG', { max: EMBED_GESAMT_MAX, laenge: summe });
    }
    for (const feld of ['vorschaubild', 'bild']) {
        // Eine Adresse oder etwas mit Platzhaltern, das erst beim Füllen eine wird.
        if (v[feld] && !ADRESSE.test(v[feld]) && platzhalterIn(v[feld]).length === 0) {
            throw new Eingabefehler('ADRESSE', { feld });
        }
    }
    return v;
}

// ─────────────────────────────────────────────────────────────────────────
// Register
// ─────────────────────────────────────────────────────────────────────────

/** plugin → Erklärung | null (aus der package.json, einmal je Prozess) */
const erklaerungen = new Map();

/**
 * Was ein Plugin unter `vorlagen` in seiner package.json erklärt.
 * @param {string} plugin
 * @returns {{recht: string|null, platzhalter: Object[], anlaesse: Object}|null}
 */
function erklaerung(plugin) {
    if (!plugin || !PLUGIN_NAME.test(plugin)) return null;
    if (erklaerungen.has(plugin)) return erklaerungen.get(plugin);
    let e = null;
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(PLUGINS, plugin, 'package.json'), 'utf8'));
        if (pkg.vorlagen && typeof pkg.vorlagen === 'object') {
            e = {
                recht: pkg.vorlagen.recht || null,
                platzhalter: Array.isArray(pkg.vorlagen.platzhalter) ? pkg.vorlagen.platzhalter : [],
                anlaesse: pkg.vorlagen.anlaesse && typeof pkg.vorlagen.anlaesse === 'object' ? pkg.vorlagen.anlaesse : {},
            };
        }
    } catch {
        e = null;
    }
    erklaerungen.set(plugin, e);
    return e;
}

/**
 * Ein Anlass mit allem, was der Editor braucht. Wirft, wenn ihn kein Plugin
 * erklärt: Ein Aufruf mit einem Tippfehler soll laut scheitern, nicht still
 * nichts senden.
 * @param {string} anlass z. B. `greeting:willkommen`
 * @returns {{anlass: string, plugin: string, name: string, recht: string|null, titel: string|null, je: string|null, platzhalter: Object[]}}
 */
function anlass(anlassName) {
    const m = ANLASS.exec(String(anlassName || ''));
    if (!m) throw new Eingabefehler('ANLASS', { anlass: String(anlassName) });
    const [, plugin, name] = m;
    const e = erklaerung(plugin);
    const a = e?.anlaesse?.[name];
    if (!a) throw new Eingabefehler('ANLASS', { anlass: anlassName });

    const liste = [];
    const gruppen = Array.isArray(a.kern) ? a.kern : KERN_GRUPPEN;
    for (const p of [...PLATZHALTER, ...GESTALTUNG_PLATZHALTER]) {
        if (!gruppen.includes(p.gruppe)) continue;
        liste.push({ name: p.name, gruppe: p.gruppe, bedeutung: `core:VORLAGEN.PH.${p.schluessel}`, alias: p.alias || null, beispiel: KERN_BEISPIEL[p.name] ?? null });
    }
    const eigene = new Map((e.platzhalter || []).map((p) => [p.name, p]));
    for (const n of Array.isArray(a.platzhalter) ? a.platzhalter : []) {
        const p = eigene.get(n);
        if (p) liste.push({ name: p.name, gruppe: plugin, bedeutung: p.bedeutung || null, alias: null, beispiel: p.beispiel ?? '' });
    }
    return { anlass: anlassName, plugin, name, recht: e.recht, titel: a.titel || null, je: a.je || null, platzhalter: liste };
}

/**
 * Anlass und Stelle zusammen prüfen. Wirft bei falscher Form oder bei einer
 * Stelle an einem Anlass ohne `je`.
 * @returns {string} die Stelle als Zeichenkette ('' = ohne)
 */
function stelleVon(anlassName, stelle) {
    const a = anlass(anlassName);
    const s = stelle === undefined || stelle === null ? '' : String(stelle);
    if (!STELLE.test(s)) throw new Eingabefehler('STELLE', { stelle: s });
    if (s && !a.je) throw new Eingabefehler('STELLE', { stelle: s });
    return s;
}

// ─────────────────────────────────────────────────────────────────────────
// Ablage
// ─────────────────────────────────────────────────────────────────────────

/**
 * Gespeicherte Vorlage, normalisiert, oder null.
 * @param {string} guildId
 * @param {string} anlassName
 * @param {string} [stelle] nur bei Anlässen mit `je`
 */
async function lade(guildId, anlassName, stelle) {
    const s = stelleVon(anlassName, stelle);
    const rows = await db().query('SELECT inhalt FROM guild_vorlagen WHERE guild_id = ? AND anlass = ? AND stelle = ?', [String(guildId), anlassName, s]);
    const roh = rows?.[0]?.inhalt;
    if (roh === undefined || roh === null) return null;
    let gelesen = roh;
    if (typeof roh === 'string') {
        try { gelesen = JSON.parse(roh); } catch { gelesen = null; }
    }
    return normalisiere(gelesen);
}

/**
 * Prüfen und speichern. Eine leere Vorlage löscht die Zeile.
 * @returns {Promise<Object|null>} die gespeicherte Vorlage oder null
 */
async function speichere(guildId, anlassName, roh, stelle) {
    const s = stelleVon(anlassName, stelle);
    const v = pruefe(roh);
    if (istLeer(v)) {
        await loesche(guildId, anlassName, s);
        return null;
    }
    await db().query(
        `INSERT INTO guild_vorlagen (guild_id, anlass, stelle, inhalt) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE inhalt = VALUES(inhalt)`,
        [String(guildId), anlassName, s, JSON.stringify(v)]
    );
    return v;
}

/**
 * Einzelne Felder ändern (Slash-Befehle). Setzt jemand ein Feld des Aufbaus,
 * während die Vorlage nur Text ist, wird sie zum Embed: sonst sähe er seine
 * Änderung nie.
 */
async function aendere(guildId, anlassName, teil, stelle, vorgabe) {
    const alt = (await lade(guildId, anlassName, stelle)) || normalisiere(vorgabe);
    const neu = { ...alt, ...teil };
    if (alt.form === 'text' && teil.form === undefined && AUFBAU.some((f) => teil[f])) neu.form = 'embed';
    return speichere(guildId, anlassName, neu, stelle);
}

async function loesche(guildId, anlassName, stelle) {
    const s = stelleVon(anlassName, stelle);
    await db().query('DELETE FROM guild_vorlagen WHERE guild_id = ? AND anlass = ? AND stelle = ?', [String(guildId), anlassName, s]);
}

/**
 * Was der Kern-Teil `shared/vorlage` zum Zeichnen braucht: Anlass mit
 * Platzhaltern und die gespeicherte (oder leere) Vorlage. Das Plugin reicht
 * das Ergebnis an seine Ansicht weiter.
 * @param {string} guildId
 * @param {string} anlassName
 * @param {Object} [vorgabe] Vorlage, solange nichts gespeichert ist
 * @param {string} [stelle] nur bei Anlässen mit `je`
 */
async function editor(guildId, anlassName, vorgabe, stelle) {
    const a = anlass(anlassName);
    const v = (await lade(guildId, anlassName, stelle)) || normalisiere(vorgabe);
    return { anlass: a, vorlage: v };
}

// ─────────────────────────────────────────────────────────────────────────
// Füllen
// ─────────────────────────────────────────────────────────────────────────

function kuerze(text, max, hinweise, feld) {
    if (text.length <= max) return text;
    hinweise.push({ schluessel: 'GEKUERZT', werte: { feld, max } });
    return text.slice(0, Math.max(0, max - 1)) + '…';
}

/**
 * Feste Felder des Aufrufers in eine Form bringen: höchstens 25, Name und
 * Wert gekürzt wie im Embed, leerer Wert als „-“. Ohne Platzhalter-Ersetzung,
 * denn die Werte sind Daten (z. B. Antworten eines Mitglieds).
 * @returns {{name: string, wert: string, inline: boolean}[]}
 */
function festeFelder(roh) {
    if (!Array.isArray(roh)) return [];
    const aus = [];
    for (const f of roh.slice(0, FELD_MAX.anzahl)) {
        if (!f || typeof f !== 'object') continue;
        const name = String(f.name ?? '').trim() || '\u200b';
        const wert = String(f.wert ?? '').trim() || '-';
        const kurz = (t, max) => (t.length > max ? t.slice(0, max - 1) + '…' : t);
        aus.push({ name: kurz(name, FELD_MAX.name), wert: kurz(wert, FELD_MAX.wert), inline: f.inline === true });
    }
    return aus;
}

/** Zeilen mit Knöpfen als JSON (Builder oder fertige Objekte). */
function festeKomponenten(roh) {
    if (!Array.isArray(roh)) return [];
    return roh.filter(Boolean).map((k) => (typeof k.toJSON === 'function' ? k.toJSON() : k));
}

/** Felder als Markdown-Zeilen für Text und V2. */
function felderAlsText(felder) {
    return felder.map((f) => (f.name === '\u200b' ? f.wert : `**${f.name}**\n${f.wert}`)).join('\n');
}

/**
 * Vorlage mit Werten füllen und als Nachricht für discord.js bauen.
 *
 * @param {Object|null} vorlage gespeicherte oder geprüfte Vorlage
 * @param {Object} kontext für `parsePlaceholders`: `{ member, guild, user, extra }`
 * @param {Object} [optionen]
 * @param {string} [optionen.guildId] für Akzentfarbe und Logo/Banner
 * @param {string[]} [optionen.erwaehnen] Discord-IDs, die gepingt werden dürfen
 * @param {{name: string, attachment: *}[]} [optionen.anhaenge] Dateien (z. B. Willkommensbild)
 * @param {{name: string, wert: string, inline?: boolean}[]} [optionen.felder] feste Felder, nicht gestaltbar
 * @param {Object[]} [optionen.komponenten] Zeilen mit Knöpfen (ActionRow, Builder oder JSON)
 * @param {string} [optionen.form] andere Form erzwingen (Vorschau)
 * @param {Date} [optionen.jetzt]
 * @returns {Promise<{nachricht: Object|null, hinweise: Object[], leer: boolean}>}
 */
async function fuelle(vorlage, kontext = {}, optionen = {}) {
    const v = normalisiere(vorlage);
    const form = FORMEN.includes(optionen.form) ? optionen.form : v.form;
    const hinweise = [];
    const guildId = String(optionen.guildId || kontext.guild?.id || kontext.member?.guild?.id || '');
    const anhaenge = Array.isArray(optionen.anhaenge) ? optionen.anhaenge.filter((a) => a && a.name) : [];
    const felder = festeFelder(optionen.felder);
    const komponenten = festeKomponenten(optionen.komponenten);

    const extra = { ...(kontext.extra || {}) };
    const alles = Object.keys(FELDER).map((f) => v[f]).join(' ');
    if (alles.includes('{gestaltung:')) {
        let bilder = { logo: null, banner: null };
        try { if (guildId) bilder = await Gestaltung.bilder(guildId); } catch (err) {
            logger()?.warn(`[Vorlage] Logo/Banner für ${guildId} nicht lesbar: ${err.message}`);
        }
        extra['gestaltung:logo'] = bilder.logo || '';
        extra['gestaltung:banner'] = bilder.banner || '';
    }
    const fuell = (t) => (t ? String(parsePlaceholders(t, { ...kontext, extra }) ?? '').trim() : '');
    const w = {};
    for (const f of Object.keys(FELDER)) w[f] = fuell(v[f]);
    for (const f of ['vorschaubild', 'bild']) {
        if (w[f] && !ADRESSE.test(w[f])) {
            hinweise.push({ schluessel: 'ADRESSE_WEG', werte: { feld: f } });
            w[f] = '';
        }
    }

    // Nur Embed und V2 haben eine Farbe; reiner Text fragt die Gestaltung nicht.
    const farbe = async () => (v.farbe ? parseInt(v.farbe.slice(1), 16) : Gestaltung.farbe(guildId, 'akzent'));

    const allowedMentions = { parse: [], users: [...new Set((optionen.erwaehnen || []).map(String))], repliedUser: false };
    const files = anhaenge.map((a) => ({ attachment: a.attachment, name: a.name }));
    const jetzt = optionen.jetzt instanceof Date ? optionen.jetzt : new Date();

    const mitKnoepfen = (n) => (komponenten.length ? { ...n, components: [...(n.components || []), ...komponenten] } : n);

    if (form === 'text') {
        const teile = [w.text, felder.length ? felderAlsText(felder) : ''].filter(Boolean);
        const content = kuerze(teile.join('\n\n'), FELDER.text, hinweise, 'text');
        if (!content) return { nachricht: null, hinweise, leer: true };
        return { nachricht: mitKnoepfen({ content, allowedMentions, ...(files.length ? { files } : {}) }), hinweise, leer: false };
    }

    if (form === 'embed') {
        const nachricht = { allowedMentions };
        if (w.text) nachricht.content = kuerze(w.text, FELDER.text, hinweise, 'text');
        const hatEmbed = AUFBAU.some((f) => w[f]) || v.zeitstempel || felder.length > 0;
        if (hatEmbed) {
            const embed = { color: await farbe() };
            if (w.titel) embed.title = kuerze(w.titel, FELDER.titel, hinweise, 'titel');
            const festePlatz = felder.reduce((n, f) => n + f.name.length + f.wert.length, 0);
            const platz = EMBED_GESAMT_MAX - (embed.title || '').length - Math.min(w.fusszeile.length, FELDER.fusszeile) - festePlatz;
            if (w.beschreibung) embed.description = kuerze(w.beschreibung, Math.max(0, Math.min(FELDER.beschreibung, platz)), hinweise, 'beschreibung');
            if (felder.length) embed.fields = felder.map((f) => ({ name: f.name, value: f.wert, inline: f.inline }));
            if (w.vorschaubild) embed.thumbnail = { url: w.vorschaubild };
            if (w.bild) embed.image = { url: w.bild };
            if (w.fusszeile) embed.footer = { text: kuerze(w.fusszeile, FELDER.fusszeile, hinweise, 'fusszeile') };
            if (v.zeitstempel) embed.timestamp = jetzt.toISOString();
            nachricht.embeds = [embed];
        }
        if (!nachricht.content && !nachricht.embeds) return { nachricht: null, hinweise, leer: true };
        if (files.length) nachricht.files = files;
        return { nachricht: mitKnoepfen(nachricht), hinweise, leer: false };
    }

    // Components V2
    const titel = w.titel ? `## ${w.titel}` : '';
    let fuss = w.fusszeile;
    if (v.zeitstempel) fuss = (fuss ? `${fuss} · ` : '') + `<t:${Math.floor(jetzt.getTime() / 1000)}:f>`;
    fuss = fuss ? `-# ${fuss}` : '';

    // Gesamtlänge vorher abfangen: zuerst die Beschreibung kürzen, dann den Text.
    // Die festen Felder zählen mit, werden aber zuletzt gekürzt.
    const texte = { text: w.text, titel, beschreibung: w.beschreibung, fuss, felder: felder.length ? felderAlsText(felder) : '' };
    const summe = () => Object.values(texte).reduce((n, t) => n + t.length, 0);
    for (const f of ['beschreibung', 'text', 'fuss', 'titel', 'felder']) {
        const ueber = summe() - V2_TEXT_MAX;
        if (ueber > 0 && texte[f]) texte[f] = kuerze(texte[f], Math.max(0, texte[f].length - ueber), hinweise, f === 'fuss' ? 'fusszeile' : f);
    }

    const aussen = [];
    if (texte.text) aussen.push({ type: TYP.TEXT, content: texte.text });

    const innen = [];
    const kopf = [texte.titel, texte.beschreibung].filter(Boolean).map((t) => ({ type: TYP.TEXT, content: t }));
    const galerie = [];
    if (w.vorschaubild && kopf.length) {
        innen.push({ type: TYP.SECTION, components: kopf, accessory: { type: TYP.THUMBNAIL, media: { url: w.vorschaubild } } });
    } else {
        innen.push(...kopf);
        if (w.vorschaubild) galerie.push(w.vorschaubild);
    }
    if (w.bild) galerie.push(w.bild);
    for (const a of anhaenge) galerie.push(`attachment://${a.name}`);
    if (galerie.length) innen.push({ type: TYP.GALERIE, items: galerie.slice(0, GALERIE_MAX).map((url) => ({ media: { url } })) });
    if (texte.felder) innen.push({ type: TYP.TEXT, content: texte.felder });
    if (texte.fuss) {
        if (innen.length) innen.push({ type: TYP.TRENNER, divider: true, spacing: 1 });
        innen.push({ type: TYP.TEXT, content: texte.fuss });
    }
    if (innen.length) aussen.push({ type: TYP.CONTAINER, accent_color: await farbe(), components: innen });
    if (!aussen.length) return { nachricht: null, hinweise, leer: true };
    aussen.push(...komponenten);

    const nachricht = { flags: FLAG_V2, components: aussen, allowedMentions };
    if (files.length) nachricht.files = files;
    return { nachricht, hinweise, leer: false };
}

// ─────────────────────────────────────────────────────────────────────────
// Vorschau (Dashboard)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Ein Mitglied zum Ansehen: der angemeldete Nutzer in dieser Guild. Hat
 * dieselben Eigenschaften, die `parsePlaceholders` liest.
 * @param {{id: string, username: string, global_name?: string, avatar?: string}} nutzer
 * @param {{id: string, name: string}} guildDaten
 */
function beispielKontext(nutzer, guildDaten) {
    const id = String(nutzer?.id || '0');
    const name = String(nutzer?.username || 'mitglied');
    const anzeige = String(nutzer?.global_name || name);
    const avatar = nutzer?.avatar
        ? `https://cdn.discordapp.com/avatars/${id}/${nutzer.avatar}.png?size=256`
        : 'https://cdn.discordapp.com/embed/avatars/0.png';
    const heute = new Date();
    const guild = {
        id: String(guildDaten?.id || '0'),
        name: String(guildDaten?.name || 'Server'),
        memberCount: Number(KERN_BEISPIEL['guild:memberCount']),
        premiumSubscriptionCount: Number(KERN_BEISPIEL['guild:boostCount']),
        premiumTier: Number(KERN_BEISPIEL['guild:boostLevel']),
        iconURL: () => 'https://cdn.discordapp.com/embed/avatars/1.png',
    };
    const user = { id, username: name, discriminator: '0', tag: name, createdAt: heute, displayAvatarURL: () => avatar };
    const member = {
        id, user, guild, displayName: anzeige, joinedAt: heute,
        toString: () => `<@${id}>`, displayAvatarURL: () => avatar,
    };
    return { member, guild, namen: { [id]: anzeige } };
}

/**
 * Vorschau eines Anlasses: prüft die Eingabe und baut alle drei Formen mit
 * Beispielwerten. Die Seite zeichnet daraus, was der Bot senden würde.
 * @returns {Promise<{vorlage: Object, formen: Object, hinweise: Object[], unbekannt: string[], namen: Object}>}
 */
async function vorschau(anlassName, roh, { guildId, guildName, nutzer } = {}) {
    const a = anlass(anlassName);
    const v = pruefe(roh);
    const { member, guild, namen } = beispielKontext(nutzer, { id: guildId, name: guildName });
    const extra = {};
    for (const p of a.platzhalter) if (p.gruppe === a.plugin) extra[p.name] = p.beispiel ?? '';
    const bekannt = new Set(a.platzhalter.map((p) => p.name));
    const unbekannt = new Set();
    for (const f of Object.keys(FELDER)) for (const n of platzhalterIn(v[f])) if (!bekannt.has(n)) unbekannt.add(n);

    const formen = {};
    let hinweise = [];
    for (const form of FORMEN) {
        const r = await fuelle(v, { member, guild, extra }, { guildId, form, erwaehnen: [member.id] });
        formen[form] = r.nachricht ? { ...r.nachricht, files: undefined, dateien: (r.nachricht.files || []).map((f) => f.name) } : null;
        if (form === v.form) hinweise = r.hinweise;
    }
    return { vorlage: v, formen, hinweise, unbekannt: [...unbekannt], namen };
}

module.exports = {
    FORMEN,
    FELDER,
    FELD_MAX,
    FLAG_V2,
    V2_TEXT_MAX,
    KERN_GRUPPEN,
    GESTALTUNG_PLATZHALTER,
    Eingabefehler,
    alsText,
    leer,
    normalisiere,
    istLeer,
    pruefe,
    erklaerung,
    anlass,
    stelleVon,
    lade,
    speichere,
    aendere,
    loesche,
    editor,
    fuelle,
    beispielKontext,
    vorschau,
};
