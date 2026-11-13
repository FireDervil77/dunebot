'use strict';
/**
 * Aufbewahrung: Was älter ist als seine Frist, wird nachts gelöscht (G-05, K382).
 *
 * **Was wie lange bleibt, steht nicht hier**, sondern in der `package.json`
 * jedes Plugins (Wächter `scripts/check-aufbewahrung.js`):
 *
 *     "aufbewahrung": [
 *       { "name": "faelle", "tabelle": "moderation_logs", "zeitspalte": "created_at",
 *         "vorgabe_tage": 365, "hoechstens_tage": 730,
 *         "guild": true, "recht": "MODERATION.SETTINGS.EDIT",
 *         "titel": "moderation:AUFBEWAHRUNG.FAELLE" }
 *     ]
 *
 *   name            eindeutig im Plugin, klein
 *   tabelle         gelöscht werden ganze Zeilen; Kind-Zeilen nimmt die
 *                   Datenbank über ON DELETE CASCADE mit
 *   zeitspalte      ab wann gezählt wird
 *   vorgabe_tage    gilt, solange die Guild nichts einstellt
 *   hoechstens_tage Obergrenze, solange der Betreiber unter /admin/aufbewahrung
 *                   keine andere setzt. Die Vorgabe wird mit begrenzt.
 *   guild           true: die Guild stellt die Tage auf der Plugin-Seite ein
 *                   (Kern-Teil `shared/aufbewahrung`), braucht `guild_id` in
 *                   der Tabelle und `recht` (Recht zum Ändern). false: nur der
 *                   Betreiber, gilt für alle Zeilen.
 *   titel           Sprachschlüssel, was hier aufbewahrt wird
 *   wo              optional `{ spalte: [werte] }`: nur diese Zeilen
 *   ohne            optional `{ tabelle, spalte, wo }`: nur Zeilen, auf die
 *                   keine solche Kind-Zeile zeigt (`spalte` = Verweis auf `id`)
 *
 * Jede Tabelle, die in `mitgliedInhalte` den Weg `frist` trägt, braucht hier
 * eine Frist ohne `wo` und `ohne`, sonst bliebe sie für immer (Wächter).
 *
 * **Wirksame Tage** einer Zeile: was ihre Guild eingestellt hat, sonst die
 * Vorgabe, beides höchstens die Obergrenze. Zeilen ohne Guild bekommen die
 * Vorgabe. Ob das Plugin in der Guild an ist, spielt keine Rolle: Alte Zeilen
 * gehen auch, wenn es aus ist.
 *
 * **Der Lauf** ist eine Aufgabe im Zeitplan (G-06, `core:aufbewahrung`,
 * 03:30). Er löscht in Stücken zu `STUECK` Zeilen, damit keine Tabelle lange
 * gesperrt ist. Scheitert eine Frist, laufen die übrigen weiter, der Lauf
 * gilt danach als Fehler (rot unter /admin/zeitplan und /admin/aufbewahrung).
 *
 * @module apps/dashboard/helpers/Aufbewahrung
 */
const fs = require('fs');
const path = require('path');
const { ServiceManager } = require('dunebot-core');

const PLUGINS = path.join(__dirname, '..', '..', '..', 'plugins');
const TAKT = '30 3 * * *';
const STUECK = 5000;
/** Mehr Stücke je Frist und Nacht nicht; der Rest kommt in der nächsten Nacht. */
const HOECHSTENS_STUECKE = 200;
/** Größte Zahl, die Guild oder Betreiber eintragen können (zehn Jahre). */
const TAGE_MAX = 3653;
const BEZEICHNER = /^[a-z][a-z0-9_]{0,63}$/;
const NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/;

const db = () => ServiceManager.get('dbService');
const log = () => ServiceManager.get('Logger');
const q = (name) => `\`${name}\``;
const schluessel = (e) => `${e.plugin}:${e.name}`;

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
 * Formfehler der Erklärungen, ohne Datenbank (prüft auch der Wächter).
 *
 * @param {Object<string, Object>} meta Plugin → package.json
 * @returns {string[]}
 */
function pruefeForm(meta) {
    const fehler = [];
    for (const [plugin, m] of Object.entries(meta)) {
        if (m.aufbewahrung === undefined) continue;
        if (!Array.isArray(m.aufbewahrung)) { fehler.push(`${plugin}: aufbewahrung ist keine Liste`); continue; }
        const namen = new Set();
        for (const e of m.aufbewahrung) {
            const wer = `${plugin}:${e?.name}`;
            if (!NAME.test(String(e?.name ?? ''))) fehler.push(`${wer}: name fehlt oder ist nicht klein`);
            if (namen.has(e?.name)) fehler.push(`${wer}: name doppelt`);
            namen.add(e?.name);
            if (!BEZEICHNER.test(String(e?.tabelle ?? ''))) fehler.push(`${wer}: tabelle fehlt`);
            if (!BEZEICHNER.test(String(e?.zeitspalte ?? ''))) fehler.push(`${wer}: zeitspalte fehlt`);
            for (const f of ['vorgabe_tage', 'hoechstens_tage']) {
                if (!Number.isInteger(e?.[f]) || e[f] < 1 || e[f] > TAGE_MAX) fehler.push(`${wer}: ${f} muss eine ganze Zahl von 1 bis ${TAGE_MAX} sein`);
            }
            if (e?.vorgabe_tage > e?.hoechstens_tage) fehler.push(`${wer}: vorgabe_tage über hoechstens_tage`);
            if (typeof e?.guild !== 'boolean') fehler.push(`${wer}: guild muss true oder false sein`);
            if (e?.guild === true && !/^[A-Z0-9_.]+$/.test(String(e?.recht ?? ''))) fehler.push(`${wer}: guild ohne recht`);
            if (!/^[a-z0-9_-]+:[A-Z0-9_.]+$/.test(String(e?.titel ?? ''))) fehler.push(`${wer}: titel ist kein Sprachschlüssel`);
            for (const [bed, wo] of [['wo', e?.wo], ['ohne.wo', e?.ohne?.wo]]) {
                if (wo === undefined) continue;
                if (!wo || typeof wo !== 'object' || Array.isArray(wo)) { fehler.push(`${wer}: ${bed} ist kein Objekt`); continue; }
                for (const [s, w] of Object.entries(wo)) {
                    if (!BEZEICHNER.test(s)) fehler.push(`${wer}: ${bed} Spalte ${s}`);
                    if (!Array.isArray(w) || !w.length || w.some(x => typeof x !== 'string' && typeof x !== 'number')) fehler.push(`${wer}: ${bed}.${s} braucht eine Liste von Werten`);
                }
            }
            if (e?.ohne !== undefined && (!BEZEICHNER.test(String(e.ohne?.tabelle ?? '')) || !BEZEICHNER.test(String(e.ohne?.spalte ?? '')))) {
                fehler.push(`${wer}: ohne braucht tabelle und spalte`);
            }
        }
    }
    return fehler;
}

/**
 * Alle Fristen aller Plugins.
 *
 * @param {Object} [meta] zum Prüfen; sonst frisch gelesen
 * @returns {Array<Object>}
 */
function erklaerungen(meta = pakete()) {
    const fehler = pruefeForm(meta);
    if (fehler.length) throw new Error(`Aufbewahrung: Erklärungen fehlerhaft: ${fehler.join('; ')}`);
    const aus = [];
    for (const [plugin, m] of Object.entries(meta)) {
        for (const e of m.aufbewahrung || []) aus.push({ plugin, ...e });
    }
    return aus;
}

let fehltGemeldet = false;

/**
 * Lesen aus den eigenen Tabellen. Fehlt eine (Fehler 1146), ist die
 * Kern-Migration noch nicht gelaufen: zwischen Commit und Neustart des
 * Dashboards, in dem sie vor allem anderen läuft. Dann ist auch nichts
 * eingestellt; gelesen wird leer, im Log steht es einmal. Schreiben wirft
 * weiter (Einstellen, Obergrenze, der Stand nach jedem Lauf).
 */
async function lies(sql, werte = []) {
    try {
        return await db().query(sql, werte);
    } catch (err) {
        if (err?.errno !== 1146 || !/aufbewahrung_(fristen|tage)/.test(err.message)) throw err;
        if (!fehltGemeldet) log().warn(`[Aufbewahrung] ${err.message}: Migration noch nicht gelaufen, es gelten die Erklärungen`);
        fehltGemeldet = true;
        return [];
    }
}

/** Vom Betreiber gesetzte Obergrenzen: `plugin:name` → Tage. */
async function grenzen() {
    const zeilen = await lies('SELECT plugin, name, hoechstens_tage FROM aufbewahrung_fristen WHERE hoechstens_tage IS NOT NULL');
    return new Map(zeilen.map(z => [`${z.plugin}:${z.name}`, Number(z.hoechstens_tage)]));
}

/** Obergrenze einer Frist: Betreiber vor Erklärung. */
function obergrenze(e, g) {
    return g.get(schluessel(e)) ?? e.hoechstens_tage;
}

/** Wirksame Tage für einen eingestellten Wert (oder keinen). */
function wirksam(e, og, eingestellt) {
    const t = Number.isInteger(eingestellt) ? eingestellt : e.vorgabe_tage;
    return Math.max(1, Math.min(t, og));
}

/** Eingestellte Tage je Guild für eine Frist. */
async function eingestellt(e) {
    if (!e.guild) return new Map();
    const zeilen = await lies('SELECT guild_id, tage FROM aufbewahrung_tage WHERE plugin = ? AND name = ?', [e.plugin, e.name]);
    return new Map(zeilen.map(z => [String(z.guild_id), Number(z.tage)]));
}

/**
 * Die Bedingung für alte Zeilen einer Frist.
 *
 * @param {Object} e Frist
 * @param {number} tage wirksame Tage
 * @param {{guild?: string, ausser?: string[]}} [nur] eine Guild, oder alle außer diesen
 * @returns {{sql: string, werte: Array}}
 */
function bedingung(e, tage, nur = {}) {
    const t = q(e.tabelle);
    const teile = [`${t}.${q(e.zeitspalte)} < NOW() - INTERVAL ? DAY`];
    const werte = [tage];
    for (const [s, w] of Object.entries(e.wo || {})) {
        teile.push(`${t}.${q(s)} IN (${w.map(() => '?').join(',')})`);
        werte.push(...w);
    }
    if (e.ohne) {
        const k = q(e.ohne.tabelle);
        let inner = `${k}.${q(e.ohne.spalte)} = ${t}.\`id\``;
        for (const [s, w] of Object.entries(e.ohne.wo || {})) {
            inner += ` AND ${k}.${q(s)} IN (${w.map(() => '?').join(',')})`;
            werte.push(...w);
        }
        teile.push(`NOT EXISTS (SELECT 1 FROM ${k} WHERE ${inner})`);
    }
    if (nur.guild !== undefined) {
        teile.push(`${t}.\`guild_id\` = ?`);
        werte.push(nur.guild);
    } else if (nur.ausser?.length) {
        teile.push(`(${t}.\`guild_id\` IS NULL OR ${t}.\`guild_id\` NOT IN (${nur.ausser.map(() => '?').join(',')}))`);
        werte.push(...nur.ausser);
    }
    return { sql: teile.join(' AND '), werte };
}

/**
 * Alte Zeilen löschen (oder im Probelauf zählen).
 *
 * @returns {Promise<{zeilen: number, rest: boolean}>} `rest`: nach
 *   `HOECHSTENS_STUECKE` abgebrochen, die nächste Nacht macht weiter
 */
async function loesche(e, wo, trocken) {
    if (trocken) {
        const [{ n }] = await db().query(`SELECT COUNT(*) AS n FROM ${q(e.tabelle)} WHERE ${wo.sql}`, wo.werte);
        return { zeilen: Number(n), rest: false };
    }
    let zeilen = 0;
    for (let i = 0; i < HOECHSTENS_STUECKE; i++) {
        const r = await db().query(`DELETE FROM ${q(e.tabelle)} WHERE ${wo.sql} LIMIT ${STUECK}`, wo.werte);
        const n = Number(r?.affectedRows || 0);
        zeilen += n;
        if (n < STUECK) return { zeilen, rest: false };
    }
    return { zeilen, rest: true };
}

/**
 * Eine Frist anwenden: erst die Guilds mit eigener Einstellung, dann alle
 * übrigen Zeilen mit der Vorgabe.
 */
async function anwenden(e, og, gesetzt, trocken) {
    let zeilen = 0;
    let rest = false;
    if (e.guild) {
        for (const [guildId, t] of gesetzt) {
            const r = await loesche(e, bedingung(e, wirksam(e, og, t), { guild: guildId }), trocken);
            zeilen += r.zeilen;
            rest ||= r.rest;
        }
    }
    const r = await loesche(e, bedingung(e, wirksam(e, og, null), e.guild ? { ausser: [...gesetzt.keys()] } : {}), trocken);
    return { zeilen: zeilen + r.zeilen, rest: rest || r.rest };
}

/**
 * Der Lauf über alle Fristen.
 *
 * @param {{trocken?: boolean, nurPlugin?: string, meta?: Object}} [optionen]
 *   `trocken`: nur zählen, nichts löschen, nichts schreiben. `meta`: andere
 *   Erklärungen als die der Plugins (nur der Wächter; so auch unten)
 * @returns {Promise<{je: Array<{frist, zeilen, rest, fehler}>, zeilen: number, fehler: number}>}
 */
async function laufen({ trocken = false, nurPlugin = null, meta } = {}) {
    const g = await grenzen();
    const je = [];
    for (const e of erklaerungen(meta)) {
        if (nurPlugin && e.plugin !== nurPlugin) continue;
        const r = { frist: schluessel(e), zeilen: 0, rest: false, fehler: null };
        je.push(r);
        try {
            const og = obergrenze(e, g);
            Object.assign(r, await anwenden(e, og, await eingestellt(e), trocken));
        } catch (err) {
            r.fehler = err.message;
            log().error(`[Aufbewahrung] ${r.frist} gescheitert:`, err);
        }
        if (trocken) continue;
        await db().query(`
            INSERT INTO aufbewahrung_fristen (plugin, name, letzter_lauf, zuletzt_geloescht, geloescht_gesamt, letzter_fehler)
            VALUES (?, ?, NOW(3), ?, ?, ?)
            ON DUPLICATE KEY UPDATE letzter_lauf = NOW(3), zuletzt_geloescht = VALUES(zuletzt_geloescht),
                geloescht_gesamt = geloescht_gesamt + VALUES(zuletzt_geloescht), letzter_fehler = VALUES(letzter_fehler)
        `, [e.plugin, e.name, r.zeilen, r.zeilen, r.fehler ? r.fehler.slice(0, 500) : null]);
        if (r.zeilen) log().info(`[Aufbewahrung] ${r.frist}: ${r.zeilen} Zeile(n) aus ${e.tabelle} gelöscht${r.rest ? ', Rest folgt in der nächsten Nacht' : ''}`);
    }
    return { je, zeilen: je.reduce((a, r) => a + r.zeilen, 0), fehler: je.filter(r => r.fehler).length };
}

/** Handler im Zeitplan: Ergebnis als Text, Fehler als Wurf. */
async function nachts() {
    const r = await laufen();
    const geloescht = r.je.filter(x => x.zeilen).map(x => `${x.frist} ${x.zeilen}`);
    const text = geloescht.length ? `${r.zeilen} Zeile(n) gelöscht: ${geloescht.join(', ')}` : 'nichts zu löschen';
    if (r.fehler) throw new Error(`${r.je.filter(x => x.fehler).map(x => `${x.frist}: ${x.fehler}`).join('; ')} (${text})`);
    return text;
}

/**
 * Die Fristen eines Plugins, die eine Guild einstellen kann.
 *
 * @returns {Promise<Array<{name, titel, vorgabe, obergrenze, eingestellt, wirksam}>>}
 */
async function fuerGuild(guildId, plugin, { meta } = {}) {
    const g = await grenzen();
    const eigene = erklaerungen(meta).filter(e => e.plugin === plugin && e.guild);
    if (!eigene.length) return [];
    const zeilen = await lies('SELECT name, tage FROM aufbewahrung_tage WHERE guild_id = ? AND plugin = ?', [String(guildId), plugin]);
    const gesetzt = new Map(zeilen.map(z => [z.name, Number(z.tage)]));
    return eigene.map(e => {
        const og = obergrenze(e, g);
        const t = gesetzt.has(e.name) ? gesetzt.get(e.name) : null;
        return { name: e.name, titel: e.titel, recht: e.recht, vorgabe: wirksam(e, og, null), obergrenze: og, eingestellt: t, wirksam: wirksam(e, og, t) };
    });
}

/** Ganze Zahl aus einer Eingabe, sonst null (leer = Vorgabe). */
function tageAus(wert) {
    if (wert === null || wert === undefined || String(wert).trim() === '') return null;
    const n = Number(String(wert).trim());
    return Number.isInteger(n) ? n : NaN;
}

/**
 * Was eine Guild einstellt. `tage` null oder leer = zurück zur Vorgabe.
 *
 * @returns {Promise<{ok: boolean, grund?: string, wirksam?: number}>}
 */
async function setzeGuild(guildId, plugin, name, wert, { meta } = {}) {
    const e = erklaerungen(meta).find(x => x.plugin === plugin && x.name === name && x.guild);
    if (!e) return { ok: false, grund: `Keine einstellbare Frist ${plugin}:${name}` };
    const og = obergrenze(e, await grenzen());
    const tage = tageAus(wert);
    if (Number.isNaN(tage) || (tage !== null && (tage < 1 || tage > og))) {
        return { ok: false, grund: `Erlaubt sind 1 bis ${og} Tage`, obergrenze: og };
    }
    if (tage === null) {
        await db().query('DELETE FROM aufbewahrung_tage WHERE guild_id = ? AND plugin = ? AND name = ?', [String(guildId), plugin, name]);
    } else {
        await db().query(`
            INSERT INTO aufbewahrung_tage (guild_id, plugin, name, tage) VALUES (?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE tage = VALUES(tage), geaendert_am = NOW(3)
        `, [String(guildId), plugin, name, tage]);
    }
    return { ok: true, wirksam: wirksam(e, og, tage) };
}

/**
 * Obergrenze des Betreibers. `wert` leer = die aus der Erklärung.
 * Guilds mit mehr Tagen werden beim Lauf begrenzt, ihre Einstellung bleibt.
 */
async function setzeGrenze(plugin, name, wert, { meta } = {}) {
    const e = erklaerungen(meta).find(x => x.plugin === plugin && x.name === name);
    if (!e) return { ok: false, grund: `Keine Frist ${plugin}:${name}` };
    const tage = tageAus(wert);
    if (Number.isNaN(tage) || (tage !== null && (tage < 1 || tage > TAGE_MAX))) return { ok: false, grund: `Erlaubt sind 1 bis ${TAGE_MAX} Tage` };
    await db().query(`
        INSERT INTO aufbewahrung_fristen (plugin, name, hoechstens_tage, geaendert_am) VALUES (?, ?, ?, NOW(3))
        ON DUPLICATE KEY UPDATE hoechstens_tage = VALUES(hoechstens_tage), geaendert_am = NOW(3)
    `, [plugin, name, tage]);
    return { ok: true, obergrenze: tage ?? e.hoechstens_tage };
}

/**
 * Stand aller Fristen für /admin/aufbewahrung.
 */
async function stand({ meta } = {}) {
    const g = await grenzen();
    const zeilen = await db().query('SELECT * FROM aufbewahrung_fristen');
    const lauf = new Map(zeilen.map(z => [`${z.plugin}:${z.name}`, z]));
    const aus = [];
    for (const e of erklaerungen(meta)) {
        const og = obergrenze(e, g);
        const gesetzt = await eingestellt(e);
        const werte = [...gesetzt.values()].map(t => wirksam(e, og, t));
        const z = lauf.get(schluessel(e)) || {};
        let bestand = null;
        try {
            const [r] = await db().query(`SELECT COUNT(*) AS n, MIN(${q(e.zeitspalte)}) AS aelteste FROM ${q(e.tabelle)}`);
            bestand = { zeilen: Number(r.n), aelteste: r.aelteste };
        } catch (err) {
            bestand = { fehler: err.message };
        }
        aus.push({
            ...e, schluessel: schluessel(e),
            obergrenze: og, grenze_gesetzt: g.has(schluessel(e)), vorgabe: wirksam(e, og, null),
            guilds: gesetzt.size, kuerzeste: werte.length ? Math.min(...werte) : null, laengste: werte.length ? Math.max(...werte) : null,
            begrenzt: [...gesetzt.values()].filter(t => t > og).length,
            bestand,
            letzter_lauf: z.letzter_lauf || null, zuletzt_geloescht: Number(z.zuletzt_geloescht || 0),
            geloescht_gesamt: Number(z.geloescht_gesamt || 0), letzter_fehler: z.letzter_fehler || null,
        });
    }
    return aus;
}

/**
 * Für die Datenauskunft: wie lange Zeilen dieser Tabelle höchstens bleiben.
 * In einer Guild deren Tage, sonst das Längste über alle Guilds. Bei
 * mehreren Fristen auf derselben Tabelle die längste (die anderen löschen
 * nur einen Teil früher).
 *
 * @returns {Promise<Map<string, number>>} Tabelle → Tage
 */
async function tageJeTabelle(guildId = null, { meta } = {}) {
    const g = await grenzen();
    const aus = new Map();
    for (const e of erklaerungen(meta)) {
        const og = obergrenze(e, g);
        const gesetzt = await eingestellt(e);
        let t;
        if (!e.guild) t = wirksam(e, og, null);
        else if (guildId != null) t = wirksam(e, og, gesetzt.has(String(guildId)) ? gesetzt.get(String(guildId)) : null);
        else t = Math.max(wirksam(e, og, null), ...[...gesetzt.values()].map(x => wirksam(e, og, x)));
        aus.set(e.tabelle, Math.max(aus.get(e.tabelle) || 0, t));
    }
    return aus;
}

let gestartet = false;

/** In den Zeitplan eintragen (nach `Zeitplan.starten()`). */
function starten() {
    if (gestartet) return;
    gestartet = true;
    const n = erklaerungen().length;
    require('./Zeitplan').eintragen('core:aufbewahrung', TAKT, nachts);
    ServiceManager.register('aufbewahrung', module.exports);
    log().info(`[Aufbewahrung] eingetragen (${n} Fristen, Takt ${TAKT})`);
}

module.exports = {
    starten, laufen, nachts, fuerGuild, setzeGuild, setzeGrenze, stand, tageJeTabelle,
    erklaerungen, pruefeForm, bedingung, wirksam, TAKT, STUECK, TAGE_MAX,
};
