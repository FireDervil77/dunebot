'use strict';

/**
 * Fortschritts-Bibliothek (G-20, F-G8, F-CL8, K382, 2026-11-14).
 *
 * Buchungen, Stand, Stufentabellen, Ranglisten und Saisons für jeden
 * Fortschritt einer Guild. Leveling führt `leveling:community`, der Clan
 * `clan:<clan_id>`. Die Werte vermischen sich nie; die Regeln (Quellen,
 * XP-Mengen, Taktung, Boosts, Belohnungen) bleiben im Plugin. Hier steht nur
 * die Technik, nutzbar in Bot und Dashboard.
 *
 *     const { Fortschritt } = require('dunebot-sdk');
 *     const r = await Fortschritt.buche({ guildId, kennung: 'leveling:community', mitglied: userId,
 *         menge: 15, quelle: 'nachricht', schluessel: `msg:${message.id}` });
 *     if (r.aufstieg) … // das Plugin meldet `leveling.level.erreicht` selbst
 *     await Fortschritt.storniere({ guildId, kennung: 'leveling:community', schluessel: `msg:${id}` });
 *
 * # Erklärung
 *
 * Jedes Plugin erklärt seine Fortschritte in der package.json:
 *
 *     "fortschritt": [
 *       { "kennung": "leveling:community", "titel": "leveling:FORTSCHRITT.COMMUNITY",
 *         "recht": "LEVELING.SETTINGS.EDIT", "schablone": "ansteigend" },
 *       { "kennung": "clan:*", "titel": "clan:FORTSCHRITT.CLAN", "recht": "CLAN.SETTINGS.EDIT",
 *         "schablone": "ansteigend", "gesamt": { "schablone": "flach" } }
 *     ]
 *
 *   kennung    `plugin:name`; `plugin:*` steht für eine Stelle, die erst zur
 *              Laufzeit feststeht (die Clan-ID). Der Teil vor dem Doppelpunkt
 *              ist der Name des Plugins, beim Kern `kern`. Gebucht wird nur
 *              auf erklärte Kennungen (wirft sonst); dass ein Plugin nur seine
 *              eigenen bucht, prüft der Wächter scripts/check-fortschritt.js.
 *   titel      Sprachschlüssel der Dashboard-Sprachdatei
 *   recht      wer die Stufentabelle ändern darf (Kern-Teil `shared/fortschritt-stufen`)
 *   schablone  Levelsatz, der beim ersten Gebrauch eingespielt wird
 *   gesamt     optional: Gesamtstand (Summe aller Mitglieder) mit eigener
 *              Stufentabelle unter `<kennung>:gesamt`. Berechnet, nie gebucht.
 *
 * # Regeln
 *
 *   - Ein Schlüssel zählt je Guild und Kennung einmal. Derselbe Schlüssel
 *     zweimal ergibt eine Buchung (`doppelt: true`, Stand unverändert).
 *   - Buchung und Stand laufen in einer Transaktion. Der Stand ist die Summe
 *     der nicht stornierten Buchungen; `pruefe` rechnet nach.
 *   - Eine Minusbuchung wird auf den Stand gekürzt, gespeichert wird die
 *     wirksame Menge (`verlangt` hält die verlangte). Der Stand fällt durch
 *     Buchen nie unter 0. Ein Storno nimmt genau die gebuchte Menge zurück.
 *   - Stufen: Stufe k ist erreicht ab ihrer Gesamt-XP-Schwelle. Unter der
 *     ersten Stufe ist das Level 0. Die höchste angelegte Stufe ist das
 *     Höchstlevel. Im Code ist keine Stufe fest; die Schablonen sind nur
 *     Vorschläge (F-CL8).
 *   - Ändert sich die Tabelle, rechnet `setzeStufen` alle Stände neu und
 *     meldet die Wechsel gesammelt, nicht als einzelne Aufstiege.
 *   - Prestige (je Guild und Kennung an/aus): Wer die höchste Stufe erreicht,
 *     bekommt Prestige + 1 und eine Buchung `kern:prestige` über die Schwelle
 *     der höchsten Stufe; was darüber lag, bleibt. Wochen- und
 *     Monatsranglisten zählen diese Buchung nicht.
 *   - Saisons sind befristete Ranglisten, unabhängig vom Dauerstand
 *     (Leveling-Idee §8). Was zwischen Beginn und Ende gebucht wird, zählt
 *     auch im Saisonstand. Am Ende (`core:fortschritt-saisons`) bleibt der
 *     Saisonstand lesbar (`archivieren`) oder geht (`zuruecksetzen`).
 *
 * Gelesen wird über den Datenbankdienst (`dbService`), geschrieben in
 * dessen Transaktion. Ereignisse sendet die Bibliothek keine: Den
 * Level-Wechsel meldet das Plugin, dem die Kennung gehört.
 *
 * @module dunebot-sdk/lib/Fortschritt
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const WURZEL = path.join(__dirname, '..', '..', '..');
const PLUGINS = path.join(WURZEL, 'plugins');

const KENNUNG = /^[a-z0-9_-]{1,32}:[a-z0-9_-]{1,48}(:gesamt)?$/;
const MUSTER = /^[a-z0-9_-]{1,32}:([a-z0-9_-]{1,48}|\*)$/;
const ID = /^\d{5,32}$/;
const QUELLE = /^[a-z0-9_.:-]{1,64}$/;
const SPRACHSCHLUESSEL = /^[a-z0-9_-]+:[A-Z0-9_.]+$/;
const RECHT = /^[A-Z0-9_.]+$/;
const ZEITRAUM = /^(gesamt|woche|monat|tage:(\d{1,3}))$/;

/** Höchstens so viele Stufen je Tabelle. */
const STUFEN_MAX = 1000;
/** Größte Schwelle und größte Menge einer Buchung. */
const SCHWELLE_MAX = 1e15;
const MENGE_MAX = 1e12;
const SEITE_MAX = 100;
const ZEILEN_JE_UPDATE = 500;

/** Buchungen, die der Kern selbst schreibt. */
const QUELLEN = Object.freeze({ PRESTIGE: 'kern:prestige', VERDICHTET: 'kern:verdichtet' });

/**
 * Levelsätze. Ein Schritt ist die XP von Stufe L zu L+1 (L ab 0), die
 * Schwelle von Stufe k die Summe der ersten k Schritte.
 *   flach       100 je Stufe
 *   ansteigend  5·L² + 50·L + 100, die verbreitete Kurve (Stufe 1 ab 100,
 *               Stufe 10 ab 4.675), damit Umsteiger sich zurechtfinden
 *   steil       100 · 1,1^L
 */
const SCHABLONEN = Object.freeze({
    flach: Object.freeze({ formel: 'quadratisch', a: 0, b: 0, c: 100, anzahl: 100 }),
    ansteigend: Object.freeze({ formel: 'quadratisch', a: 5, b: 50, c: 100, anzahl: 100 }),
    steil: Object.freeze({ formel: 'exponentiell', basis: 100, faktor: 1.1, anzahl: 100 }),
});

function sm() {
    return require('dunebot-core').ServiceManager;
}
function db() {
    return sm().get('dbService');
}

/** Lesen außerhalb einer Transaktion. */
async function lies(sql, werte = []) {
    return db().query(sql, werte);
}

/** `fn(q)` in einer Transaktion; `q(sql, werte)` liefert die Zeilen bzw. das Ergebnis. */
async function transaktion(fn) {
    return db().transaction(async (v) => fn(async (sql, werte = []) => (await v.query(sql, werte))[0]));
}

const zahl = (w) => (w == null ? 0 : Number(w));

/** Falsche Eingabe (Stufen, Rechner, Saison, Menge): in der Oberfläche 400, nicht 500. */
class Eingabefehler extends Error {}

// ---------------------------------------------------------------------------
// Erklärungen
// ---------------------------------------------------------------------------

function vorsilbe(plugin) {
    return plugin === 'core' ? 'kern' : plugin;
}

/** package.json aller Plugins, frisch gelesen. */
function pakete() {
    const aus = {};
    for (const p of fs.readdirSync(PLUGINS)) {
        const datei = path.join(PLUGINS, p, 'package.json');
        if (fs.existsSync(datei)) aus[p] = JSON.parse(fs.readFileSync(datei, 'utf8'));
    }
    return aus;
}

/**
 * Formfehler der Erklärungen (prüft auch der Wächter).
 *
 * @param {Object<string, Object>} meta Plugin → package.json
 * @returns {string[]}
 */
function pruefeForm(meta) {
    const fehler = [];
    for (const [plugin, m] of Object.entries(meta)) {
        if (m.fortschritt === undefined) continue;
        if (!Array.isArray(m.fortschritt)) { fehler.push(`${plugin}: fortschritt ist keine Liste`); continue; }
        const gesehen = new Set();
        for (const e of m.fortschritt) {
            const wer = `${plugin}:${e?.kennung}`;
            if (!MUSTER.test(String(e?.kennung ?? ''))) { fehler.push(`${wer}: kennung muss plugin:name oder plugin:* sein`); continue; }
            if (e.kennung.split(':')[0] !== vorsilbe(plugin)) fehler.push(`${wer}: kennung beginnt nicht mit "${vorsilbe(plugin)}:"`);
            if (gesehen.has(e.kennung)) fehler.push(`${wer}: doppelt`);
            gesehen.add(e.kennung);
            if (!SPRACHSCHLUESSEL.test(String(e?.titel ?? ''))) fehler.push(`${wer}: titel ist kein Sprachschlüssel`);
            if (!RECHT.test(String(e?.recht ?? ''))) fehler.push(`${wer}: recht fehlt`);
            if (!SCHABLONEN[e?.schablone]) fehler.push(`${wer}: schablone "${e?.schablone}" unbekannt (${Object.keys(SCHABLONEN).join(', ')})`);
            if (e.gesamt !== undefined && (!e.gesamt || !SCHABLONEN[e.gesamt.schablone])) fehler.push(`${wer}: gesamt braucht eine bekannte schablone`);
            const fremd = Object.keys(e).filter((k) => !['kennung', 'titel', 'recht', 'schablone', 'gesamt'].includes(k));
            if (fremd.length) fehler.push(`${wer}: unbekannte Schlüssel ${fremd.join(', ')}`);
        }
    }
    return fehler;
}

let _erklaerungen = null;

/**
 * Alle Erklärungen aller Plugins (einmal gelesen, `frisch` liest neu).
 *
 * @returns {Array<{plugin, kennung, titel, recht, schablone, gesamt?}>}
 */
function erklaerungen({ frisch = false, meta } = {}) {
    if (_erklaerungen && !frisch && !meta) return _erklaerungen;
    const m = meta || pakete();
    const fehler = pruefeForm(m);
    if (fehler.length) throw new Error(`Fortschritt: Erklärungen fehlerhaft: ${fehler.join('; ')}`);
    const aus = [];
    for (const [plugin, p] of Object.entries(m)) for (const e of p.fortschritt || []) aus.push({ plugin, ...e });
    if (!meta) _erklaerungen = aus;
    return aus;
}

/**
 * Die Erklärung zu einer Kennung, auch zu `…:gesamt`.
 *
 * @param {string} kennung
 * @returns {Object|null} `gesamt: true`, wenn nach dem Gesamtstand gefragt ist
 */
function erklaerungFuer(kennung, optionen) {
    const k = String(kennung || '');
    if (!KENNUNG.test(k)) return null;
    const gesamt = k.endsWith(':gesamt');
    const basis = gesamt ? k.slice(0, -':gesamt'.length) : k;
    const [vor] = basis.split(':');
    for (const e of erklaerungen(optionen)) {
        if (e.kennung === basis || (e.kennung === `${vor}:*` && basis.startsWith(`${vor}:`))) {
            if (gesamt && !e.gesamt) return null;
            return { ...e, gesamt_gefragt: gesamt, basis, schablone: gesamt ? e.gesamt.schablone : e.schablone };
        }
    }
    return null;
}

function brauche(kennung, { gesamtErlaubt = false } = {}) {
    const e = erklaerungFuer(kennung);
    if (!e) throw new Error(`Fortschritt: Kennung "${kennung}" ist in keiner package.json unter "fortschritt" erklärt`);
    if (e.gesamt_gefragt && !gesamtErlaubt) throw new Error(`Fortschritt: "${kennung}" ist ein Gesamtstand, berechnet und nie gebucht`);
    return e;
}

function pruefeGuild(guildId) {
    if (!ID.test(String(guildId || ''))) throw new Error(`Fortschritt: Guild-ID "${guildId}" ungültig`);
    return String(guildId);
}
function pruefeMitglied(mitglied) {
    const id = String(mitglied?.id ?? mitglied ?? '');
    if (!ID.test(id)) throw new Error(`Fortschritt: Mitglieds-ID "${id}" ungültig`);
    return id;
}

// ---------------------------------------------------------------------------
// Stufen
// ---------------------------------------------------------------------------

/**
 * Stufentabelle aus einer Formel (der Rechner). Nichts wird gespeichert.
 *
 * @param {{formel: 'quadratisch'|'exponentiell', a?, b?, c?, basis?, faktor?, anzahl}} p
 *   quadratisch: Schritt = a·L² + b·L + c; exponentiell: Schritt = basis · faktor^L
 * @returns {Array<{stufe: number, name: null, schwelle: number}>}
 */
function rechne(p) {
    const anzahl = Number(p?.anzahl);
    if (!Number.isInteger(anzahl) || anzahl < 1 || anzahl > STUFEN_MAX) throw new Eingabefehler(`Rechner: Stufenzahl 1 bis ${STUFEN_MAX}`);
    let schritt;
    if (p.formel === 'quadratisch') {
        const [a, b, c] = [p.a, p.b, p.c].map(Number);
        if (![a, b, c].every(Number.isFinite)) throw new Eingabefehler('Rechner: a, b und c müssen Zahlen sein');
        schritt = (L) => a * L * L + b * L + c;
    } else if (p.formel === 'exponentiell') {
        const [basis, faktor] = [p.basis, p.faktor].map(Number);
        if (!Number.isFinite(basis) || !Number.isFinite(faktor) || faktor <= 0) throw new Eingabefehler('Rechner: Basis und Faktor (> 0) müssen Zahlen sein');
        schritt = (L) => basis * Math.pow(faktor, L);
    } else {
        throw new Eingabefehler(`Rechner: Formel "${p?.formel}" unbekannt (quadratisch, exponentiell)`);
    }
    const aus = [];
    let summe = 0;
    for (let L = 0; L < anzahl; L++) {
        const s = Math.round(schritt(L));
        if (!(s > 0)) throw new Eingabefehler(`Rechner: Der Schritt zu Stufe ${L + 1} ist ${s}, er muss größer als 0 sein`);
        summe += s;
        if (summe > SCHWELLE_MAX) throw new Eingabefehler(`Rechner: Stufe ${L + 1} läge über ${SCHWELLE_MAX} XP`);
        aus.push({ stufe: L + 1, name: null, schwelle: summe });
    }
    return aus;
}

/** Die Stufen einer Schablone. */
function schablone(name) {
    const s = SCHABLONEN[name];
    if (!s) throw new Eingabefehler(`Fortschritt: Schablone "${name}" unbekannt`);
    return rechne(s);
}

/**
 * Eine Tabelle aus der Oberfläche in Form bringen: nach Schwelle sortiert,
 * durchnummeriert ab 1. Eine gelöschte Stufe rückt so nach.
 *
 * @param {Array<{schwelle, name?}>} liste
 * @returns {Array<{stufe, name, schwelle}>}
 */
function ordneStufen(liste) {
    if (!Array.isArray(liste)) throw new Eingabefehler('Stufen: keine Liste');
    if (liste.length > STUFEN_MAX) throw new Eingabefehler(`Stufen: höchstens ${STUFEN_MAX}`);
    const zeilen = liste.map((z, i) => {
        const schwelle = Number(z?.schwelle);
        if (!Number.isInteger(schwelle) || schwelle < 0 || schwelle > SCHWELLE_MAX) throw new Eingabefehler(`Stufen: Zeile ${i + 1} braucht eine ganze Schwelle von 0 bis ${SCHWELLE_MAX}`);
        const name = z?.name == null ? '' : String(z.name).trim();
        if (name.length > 100) throw new Eingabefehler(`Stufen: Name in Zeile ${i + 1} ist länger als 100 Zeichen`);
        return { schwelle, name: name || null };
    }).sort((x, y) => x.schwelle - y.schwelle);
    for (let i = 1; i < zeilen.length; i++) {
        if (zeilen[i].schwelle === zeilen[i - 1].schwelle) throw new Eingabefehler(`Stufen: Schwelle ${zeilen[i].schwelle} steht zweimal`);
    }
    return zeilen.map((z, i) => ({ stufe: i + 1, ...z }));
}

/** Level zu einer XP-Zahl: Zahl der Stufen, deren Schwelle erreicht ist. */
function levelAus(stufen, xp) {
    let lo = 0;
    let hi = stufen.length;
    while (lo < hi) {
        const mitte = (lo + hi) >> 1;
        if (zahl(stufen[mitte].schwelle) <= xp) lo = mitte + 1;
        else hi = mitte;
    }
    return lo;
}

async function ladeStufen(q, guildId, kennung) {
    return (await q('SELECT stufe, name, schwelle FROM fortschritt_stufen WHERE guild_id = ? AND kennung = ? ORDER BY stufe', [guildId, kennung]))
        .map((z) => ({ stufe: Number(z.stufe), name: z.name ?? null, schwelle: zahl(z.schwelle) }));
}

async function schreibeStufen(q, guildId, kennung, stufen) {
    await q('DELETE FROM fortschritt_stufen WHERE guild_id = ? AND kennung = ?', [guildId, kennung]);
    for (let i = 0; i < stufen.length; i += ZEILEN_JE_UPDATE) {
        const teil = stufen.slice(i, i + ZEILEN_JE_UPDATE);
        await q(`INSERT INTO fortschritt_stufen (guild_id, kennung, stufe, name, schwelle) VALUES ${teil.map(() => '(?, ?, ?, ?, ?)').join(', ')}`,
            teil.flatMap((s) => [guildId, kennung, s.stufe, s.name, s.schwelle]));
    }
}

/**
 * Einstellungen der Kennung; beim ersten Gebrauch wird die Schablone der
 * Erklärung eingespielt. `INSERT IGNORE` hält gleichzeitige erste Buchungen
 * auseinander: Nur wer die Zeile anlegt, spielt ein.
 */
async function sichere(q, guildId, kennung, e) {
    const r = await q('INSERT IGNORE INTO fortschritt_einstellungen (guild_id, kennung, prestige, schablone) VALUES (?, ?, 0, ?)', [guildId, kennung, e.schablone]);
    if (Number(r?.affectedRows || 0) === 1) await schreibeStufen(q, guildId, kennung, schablone(e.schablone));
    const [z] = await q('SELECT prestige, schablone FROM fortschritt_einstellungen WHERE guild_id = ? AND kennung = ?', [guildId, kennung]);
    return { prestige: Boolean(Number(z?.prestige || 0)), schablone: z?.schablone ?? null };
}

/**
 * Stufen und Einstellungen einer Kennung, ohne zu schreiben. Vor dem ersten
 * Gebrauch: die Schablone der Erklärung (`eingespielt: false`).
 *
 * @returns {Promise<{stufen, prestige: boolean, schablone: string|null, eingespielt: boolean}>}
 */
async function stufen({ guildId, kennung }) {
    const g = pruefeGuild(guildId);
    const e = brauche(kennung, { gesamtErlaubt: true });
    const [z] = await lies('SELECT prestige, schablone FROM fortschritt_einstellungen WHERE guild_id = ? AND kennung = ?', [g, kennung]);
    if (!z) return { stufen: schablone(e.schablone), prestige: false, schablone: e.schablone, eingespielt: false };
    return { stufen: await ladeStufen(lies, g, kennung), prestige: Boolean(Number(z.prestige)), schablone: z.schablone ?? null, eingespielt: true };
}

/**
 * Alle Level nach der Tabelle neu rechnen (in der Transaktion des Aufrufers).
 *
 * @returns {Promise<{aufgestiegen: number, abgestiegen: number, gleich: number}>}
 */
async function neuberechnen(q, guildId, kennung, tabelle) {
    const aus = { aufgestiegen: 0, abgestiegen: 0, gleich: 0 };
    const staende = await q('SELECT mitglied_id, xp, level FROM fortschritt_stand WHERE guild_id = ? AND kennung = ? FOR UPDATE', [guildId, kennung]);
    const aenderungen = [];
    for (const s of staende) {
        const neu = levelAus(tabelle, zahl(s.xp));
        const alt = Number(s.level);
        if (neu === alt) { aus.gleich++; continue; }
        if (neu > alt) aus.aufgestiegen++; else aus.abgestiegen++;
        aenderungen.push([String(s.mitglied_id), neu]);
    }
    for (let i = 0; i < aenderungen.length; i += ZEILEN_JE_UPDATE) {
        const teil = aenderungen.slice(i, i + ZEILEN_JE_UPDATE);
        await q(`UPDATE fortschritt_stand SET level = CASE mitglied_id ${teil.map(() => 'WHEN ? THEN ?').join(' ')} END
                 WHERE guild_id = ? AND kennung = ? AND mitglied_id IN (${teil.map(() => '?').join(', ')})`,
            [...teil.flat(), guildId, kennung, ...teil.map(([m]) => m)]);
    }
    return aus;
}

/**
 * Die Stufentabelle ersetzen (von Hand geändert oder Schablone geladen) und
 * alle Stände neu rechnen.
 *
 * @param {{guildId, kennung, stufen: Array<{schwelle, name?}>, schablone?: string|null}} a
 *   `schablone`: Name, wenn eine Schablone geladen wurde (nur zur Anzeige)
 * @returns {Promise<{stufen: number, neuberechnet: {aufgestiegen, abgestiegen, gleich}}>}
 */
async function setzeStufen({ guildId, kennung, stufen: liste, schablone: name = null }) {
    const g = pruefeGuild(guildId);
    const e = brauche(kennung, { gesamtErlaubt: true });
    if (name != null && !SCHABLONEN[name]) throw new Eingabefehler(`Fortschritt: Schablone "${name}" unbekannt`);
    const tabelle = ordneStufen(liste);
    return transaktion(async (q) => {
        await sichere(q, g, kennung, e);
        await schreibeStufen(q, g, kennung, tabelle);
        await q('UPDATE fortschritt_einstellungen SET schablone = ?, geaendert = NOW(3) WHERE guild_id = ? AND kennung = ?', [name, g, kennung]);
        const neuberechnet = e.gesamt_gefragt ? { aufgestiegen: 0, abgestiegen: 0, gleich: 0 } : await neuberechnen(q, g, kennung, tabelle);
        return { stufen: tabelle.length, neuberechnet };
    });
}

/** Prestige an oder aus. Wirkt bei der nächsten Buchung des Mitglieds. */
async function setzeEinstellungen({ guildId, kennung, prestige }) {
    const g = pruefeGuild(guildId);
    const e = brauche(kennung);
    return transaktion(async (q) => {
        await sichere(q, g, kennung, e);
        await q('UPDATE fortschritt_einstellungen SET prestige = ?, geaendert = NOW(3) WHERE guild_id = ? AND kennung = ?', [prestige ? 1 : 0, g, kennung]);
        return { prestige: Boolean(prestige) };
    });
}

// ---------------------------------------------------------------------------
// Buchen
// ---------------------------------------------------------------------------

function stufeInfo(tabelle, level, xp) {
    const jetzt = level > 0 ? tabelle[level - 1] : null;
    const naechste = tabelle[level] || null;
    return {
        stufe: jetzt ? { nummer: jetzt.stufe, name: jetzt.name, schwelle: jetzt.schwelle } : null,
        naechste: naechste ? { nummer: naechste.stufe, name: naechste.name, schwelle: naechste.schwelle, fehlt: naechste.schwelle - xp } : null,
        hoechste: tabelle.length,
    };
}

function vergleiche(a, b) {
    return a.prestige !== b.prestige ? a.prestige - b.prestige : a.level - b.level;
}

class Doppelt extends Error {}

/**
 * XP buchen.
 *
 * @param {Object} a
 * @param {string} a.guildId
 * @param {string} a.kennung     erklärte Kennung, kein `…:gesamt`
 * @param {string|{id}} a.mitglied
 * @param {number} a.menge       ganze Zahl ≠ 0, Minus wird auf den Stand gekürzt
 * @param {string} a.quelle      woher (`nachricht`, `sprache`, `hand`, `ticket.geschlossen` …), nie `kern:…`
 * @param {string} [a.schluessel] eindeutig je Guild und Kennung (`msg:<id>`); ohne wird einer erzeugt
 * @param {string} [a.akteur]    wer von Hand bucht
 * @param {string} [a.grund]
 * @returns {Promise<{neu, doppelt, buchung_id, menge, gekuerzt, xp, level, prestige, vorher, wechsel, aufstieg, stufe, naechste, hoechste, schluessel}>}
 */
async function buche({ guildId, kennung, mitglied, menge, quelle, schluessel = null, akteur = null, grund = null }) {
    const g = pruefeGuild(guildId);
    const e = brauche(kennung);
    const m = pruefeMitglied(mitglied);
    const n = Number(menge);
    if (!Number.isInteger(n) || n === 0 || Math.abs(n) > MENGE_MAX) throw new Eingabefehler(`Fortschritt: Menge "${menge}" muss eine ganze Zahl ≠ 0 sein`);
    if (!QUELLE.test(String(quelle || '')) || String(quelle).startsWith('kern:')) throw new Eingabefehler(`Fortschritt: Quelle "${quelle}" ungültig`);
    const s = schluessel == null ? `auto:${crypto.randomUUID()}` : String(schluessel);
    if (!s || s.length > 160) throw new Eingabefehler('Fortschritt: Schlüssel leer oder länger als 160 Zeichen');
    if (akteur != null && !ID.test(String(akteur))) throw new Error(`Fortschritt: Akteur "${akteur}" ungültig`);

    try {
        return await transaktion(async (q) => {
            const einst = await sichere(q, g, kennung, e);
            await q('INSERT IGNORE INTO fortschritt_stand (guild_id, kennung, mitglied_id) VALUES (?, ?, ?)', [g, kennung, m]);
            const [alt] = await q('SELECT xp, level, prestige FROM fortschritt_stand WHERE guild_id = ? AND kennung = ? AND mitglied_id = ? FOR UPDATE', [g, kennung, m]);
            const vorher = { xp: zahl(alt.xp), level: Number(alt.level), prestige: Number(alt.prestige) };
            const wirksam = n < 0 ? Math.max(n, -Math.max(vorher.xp, 0)) : n;
            const gekuerzt = wirksam !== n;
            let r;
            try {
                r = await q(`INSERT INTO fortschritt_buchungen (guild_id, kennung, mitglied_id, menge, verlangt, quelle, schluessel, akteur, grund, zeit)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3))`,
                [g, kennung, m, wirksam, gekuerzt ? n : null, String(quelle), s, akteur == null ? null : String(akteur), grund == null ? null : String(grund).slice(0, 255)]);
            } catch (err) {
                if (err?.errno === 1062 || err?.code === 'ER_DUP_ENTRY') throw new Doppelt();
                throw err;
            }
            const tabelle = await ladeStufen(q, g, kennung);
            let xp = vorher.xp + wirksam;
            let prestige = vorher.prestige;
            let level = levelAus(tabelle, xp);
            const oben = tabelle.length ? tabelle[tabelle.length - 1].schwelle : 0;
            if (einst.prestige && tabelle.length && oben > 0) {
                for (let i = 0; level >= tabelle.length && i < 100; i++) {
                    await q(`INSERT INTO fortschritt_buchungen (guild_id, kennung, mitglied_id, menge, quelle, schluessel, grund, zeit)
                             VALUES (?, ?, ?, ?, ?, ?, ?, NOW(3))`,
                    [g, kennung, m, -oben, QUELLEN.PRESTIGE, `prestige:${m}:${prestige + 1}:${r.insertId}`, `Prestige ${prestige + 1}`]);
                    prestige += 1;
                    xp -= oben;
                    level = levelAus(tabelle, xp);
                }
            }
            await q('UPDATE fortschritt_stand SET xp = ?, level = ?, prestige = ?, geaendert = NOW(3) WHERE guild_id = ? AND kennung = ? AND mitglied_id = ?',
                [xp, level, prestige, g, kennung, m]);
            if (wirksam !== 0) {
                const saisons = await q('SELECT id FROM fortschritt_saisons WHERE guild_id = ? AND kennung = ? AND beendet_am IS NULL AND beginn <= NOW() AND ende > NOW()', [g, kennung]);
                for (const z of saisons) {
                    await q(`INSERT INTO fortschritt_saison_stand (saison_id, guild_id, mitglied_id, xp) VALUES (?, ?, ?, GREATEST(0, ?))
                             ON DUPLICATE KEY UPDATE xp = GREATEST(0, xp + ?)`, [z.id, g, m, wirksam, wirksam]);
                }
            }
            const nachher = { xp, level, prestige };
            return {
                neu: true, doppelt: false, buchung_id: Number(r.insertId), schluessel: s,
                menge: wirksam, gekuerzt, ...nachher, vorher,
                wechsel: vergleiche(nachher, vorher) !== 0, aufstieg: vergleiche(nachher, vorher) > 0,
                ...stufeInfo(tabelle, level, xp),
            };
        });
    } catch (err) {
        if (!(err instanceof Doppelt)) throw err;
        const st = await stand({ guildId: g, kennung, mitglied: m });
        return { neu: false, doppelt: true, buchung_id: null, schluessel: s, menge: 0, gekuerzt: false, ...st, vorher: { xp: st.xp, level: st.level, prestige: st.prestige }, wechsel: false, aufstieg: false };
    }
}

/**
 * Eine Buchung zurücknehmen (z. B. automod verwirft die Nachricht).
 * `mitglied` nennt, wessen Stand sich änderte (für Belohnungen danach, LV-1e).
 *
 * @returns {Promise<{gefunden: boolean, schon: boolean, mitglied, menge, xp, level, prestige, vorher, wechsel}>}
 */
async function storniere({ guildId, kennung, schluessel, akteur = null, grund = null }) {
    const g = pruefeGuild(guildId);
    brauche(kennung);
    if (akteur != null && !ID.test(String(akteur))) throw new Error(`Fortschritt: Akteur "${akteur}" ungültig`);
    return transaktion(async (q) => {
        const [b] = await q('SELECT id, mitglied_id, menge, quelle, storniert_am, zeit FROM fortschritt_buchungen WHERE guild_id = ? AND kennung = ? AND schluessel = ? FOR UPDATE',
            [g, kennung, String(schluessel)]);
        if (!b) return { gefunden: false, schon: false };
        if (b.storniert_am) return { gefunden: true, schon: true };
        if (String(b.quelle).startsWith('kern:')) throw new Error(`Fortschritt: Buchung "${schluessel}" schreibt der Kern (${b.quelle}), sie lässt sich nicht stornieren`);
        const m = String(b.mitglied_id);
        const menge = zahl(b.menge);
        const [alt] = await q('SELECT xp, level, prestige FROM fortschritt_stand WHERE guild_id = ? AND kennung = ? AND mitglied_id = ? FOR UPDATE', [g, kennung, m]);
        const vorher = { xp: zahl(alt?.xp), level: Number(alt?.level || 0), prestige: Number(alt?.prestige || 0) };
        const tabelle = await ladeStufen(q, g, kennung);
        const xp = vorher.xp - menge;
        const level = levelAus(tabelle, xp);
        await q('UPDATE fortschritt_buchungen SET storniert_am = NOW(3), storniert_von = ?, storno_grund = ? WHERE id = ?',
            [akteur == null ? null : String(akteur), grund == null ? null : String(grund).slice(0, 255), b.id]);
        if (alt) {
            await q('UPDATE fortschritt_stand SET xp = ?, level = ?, geaendert = NOW(3) WHERE guild_id = ? AND kennung = ? AND mitglied_id = ?', [xp, level, g, kennung, m]);
        }
        if (menge !== 0) {
            // Zeit der Buchung in SQL vergleichen, nicht über die Zeitzone von Node.
            await q(`UPDATE fortschritt_saison_stand ss
                     JOIN fortschritt_saisons s ON s.id = ss.saison_id
                     JOIN fortschritt_buchungen b ON b.id = ?
                     SET ss.xp = GREATEST(0, ss.xp - ?)
                     WHERE s.guild_id = ? AND s.kennung = ? AND s.beendet_am IS NULL AND s.beginn <= b.zeit AND s.ende > b.zeit AND ss.mitglied_id = ?`,
            [b.id, menge, g, kennung, m]);
        }
        const nachher = { xp, level, prestige: vorher.prestige };
        return { gefunden: true, schon: false, mitglied: m, menge, ...nachher, vorher, wechsel: vergleiche(nachher, vorher) !== 0 };
    });
}

// ---------------------------------------------------------------------------
// Lesen
// ---------------------------------------------------------------------------

/**
 * Stand eines Mitglieds mit Stufe und nächster Stufe.
 *
 * @returns {Promise<{xp, level, prestige, stufe, naechste, hoechste}>}
 */
async function stand({ guildId, kennung, mitglied }) {
    const g = pruefeGuild(guildId);
    brauche(kennung);
    const m = pruefeMitglied(mitglied);
    const [z] = await lies('SELECT xp, level, prestige FROM fortschritt_stand WHERE guild_id = ? AND kennung = ? AND mitglied_id = ?', [g, kennung, m]);
    const { stufen: tabelle } = await stufen({ guildId: g, kennung });
    const xp = zahl(z?.xp);
    const level = z ? Number(z.level) : levelAus(tabelle, 0);
    return { xp, level, prestige: Number(z?.prestige || 0), ...stufeInfo(tabelle, level, xp) };
}

/**
 * Gesamtstand einer Kennung: Summe aller Mitglieder, Level aus der
 * Tabelle `<kennung>:gesamt` (F-CL8). Nur, wenn die Erklärung `gesamt` hat.
 *
 * @returns {Promise<{xp, mitglieder, level, stufe, naechste, hoechste}>}
 */
async function gesamtstand({ guildId, kennung }) {
    const g = pruefeGuild(guildId);
    const e = brauche(kennung);
    if (!e.gesamt) throw new Error(`Fortschritt: "${kennung}" hat keinen Gesamtstand (gesamt in der Erklärung)`);
    const [z] = await lies('SELECT COALESCE(SUM(xp), 0) AS xp, COUNT(*) AS n FROM fortschritt_stand WHERE guild_id = ? AND kennung = ? AND xp > 0', [g, kennung]);
    const xp = zahl(z?.xp);
    const { stufen: tabelle } = await stufen({ guildId: g, kennung: `${kennung}:gesamt` });
    const level = levelAus(tabelle, xp);
    return { xp, mitglieder: Number(z?.n || 0), level, ...stufeInfo(tabelle, level, xp) };
}

/** SQL-Teil für den Zeitraum einer Rangliste über die Buchungen (Zeitzone der Datenbank, Europe/Berlin). */
function zeitraumSql(zeitraum) {
    const t = ZEITRAUM.exec(String(zeitraum || 'gesamt'));
    if (!t) throw new Eingabefehler(`Fortschritt: Zeitraum "${zeitraum}" unbekannt (gesamt, woche, monat, tage:N)`);
    if (t[1] === 'woche') return { sql: 'b.zeit >= DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY)', werte: [] };
    if (t[1] === 'monat') return { sql: "b.zeit >= DATE_FORMAT(CURDATE(), '%Y-%m-01')", werte: [] };
    if (t[2]) {
        const tage = Number(t[2]);
        if (tage < 1 || tage > 366) throw new Eingabefehler('Fortschritt: tage:N mit N von 1 bis 366');
        return { sql: 'b.zeit >= NOW() - INTERVAL ? DAY', werte: [tage] };
    }
    return null;
}

/** Quelle der Rangliste: Liste der Zeilen (mitglied_id, xp, level, prestige) als SQL. */
function rangQuelle(g, kennung, zeitraum, saison) {
    if (saison != null) {
        return {
            sql: `SELECT ss.mitglied_id, ss.xp, COALESCE(st.level, 0) AS level, 0 AS prestige
                  FROM fortschritt_saison_stand ss JOIN fortschritt_saisons s ON s.id = ss.saison_id
                  LEFT JOIN fortschritt_stand st ON st.guild_id = s.guild_id AND st.kennung = s.kennung AND st.mitglied_id = ss.mitglied_id
                  WHERE ss.saison_id = ? AND s.guild_id = ? AND s.kennung = ? AND ss.xp > 0`,
            werte: [Number(saison), g, kennung],
        };
    }
    const zr = zeitraumSql(zeitraum);
    if (!zr) {
        return { sql: 'SELECT mitglied_id, xp, level, prestige FROM fortschritt_stand WHERE guild_id = ? AND kennung = ? AND (xp > 0 OR prestige > 0)', werte: [g, kennung] };
    }
    return {
        sql: `SELECT b.mitglied_id, SUM(b.menge) AS xp, COALESCE(MAX(st.level), 0) AS level, 0 AS prestige
              FROM fortschritt_buchungen b
              LEFT JOIN fortschritt_stand st ON st.guild_id = b.guild_id AND st.kennung = b.kennung AND st.mitglied_id = b.mitglied_id
              WHERE b.guild_id = ? AND b.kennung = ? AND b.storniert_am IS NULL AND b.quelle <> ? AND ${zr.sql}
              GROUP BY b.mitglied_id HAVING SUM(b.menge) > 0`,
        werte: [g, kennung, QUELLEN.PRESTIGE, ...zr.werte],
    };
}

/**
 * Rangliste.
 *
 * @param {{guildId, kennung, zeitraum?: 'gesamt'|'woche'|'monat'|'tage:N', saison?: number, seite?: number, proSeite?: number}} a
 *   Woche ab Montag 00:00, Monat ab dem Ersten, beides in Europe/Berlin.
 *   `gesamt` ordnet nach Prestige, dann XP.
 * @returns {Promise<{eintraege: Array<{platz, mitglied_id, xp, level, prestige}>, gesamt: number, seite, seiten}>}
 */
async function rangliste({ guildId, kennung, zeitraum = 'gesamt', saison = null, seite = 1, proSeite = 10 }) {
    const g = pruefeGuild(guildId);
    brauche(kennung);
    const n = Math.min(Math.max(Number(proSeite) || 10, 1), SEITE_MAX);
    const s = Math.max(Number(seite) || 1, 1);
    const quelle = rangQuelle(g, kennung, zeitraum, saison);
    const [{ anzahl }] = await lies(`SELECT COUNT(*) AS anzahl FROM (${quelle.sql}) r`, quelle.werte);
    const zeilen = await lies(`SELECT * FROM (${quelle.sql}) r ORDER BY r.prestige DESC, r.xp DESC, r.mitglied_id LIMIT ${n} OFFSET ${(s - 1) * n}`, quelle.werte);
    return {
        eintraege: zeilen.map((z, i) => ({ platz: (s - 1) * n + i + 1, mitglied_id: String(z.mitglied_id), xp: zahl(z.xp), level: Number(z.level), prestige: Number(z.prestige) })),
        gesamt: Number(anzahl), seite: s, seiten: Math.max(1, Math.ceil(Number(anzahl) / n)),
    };
}

/**
 * Platz eines Mitglieds (gleiche XP teilen den Platz).
 *
 * @returns {Promise<{platz: number|null, xp, von: number}>} `platz: null` ohne XP im Zeitraum
 */
async function position({ guildId, kennung, mitglied, zeitraum = 'gesamt', saison = null }) {
    const g = pruefeGuild(guildId);
    brauche(kennung);
    const m = pruefeMitglied(mitglied);
    const quelle = rangQuelle(g, kennung, zeitraum, saison);
    const [ich] = await lies(`SELECT * FROM (${quelle.sql}) r WHERE r.mitglied_id = ?`, [...quelle.werte, m]);
    const [{ von }] = await lies(`SELECT COUNT(*) AS von FROM (${quelle.sql}) r`, quelle.werte);
    if (!ich) return { platz: null, xp: 0, von: Number(von) };
    const p = Number(ich.prestige);
    const xp = zahl(ich.xp);
    const [{ vor }] = await lies(`SELECT COUNT(*) AS vor FROM (${quelle.sql}) r WHERE r.prestige > ? OR (r.prestige = ? AND r.xp > ?)`, [...quelle.werte, p, p, xp]);
    return { platz: Number(vor) + 1, xp, von: Number(von) };
}

// ---------------------------------------------------------------------------
// Saisons
// ---------------------------------------------------------------------------

const REGELN = Object.freeze(['archivieren', 'zuruecksetzen']);

function datum(w, was) {
    const d = w instanceof Date ? w : new Date(w);
    if (Number.isNaN(d.getTime())) throw new Eingabefehler(`Saison: ${was} ist kein Zeitpunkt`);
    return d;
}

/**
 * Saison anlegen. Was zwischen Beginn und Ende gebucht wird, zählt auch hier.
 *
 * @param {{guildId, kennung, name, beginn: Date|string, ende: Date|string, regel?: 'archivieren'|'zuruecksetzen'}} a
 * @returns {Promise<{id: number}>}
 */
async function legeSaisonAn({ guildId, kennung, name, beginn, ende, regel = 'archivieren' }) {
    const g = pruefeGuild(guildId);
    brauche(kennung);
    const titel = String(name || '').trim();
    if (!titel || titel.length > 100) throw new Eingabefehler('Saison: Name 1 bis 100 Zeichen');
    if (!REGELN.includes(regel)) throw new Eingabefehler(`Saison: Regel "${regel}" unbekannt (${REGELN.join(', ')})`);
    const b = datum(beginn, 'Beginn');
    const e = datum(ende, 'Ende');
    if (e <= b) throw new Eingabefehler('Saison: Ende liegt nicht nach dem Beginn');
    const r = await lies('INSERT INTO fortschritt_saisons (guild_id, kennung, name, beginn, ende, regel) VALUES (?, ?, ?, ?, ?, ?)', [g, kennung, titel, b, e, regel]);
    return { id: Number(r.insertId) };
}

/** Saisons einer Kennung, neueste zuerst; `laeuft` nach der Uhr der Datenbank. */
async function saisons({ guildId, kennung }) {
    const g = pruefeGuild(guildId);
    brauche(kennung);
    const zeilen = await lies(`SELECT id, name, beginn, ende, regel, beendet_am,
                                      (beendet_am IS NULL AND beginn <= NOW() AND ende > NOW()) AS laeuft
                               FROM fortschritt_saisons WHERE guild_id = ? AND kennung = ? ORDER BY beginn DESC, id DESC`, [g, kennung]);
    return zeilen.map((z) => ({ id: Number(z.id), name: z.name, beginn: z.beginn, ende: z.ende, regel: z.regel, beendet_am: z.beendet_am, laeuft: Boolean(Number(z.laeuft)) }));
}

/**
 * Saison beenden: Regel anwenden, Ende auf jetzt, wenn es noch nicht da war.
 *
 * @returns {Promise<{id, gefunden, schon, regel, geloescht}>}
 */
async function beendeSaison({ guildId, id }) {
    const g = pruefeGuild(guildId);
    return transaktion(async (q) => {
        const [s] = await q('SELECT id, kennung, regel, beendet_am FROM fortschritt_saisons WHERE id = ? AND guild_id = ? FOR UPDATE', [Number(id), g]);
        if (!s) return { id: Number(id), gefunden: false, schon: false, regel: null, geloescht: 0 };
        if (s.beendet_am) return { id: Number(id), gefunden: true, schon: true, regel: s.regel, geloescht: 0 };
        await q('UPDATE fortschritt_saisons SET beendet_am = NOW(3), ende = LEAST(ende, NOW()) WHERE id = ?', [s.id]);
        let geloescht = 0;
        if (s.regel === 'zuruecksetzen') geloescht = Number((await q('DELETE FROM fortschritt_saison_stand WHERE saison_id = ?', [s.id]))?.affectedRows || 0);
        return { id: Number(s.id), gefunden: true, schon: false, regel: s.regel, kennung: s.kennung, geloescht };
    });
}

/**
 * Alle abgelaufenen Saisons beenden (Zeitplan `core:fortschritt-saisons`).
 *
 * @returns {Promise<Array<{id, guild_id, kennung, regel, geloescht}>>}
 */
async function beendeFaellige() {
    const faellig = await lies('SELECT id, guild_id FROM fortschritt_saisons WHERE beendet_am IS NULL AND ende <= NOW() ORDER BY ende LIMIT 500');
    const aus = [];
    for (const z of faellig) {
        const r = await beendeSaison({ guildId: String(z.guild_id), id: z.id });
        if (r.gefunden && !r.schon) aus.push({ ...r, guild_id: String(z.guild_id) });
    }
    return aus;
}

/** Saison samt Saisonstand löschen. */
async function loescheSaison({ guildId, id }) {
    const g = pruefeGuild(guildId);
    const r = await lies('DELETE FROM fortschritt_saisons WHERE id = ? AND guild_id = ?', [Number(id), g]);
    return { geloescht: Number(r?.affectedRows || 0) };
}

// ---------------------------------------------------------------------------
// Aufräumen
// ---------------------------------------------------------------------------

/**
 * Alles eines Mitglieds in einer Kennung löschen (Leveling: „XP beim
 * Verlassen löschen“, Clan: Mitglied tritt aus). Seine Daten überall löscht
 * die Datenauskunft (G-04) über `mitgliedInhalte`.
 *
 * @returns {Promise<{buchungen, stand, saisonstand}>}
 */
async function entferneMitglied({ guildId, kennung, mitglied }) {
    const g = pruefeGuild(guildId);
    brauche(kennung);
    const m = pruefeMitglied(mitglied);
    return transaktion(async (q) => {
        const n = async (sql, w) => Number((await q(sql, w))?.affectedRows || 0);
        return {
            saisonstand: await n(`DELETE ss FROM fortschritt_saison_stand ss JOIN fortschritt_saisons s ON s.id = ss.saison_id
                                  WHERE s.guild_id = ? AND s.kennung = ? AND ss.mitglied_id = ?`, [g, kennung, m]),
            buchungen: await n('DELETE FROM fortschritt_buchungen WHERE guild_id = ? AND kennung = ? AND mitglied_id = ?', [g, kennung, m]),
            stand: await n('DELETE FROM fortschritt_stand WHERE guild_id = ? AND kennung = ? AND mitglied_id = ?', [g, kennung, m]),
        };
    });
}

/**
 * Einen ganzen Fortschritt löschen, auch seine Gesamt-Tabelle (Clan aufgelöst).
 *
 * @returns {Promise<Object<string, number>>} gelöschte Zeilen je Tabelle
 */
async function loescheKennung({ guildId, kennung }) {
    const g = pruefeGuild(guildId);
    brauche(kennung);
    const beide = [kennung, `${kennung}:gesamt`];
    return transaktion(async (q) => {
        const n = async (sql, w) => Number((await q(sql, w))?.affectedRows || 0);
        return {
            fortschritt_saisons: await n('DELETE FROM fortschritt_saisons WHERE guild_id = ? AND kennung = ?', [g, kennung]),
            fortschritt_buchungen: await n('DELETE FROM fortschritt_buchungen WHERE guild_id = ? AND kennung = ?', [g, kennung]),
            fortschritt_stand: await n('DELETE FROM fortschritt_stand WHERE guild_id = ? AND kennung = ?', [g, kennung]),
            fortschritt_stufen: await n('DELETE FROM fortschritt_stufen WHERE guild_id = ? AND kennung IN (?, ?)', [g, ...beide]),
            fortschritt_einstellungen: await n('DELETE FROM fortschritt_einstellungen WHERE guild_id = ? AND kennung IN (?, ?)', [g, ...beide]),
        };
    });
}

/**
 * Alle Stände einer Kennung auf null: Buchungen, Stand und Saisonstand gehen,
 * Stufentabelle, Einstellungen (Prestige) und die Saisons selbst bleiben
 * (Leveling „ganze Guild zurücksetzen“, LV-1i). Anders als `loescheKennung`
 * ist der Fortschritt danach sofort wieder benutzbar.
 *
 * @returns {Promise<{fortschritt_saison_stand, fortschritt_buchungen, fortschritt_stand}>} gelöschte Zeilen
 */
async function setzeZurueck({ guildId, kennung }) {
    const g = pruefeGuild(guildId);
    brauche(kennung);
    return transaktion(async (q) => {
        const n = async (sql, w) => Number((await q(sql, w))?.affectedRows || 0);
        return {
            fortschritt_saison_stand: await n(`DELETE ss FROM fortschritt_saison_stand ss JOIN fortschritt_saisons s ON s.id = ss.saison_id
                                               WHERE s.guild_id = ? AND s.kennung = ?`, [g, kennung]),
            fortschritt_buchungen: await n('DELETE FROM fortschritt_buchungen WHERE guild_id = ? AND kennung = ?', [g, kennung]),
            fortschritt_stand: await n('DELETE FROM fortschritt_stand WHERE guild_id = ? AND kennung = ?', [g, kennung]),
        };
    });
}

/**
 * Alle Fortschritte eines Plugins in einer Guild löschen, auch die zur
 * Laufzeit entstandenen (`clan:<id>`) samt Gesamt-Tabellen. Ruft der Kern beim
 * Abschalten des Plugins in dieser Guild (`PluginManager.disableInGuild`,
 * Schritt 2), wie das Buch der Rollenvergabe: Ein abgeschaltetes Plugin hält
 * keinen Stand mehr. Die Kontroll-Guild behält ihre Inhalte, dort ruft der
 * Kern das nicht. Saisonstände gehen über den Fremdschlüssel mit der Saison.
 *
 * @param {{guildId: string, plugin: string}} a Pluginname (`core` → `kern`)
 * @returns {Promise<Object<string, number>>} gelöschte Zeilen je Tabelle
 */
async function loeschePlugin({ guildId, plugin }) {
    const g = pruefeGuild(guildId);
    if (!/^[a-z0-9_-]{1,32}$/.test(String(plugin || ''))) throw new Error(`Fortschritt: Plugin "${plugin}" ungültig`);
    const v = vorsilbe(String(plugin));
    // LEFT statt LIKE: `_` im Pluginnamen wäre bei LIKE ein Platzhalter.
    const passt = 'LEFT(kennung, CHAR_LENGTH(?) + 1) = CONCAT(?, \':\')';
    return transaktion(async (q) => {
        const n = async (tabelle) => Number((await q(`DELETE FROM ${tabelle} WHERE guild_id = ? AND ${passt}`, [g, v, v]))?.affectedRows || 0);
        // Saisonstand vor der Saison und ausdrücklich, nicht nur über den
        // Fremdschlüssel: So zählt der Bericht ihn mit.
        const saisonstand = Number((await q(`DELETE ss FROM fortschritt_saison_stand ss JOIN fortschritt_saisons s ON s.id = ss.saison_id
                                             WHERE s.guild_id = ? AND LEFT(s.kennung, CHAR_LENGTH(?) + 1) = CONCAT(?, ':')`, [g, v, v]))?.affectedRows || 0);
        return {
            fortschritt_saison_stand: saisonstand,
            fortschritt_saisons: await n('fortschritt_saisons'),
            fortschritt_buchungen: await n('fortschritt_buchungen'),
            fortschritt_stand: await n('fortschritt_stand'),
            fortschritt_stufen: await n('fortschritt_stufen'),
            fortschritt_einstellungen: await n('fortschritt_einstellungen'),
        };
    });
}

/**
 * Alte Buchungen zu Monatssummen je Mitglied verdichten (Aufbewahrung G-05,
 * Frist `core:fortschritt-buchungen`). Der Stand bleibt gleich, Wochen- und
 * Monatsranglisten der verdichteten Zeit gehen verloren, Stornieren geht dort
 * nicht mehr. Stornierte Buchungen zählen 0.
 *
 * @param {{bedingung: {sql: string, werte: Array}, trocken?: boolean, stueck?: number, hoechstens?: number}} a
 *   `bedingung` aus `Aufbewahrung.bedingung` (Tabelle `fortschritt_buchungen`)
 * @returns {Promise<{zeilen: number, rest: boolean}>} `zeilen`: verdichtete Einzelbuchungen
 */
async function verdichte({ bedingung, trocken = false, stueck = 5000, hoechstens = 200 }) {
    const wo = `${bedingung.sql} AND \`fortschritt_buchungen\`.\`quelle\` <> '${QUELLEN.VERDICHTET}'`;
    if (trocken) {
        const [{ n }] = await lies(`SELECT COUNT(*) AS n FROM \`fortschritt_buchungen\` WHERE ${wo}`, bedingung.werte);
        return { zeilen: Number(n), rest: false };
    }
    let zeilen = 0;
    for (let i = 0; i < hoechstens; i++) {
        const n = await transaktion(async (q) => {
            const ids = (await q(`SELECT id FROM \`fortschritt_buchungen\` WHERE ${wo} ORDER BY id LIMIT ${Number(stueck)} FOR UPDATE`, bedingung.werte)).map((z) => z.id);
            if (!ids.length) return 0;
            const summen = await q(`SELECT guild_id, kennung, mitglied_id, DATE_FORMAT(zeit, '%Y-%m') AS monat,
                                           SUM(CASE WHEN storniert_am IS NULL THEN menge ELSE 0 END) AS menge, COUNT(*) AS n
                                    FROM fortschritt_buchungen WHERE id IN (?) GROUP BY guild_id, kennung, mitglied_id, monat`, [ids]);
            for (const s of summen) {
                const menge = zahl(s.menge);
                if (menge === 0) continue;
                await q(`INSERT INTO fortschritt_buchungen (guild_id, kennung, mitglied_id, menge, quelle, schluessel, grund, zeit)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                         ON DUPLICATE KEY UPDATE menge = menge + VALUES(menge)`,
                [s.guild_id, s.kennung, s.mitglied_id, menge, QUELLEN.VERDICHTET, `verdichtet:${s.mitglied_id}:${s.monat}`, `Monatssumme ${s.monat}`, `${s.monat}-01 00:00:00`]);
            }
            await q('DELETE FROM fortschritt_buchungen WHERE id IN (?)', [ids]);
            return ids.length;
        });
        zeilen += n;
        if (n < stueck) return { zeilen, rest: false };
    }
    return { zeilen, rest: true };
}

/**
 * Nachrechnen: Stimmt jeder Stand mit der Summe seiner Buchungen?
 * Mit `reparieren` wird der Stand auf die Summe gesetzt und das Level neu gerechnet.
 *
 * @returns {Promise<{geprueft: number, abweichungen: Array<{mitglied_id, stand, summe}>}>}
 */
async function pruefe({ guildId, kennung, reparieren = false }) {
    const g = pruefeGuild(guildId);
    brauche(kennung);
    const zeilen = await lies(`SELECT st.mitglied_id, st.xp AS stand, COALESCE(SUM(CASE WHEN b.storniert_am IS NULL THEN b.menge END), 0) AS summe
                               FROM fortschritt_stand st
                               LEFT JOIN fortschritt_buchungen b ON b.guild_id = st.guild_id AND b.kennung = st.kennung AND b.mitglied_id = st.mitglied_id
                               WHERE st.guild_id = ? AND st.kennung = ? GROUP BY st.mitglied_id, st.xp`, [g, kennung]);
    const abweichungen = zeilen.filter((z) => zahl(z.stand) !== zahl(z.summe)).map((z) => ({ mitglied_id: String(z.mitglied_id), stand: zahl(z.stand), summe: zahl(z.summe) }));
    if (reparieren && abweichungen.length) {
        await transaktion(async (q) => {
            const tabelle = await ladeStufen(q, g, kennung);
            for (const a of abweichungen) {
                await q('UPDATE fortschritt_stand SET xp = ?, level = ?, geaendert = NOW(3) WHERE guild_id = ? AND kennung = ? AND mitglied_id = ?',
                    [a.summe, levelAus(tabelle, a.summe), g, kennung, a.mitglied_id]);
            }
        });
    }
    return { geprueft: zeilen.length, abweichungen };
}

module.exports = {
    // buchen und lesen
    buche, storniere, stand, gesamtstand, rangliste, position,
    // Stufen
    stufen, setzeStufen, setzeEinstellungen, rechne, schablone, ordneStufen, levelAus,
    // Saisons
    legeSaisonAn, saisons, beendeSaison, beendeFaellige, loescheSaison,
    // Aufräumen
    entferneMitglied, setzeZurueck, loescheKennung, loeschePlugin, verdichte, pruefe,
    // Erklärungen
    erklaerungen, erklaerungFuer, pruefeForm,
    Eingabefehler, SCHABLONEN, QUELLEN, STUFEN_MAX, KENNUNG, MUSTER,
};
