#!/usr/bin/env node
/**
 * Wächter der Gestaltung je Guild (G-09, K382, 2026-11-14).
 *
 * Farben, Logo und Banner der Bot-Ausgaben: Palette der Guild unter
 * Einstellungen → Gestaltung, eigene Farben je Plugin über den Kern-Teil
 * `shared/plugin-farben`, Auflösung in `packages/dunebot-sdk/lib/Gestaltung.js`.
 *
 * Erklärungen:
 *   1. `farben` je package.json: Rollen aus den fünf, Werte `#rrggbb`, `recht`
 *      in der permissions.json des Plugins, `seite` gesetzt.
 *   2. Wer `farben` erklärt, bindet `shared/plugin-farben` mit seinem Namen ein,
 *      außerhalb eines Formulars; wer ihn einbindet, erklärt `farben`.
 *   3. Jeder Aufruf `Gestaltung.farbe(…, 'rolle', 'plugin')` in einem Plugin
 *      nennt das eigene Plugin und eine Rolle aus dessen `farben.rollen`
 *      (sonst fiele er still auf die Vorgabe des Kerns). Ebenso `farbig()` in
 *      music.
 *   4. Vorgabe des Kerns = Theme-Farben aus tokens.css.
 *   5. Tote Schlüssel weg: giveaway START/END_EMBED_COLOR, music EMBED_FARBE
 *      und `music_settings.embed_color` (Dateien; Datenbank nach der Migration).
 *   6. Texte in beiden Sprachen.
 * Verdrahtung:
 *   7. SDK gibt `Gestaltung` aus; Bot-IPC `GESTALTUNG_GEAENDERT` gibt es und
 *      das Dashboard sendet genau diesen Namen.
 *   8. Jede schreibende Route unter /gestaltung hat csrfProtection und
 *      `requireBesitzerInKontrollGuild` (Kontroll-Guild: nur der Besitzer).
 *      Kein anderer Ort schreibt `guild_gestaltung`.
 *   9. `guild_gestaltung` geht mit der Guild; Navigation „Gestaltung“.
 * Läufe an TEMPORARY-Tabellen der echten Datenbank:
 *  10. Reihenfolge: Plugin → Guild → Vorgabe des Plugins → Kern.
 *  11. Zwischenspeicher: ohne `vergiss` alt, mit neu.
 *  12. Logo/Banner: nur aus der Medienablage derselben Guild, absolute Adresse.
 *  13. Speichern: falsche Farbe, fremdes Bild, Plugin aus → abgewiesen; alles
 *      leer → Zeile weg; „Farben der Guild nutzen“ → Zeile weg; Bot erfährt es.
 *  14. Kontroll-Guild: andere 403, Besitzer und andere Guilds durch.
 *  15. Gegenproben an Kopien des SDK (Reihenfolge, ohne Plugin-Vorgabe, ohne
 *      Guild-Grenze bei Bildern, `vergiss` wirkungslos) → jeweils rot.
 *
 *   node scripts/check-gestaltung.js
 */
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');
const WURZEL = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(WURZEL, 'apps/dashboard/.env'), quiet: true });
const mysql = require('mysql2/promise');
const { ServiceManager } = require('dunebot-core');
const { ohneKommentare, ohneKommentareEjs } = require('./lib/quelltext');

const SDK_DATEI = path.join(WURZEL, 'packages/dunebot-sdk/lib/Gestaltung.js');

let rot = 0;
async function pruefe(was, tun) {
    try {
        await tun();
        console.log(`  ✓ ${was}`);
    } catch (e) {
        rot++;
        console.log(`  ✗ ${was}\n      ${String(e.message).split('\n').join('\n      ')}`);
    }
}
const lies = (p) => fs.readFileSync(path.join(WURZEL, p), 'utf8');
const code = (p) => ohneKommentare(lies(p));

function pakete() {
    const aus = {};
    for (const p of fs.readdirSync(path.join(WURZEL, 'plugins'))) {
        const d = path.join(WURZEL, 'plugins', p, 'package.json');
        if (fs.existsSync(d)) aus[p] = JSON.parse(fs.readFileSync(d, 'utf8'));
    }
    return aus;
}

function dateien(wurzel, endung) {
    const aus = [];
    const gehe = (d) => {
        if (!fs.existsSync(d)) return;
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            if (e.name === 'node_modules') continue;
            const voll = path.join(d, e.name);
            if (e.isDirectory()) gehe(voll);
            else if (e.name.endsWith(endung)) aus.push(voll);
        }
    };
    gehe(wurzel);
    return aus;
}

const ROLLEN = ['akzent', 'erfolg', 'hinweis', 'warnung', 'gefahr'];

/** 1. Form der Erklärungen. */
function formFehler(meta) {
    const f = [];
    for (const [p, m] of Object.entries(meta)) {
        if (!m.farben) continue;
        const r = m.farben.rollen || {};
        if (!Object.keys(r).length) f.push(`${p}: farben.rollen leer`);
        for (const [rolle, wert] of Object.entries(r)) {
            if (!ROLLEN.includes(rolle)) f.push(`${p}: unbekannte Rolle ${rolle}`);
            if (!/^#[0-9a-f]{6}$/.test(String(wert))) f.push(`${p}: ${rolle} = ${wert} ist nicht #rrggbb (klein)`);
        }
        // JSON, roh gelesen: Kommentare gibt es darin nicht (check-waechter-prosa).
        const d = path.join(WURZEL, 'plugins', p, 'dashboard', 'permissions.json');
        const keys = fs.existsSync(d) ? (JSON.parse(fs.readFileSync(d, 'utf8')).permissions || []).map(x => x.key) : [];
        if (!keys.includes(m.farben.recht)) f.push(`${p}: Recht ${m.farben.recht} fehlt in permissions.json`);
        if (typeof m.farben.seite !== 'string' || !m.farben.seite.startsWith('/')) f.push(`${p}: farben.seite fehlt`);
    }
    return f;
}

/** 2. Kern-Teil: eingebunden genau bei den Erklärenden, außerhalb von Formularen. */
function kernTeilFehler(meta, ansichtenJe = (p) => dateien(path.join(WURZEL, 'plugins', p, 'dashboard', 'views'), '.ejs')) {
    const f = [];
    for (const p of Object.keys(meta)) {
        const muster = /include\(\s*['"]shared\/plugin-farben['"]\s*,\s*\{[^}]*plugin\s*:\s*['"]([a-z0-9_-]+)['"]/g;
        let gefunden = false;
        for (const datei of ansichtenJe(p)) {
            const text = ohneKommentareEjs(fs.readFileSync(datei, 'utf8'));
            let t;
            while ((t = muster.exec(text))) {
                if (t[1] !== p) f.push(`${path.relative(WURZEL, datei)}: bindet die Farben von ${t[1]} ein`);
                else gefunden = true;
                const davor = text.slice(0, t.index);
                if ((davor.match(/<form\b/g) || []).length > (davor.match(/<\/form>/g) || []).length) {
                    f.push(`${path.relative(WURZEL, datei)}: shared/plugin-farben steht in einem Formular`);
                }
            }
        }
        if (meta[p].farben && !gefunden) f.push(`${p}: erklärt farben, bindet shared/plugin-farben nicht ein`);
        if (!meta[p].farben && gefunden) f.push(`${p}: bindet shared/plugin-farben ein, erklärt aber keine farben`);
    }
    return f;
}

/** 3. Aufrufe der Plugins gegen ihre Erklärung. */
function aufrufFehler(meta, quelleJe = (p) => dateien(path.join(WURZEL, 'plugins', p), '.js')) {
    const f = [];
    for (const p of Object.keys(meta)) {
        const rollen = Object.keys(meta[p].farben?.rollen || {});
        for (const datei of quelleJe(p)) {
            const text = ohneKommentare(fs.readFileSync(datei, 'utf8'));
            const rel = path.relative(WURZEL, datei);
            for (const t of text.matchAll(/Gestaltung\.farbe\(([^)]*)\)/g)) {
                const arg = t[1].split(',').map(s => s.trim());
                const plugin = (arg[2] || '').replace(/^['"]|['"]$/g, '');
                if (plugin !== p) { f.push(`${rel}: Gestaltung.farbe(…, ${arg[2] || 'ohne Plugin'}) statt '${p}'`); continue; }
                // Nicht wörtliche Rolle (music/bot/farben.js: die Marke aus farbig()): dort prüft farbig().
                const woertlich = /^['"]([a-z]+)['"]$/.exec(arg[1] || '');
                if (woertlich && !rollen.includes(woertlich[1])) f.push(`${rel}: Rolle ${woertlich[1]} steht nicht in ${p}/package.json farben.rollen`);
            }
            for (const t of text.matchAll(/\bfarbig\(\s*['"]([a-z]+)['"]\s*\)/g)) {
                if (!rollen.includes(t[1])) f.push(`${rel}: farbig('${t[1]}') steht nicht in ${p}/package.json farben.rollen`);
            }
        }
    }
    return f;
}

/** Zwei Werte gleich, sonst Meldung. */
function gleich(ist, soll, was) {
    assert.deepStrictEqual(ist, soll, `${was}: ist ${JSON.stringify(ist)}, soll ${JSON.stringify(soll)}`);
}

/** Frische Kopie des SDK-Moduls laden (eigener Zwischenspeicher je Kopie). */
function ladeSdk(datei) {
    delete require.cache[require.resolve(datei)];
    return require(datei);
}

/** Läufe 10–12 an einem SDK-Modul. Wirft beim ersten Fehler. */
async function laeufeSdk(G, c) {
    const A = '900000000000000001';
    const B = '900000000000000002';
    await c.query('DELETE FROM guild_gestaltung');
    await c.query('DELETE FROM guild_media');
    G.vergiss();
    gleich((await G.aufloesen(A, 'akzent', 'music')).hex, '#1db954', 'ohne Zeilen: Vorgabe von music');
    gleich((await G.aufloesen(A, 'erfolg', 'music')).quelle, 'kern', 'ohne Zeilen, Rolle ohne Plugin-Vorgabe: Kern');
    gleich((await G.aufloesen(A, 'akzent')).hex, '#3498db', 'ohne Plugin: Kern');
    gleich(await G.farbe(A, 'akzent', 'moderation'), 0x607d8b, 'farbe() als Zahl');
    await assert.rejects(() => G.farbe(A, 'lila', 'music'), /unbekannte Farbrolle/, 'unbekannte Rolle wirft');

    await c.query("INSERT INTO guild_gestaltung (guild_id, plugin, akzent) VALUES (?, '', '#111111')", [A]);
    G.vergiss(A);
    gleich((await G.aufloesen(A, 'akzent', 'music')).hex, '#111111', 'Guild-Palette vor Vorgabe des Plugins');
    gleich((await G.aufloesen(A, 'warnung', 'music')).hex, '#f59f00', 'Rolle ohne Guild-Wert: Vorgabe des Plugins');
    gleich((await G.aufloesen(B, 'akzent', 'music')).hex, '#1db954', 'andere Guild unberührt');

    await c.query("INSERT INTO guild_gestaltung (guild_id, plugin, akzent, warnung) VALUES (?, 'music', '#222222', '#333333')", [A]);
    gleich((await G.aufloesen(A, 'akzent', 'music')).hex, '#111111', 'ohne vergiss: gemerkter Stand');
    G.vergiss(A);
    gleich((await G.aufloesen(A, 'akzent', 'music')).hex, '#222222', 'eigene Farben des Plugins zuerst');
    gleich((await G.aufloesen(A, 'akzent', 'giveaway')).hex, '#111111', 'Zeile von music gilt nicht für giveaway');

    const [m1] = await c.query("INSERT INTO guild_media (guild_id, uploaded_by, filename, stored_name, mime_type, file_size) VALUES (?, '1', 'logo.png', 'a1.png', 'image/png', 1)", [A]);
    const [m2] = await c.query("INSERT INTO guild_media (guild_id, uploaded_by, filename, stored_name, mime_type, file_size) VALUES (?, '1', 'fremd.png', 'b1.png', 'image/png', 1)", [B]);
    await c.query("UPDATE guild_gestaltung SET logo_media_id = ?, banner_media_id = ? WHERE guild_id = ? AND plugin = ''", [m1.insertId, m2.insertId, A]);
    G.vergiss(A);
    const basis = String(process.env.DASHBOARD_BASE_URL || '').replace(/\/+$/, '');
    gleich(await G.bilder(A), { logo: `${basis}/uploads/media/${A}/a1.png`, banner: null }, 'Logo der Guild absolut, Bild einer fremden Guild nicht');
}

async function main() {
    const meta = pakete();

    console.log('Erklärungen');
    await pruefe('1. farben: Rollen, Werte, Recht, Seite', () => {
        const f = formFehler(meta);
        assert(!f.length, f.join('\n'));
        const erklaert = Object.keys(meta).filter(p => meta[p].farben).sort();
        gleich(erklaert, ['giveaway', 'moderation', 'music'], 'erste Nutzer');
    });
    await pruefe('1. Gegenprobe: falscher Wert, fremde Rolle, unbekanntes Recht rot', () => {
        const kaputt = { music: { farben: { recht: 'GIBT.ES.NICHT', seite: '/settings', rollen: { akzent: '#ABC', lila: '#000000' } } } };
        assert.strictEqual(formFehler(kaputt).length, 3, formFehler(kaputt).join('; '));
    });
    await pruefe('2. Kern-Teil bei genau den Erklärenden, außerhalb von Formularen', () => {
        const f = kernTeilFehler(meta);
        assert(!f.length, f.join('\n'));
    });
    await pruefe('2. Gegenprobe: im Formular rot, fehlend rot', () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gestaltung-'));
        const d = path.join(tmp, 'a.ejs');
        fs.writeFileSync(d, "<form>\n<%- include('shared/plugin-farben', { guildId, tr, plugin: 'music' }) %>\n</form>");
        const f1 = kernTeilFehler({ music: meta.music }, () => [d]);
        const f2 = kernTeilFehler({ music: meta.music }, () => []);
        fs.rmSync(tmp, { recursive: true, force: true });
        assert(f1.some(x => x.includes('in einem Formular')), 'im Formular nicht erkannt');
        assert(f2.some(x => x.includes('bindet shared/plugin-farben nicht ein')), 'fehlend nicht erkannt');
    });
    await pruefe('2. Kein document.currentScript in Ansichten (Layout zieht Skripte ans Ende)', () => {
        // `layout extractScripts` (ThemeRenderer.js) verschiebt jedes <script>
        // ans Seitenende. Ein Skript, das seine Karte über currentScript sucht,
        // findet sie dort nicht und bleibt still stehen (2026-11-14: Farben und
        // Aufbewahrung drehten auf den Plugin-Seiten endlos).
        const f = [];
        for (const wurzel of ['apps/dashboard/themes', 'plugins']) {
            for (const d of dateien(path.join(WURZEL, wurzel), '.ejs')) {
                const text = fs.readFileSync(d, 'utf8').split('\n').filter(z => !/^\s*\/\//.test(z)).join('\n');
                if (/document\.currentScript/.test(text)) f.push(path.relative(WURZEL, d));
            }
        }
        assert(!f.length, f.join('\n'));
    });
    await pruefe('3. Aufrufe nennen das eigene Plugin und erklärte Rollen', () => {
        const f = aufrufFehler(meta);
        assert(!f.length, f.join('\n'));
        let n = 0;
        for (const p of ['moderation', 'giveaway']) for (const d of dateien(path.join(WURZEL, 'plugins', p, 'bot'), '.js')) n += (ohneKommentare(fs.readFileSync(d, 'utf8')).match(/Gestaltung\.farbe\(/g) || []).length;
        assert(n >= 8, `nur ${n} Aufrufe in moderation und giveaway, erwartet mindestens 8`);
    });
    await pruefe('3. Gegenprobe: fremdes Plugin, nicht erklärte Rolle rot', () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gestaltung-'));
        const d = path.join(tmp, 'a.js');
        fs.writeFileSync(d, "Gestaltung.farbe(g, 'akzent', 'music'); Gestaltung.farbe(g, 'erfolg', 'giveaway'); farbig('erfolg');");
        const f = aufrufFehler({ giveaway: meta.giveaway }, () => [d]);
        fs.rmSync(tmp, { recursive: true, force: true });
        assert.strictEqual(f.length, 3, f.join('; '));
    });
    await pruefe('3. music: keine feste Farbe mehr außer „verlassen“', () => {
        const f = [];
        for (const d of dateien(path.join(WURZEL, 'plugins/music/bot'), '.js')) {
            const text = ohneKommentare(fs.readFileSync(d, 'utf8'));
            for (const t of text.matchAll(/color:\s*(0x[0-9a-fA-F]{6}|FARBE)/g)) {
                if (!(d.endsWith('interactionCreate.js') && t[1] === '0x6C757D')) f.push(`${path.relative(WURZEL, d)}: color: ${t[1]}`);
            }
        }
        assert(!f.length, f.join('\n'));
        const sende = code('plugins/music/bot/commands/music.js');
        assert((sende.match(/await faerbe\(antwort,/g) || []).length === 2, 'music.js färbt nicht beide Antwortwege ein');
        assert((code('plugins/music/bot/managers/GuildPlayer.js').match(/faerbe\(steuerung\.nachricht/g) || []).length === 2, 'GuildPlayer färbt Ansage und Auffrischen nicht ein');
    });
    await pruefe('4. Vorgabe des Kerns = Theme-Farben', () => {
        const G = ladeSdk(SDK_DATEI);
        const css = lies('apps/dashboard/themes/default/assets/css/tokens.css');
        const token = (n) => (css.match(new RegExp(`--fb-${n}:\\s*(#[0-9a-fA-F]{6})`)) || [])[1]?.toLowerCase();
        gleich({ ...G.KERN_VORGABE }, { akzent: token('primary'), erfolg: token('success'), hinweis: token('info'), warnung: token('warning'), gefahr: token('danger') }, 'KERN_VORGABE');
    });
    await pruefe('5. Tote Schlüssel aus den Dateien', () => {
        const f = [];
        // Ohne Kommentare: Die Route erklärt im Kommentar, dass `embed_color` dort stand.
        const sieh = (p, re) => { if (re.test(p.endsWith('.js') ? code(p) : lies(p))) f.push(`${p}: ${re}`); };
        sieh('plugins/giveaway/dashboard/config.json', /START_EMBED_COLOR|END_EMBED_COLOR/);
        sieh('plugins/music/config.json', /EMBED_FARBE/);
        sieh('plugins/music/dashboard/routes/settings.router.js', /updates\.embed_color/);
        for (const d of dateien(path.join(WURZEL, 'plugins/moderation/bot'), '.js')) if (/EMBED_COLORS"?\]?\.DEFAULT|EMBED_COLORS\.DEFAULT/.test(ohneKommentare(fs.readFileSync(d, 'utf8')))) f.push(`${d}: EMBED_COLORS.DEFAULT`);
        assert(!f.length, f.join('\n'));
    });
    await pruefe('6. Texte in beiden Sprachen', () => {
        const de = JSON.parse(lies('plugins/core/dashboard/locales/de-DE.json')).GESTALTUNG;
        const en = JSON.parse(lies('plugins/core/dashboard/locales/en-GB.json')).GESTALTUNG;
        assert(de && en, 'core:GESTALTUNG fehlt');
        gleich(Object.keys(en).sort(), Object.keys(de).sort(), 'Schlüssel de/en');
        const benutzt = new Set();
        for (const d of ['apps/dashboard/themes/default/views/guild/settings/gestaltung.ejs', 'apps/dashboard/themes/default/views/shared/plugin-farben.ejs']) {
            for (const t of ohneKommentareEjs(lies(d)).matchAll(/_t\('([A-Z_]+)'/g)) if (!t[1].endsWith('_')) benutzt.add(t[1]);
        }
        for (const r of ROLLEN) benutzt.add('ROLLE_' + r.toUpperCase());
        const fehlt = [...benutzt].filter(k => !(k in de));
        assert(!fehlt.length, `fehlt: ${fehlt.join(', ')}`);
        for (const s of ['de-DE', 'en-GB']) assert(JSON.parse(lies(`apps/dashboard/locales/${s}.json`)).NAV?.GESTALTUNG, `NAV.GESTALTUNG fehlt in ${s}`);
    });

    console.log('Verdrahtung');
    await pruefe('7. SDK, Bot-IPC und Benachrichtigung passen zusammen', () => {
        assert(/Gestaltung\s*=\s*require\("\.\/lib\/Gestaltung"\)/.test(code('packages/dunebot-sdk/index.js')) && /^\s*Gestaltung,/m.test(code('packages/dunebot-sdk/index.js')), 'SDK gibt Gestaltung nicht aus');
        assert(fs.existsSync(path.join(WURZEL, 'apps/bot/ipc/GESTALTUNG_GEAENDERT.js')), 'apps/bot/ipc/GESTALTUNG_GEAENDERT.js fehlt');
        assert(/Gestaltung\.vergiss\(/.test(code('apps/bot/ipc/GESTALTUNG_GEAENDERT.js')), 'Bot-Handler vergisst nicht');
        assert(/broadcast\('dashboard:GESTALTUNG_GEAENDERT'/.test(code('apps/dashboard/helpers/GestaltungSeite.js')), 'Dashboard sendet einen anderen Namen');
    });
    await pruefe('8. Schreibende Routen: CSRF und Besitzer in der Kontroll-Guild; ein Schreiber', () => {
        const r = code('apps/dashboard/routes/guild/settings.router.js');
        const routen = [...r.matchAll(/router\.(put|post|delete|patch)\(\s*'(\/gestaltung[^']*)'([\s\S]*?)\n\}\);/g)];
        gleich(routen.map(x => `${x[1]} ${x[2]}`).sort(), ['put /gestaltung', 'put /gestaltung/plugin/:plugin'], 'schreibende Routen');
        for (const x of routen) {
            assert(/csrfProtection/.test(x[3]), `${x[2]}: ohne csrfProtection`);
            assert(/requireBesitzerInKontrollGuild\(\)/.test(x[3]), `${x[2]}: ohne requireBesitzerInKontrollGuild`);
        }
        const schreiber = [];
        for (const wurzel of ['apps', 'plugins', 'packages']) {
            for (const d of dateien(path.join(WURZEL, wurzel), '.js')) {
                if (/(INSERT INTO|UPDATE|DELETE FROM)\s+`?guild_gestaltung\b/.test(ohneKommentare(fs.readFileSync(d, 'utf8')))) schreiber.push(path.relative(WURZEL, d));
            }
        }
        gleich(schreiber, ['apps/dashboard/helpers/GestaltungSeite.js'], 'wer guild_gestaltung schreibt');
    });
    await pruefe('9. Geht mit der Guild; Navigation', () => {
        assert(meta.core.guildInhalte.loeschen.includes('guild_gestaltung'), 'guild_gestaltung fehlt in core guildInhalte.loeschen');
        assert(/url: `\/guild\/\$\{guildId\}\/settings\/gestaltung`/.test(code('apps/dashboard/helpers/KernNavigation.js')), 'Navigation fehlt');
    });

    console.log('Läufe (TEMPORARY)');
    const c = await mysql.createConnection({
        host: process.env.MYSQL_HOST, port: process.env.MYSQL_PORT, user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE,
    });
    try {
        // Dieselbe Migration, als TEMPORARY: verdeckt in dieser Verbindung die echten Tabellen.
        const migration = require(path.join(WURZEL, 'migrations/kern/20261114_120000_gestaltung.js'));
        await migration.up({ query: (sql) => c.query(sql.replace(/CREATE TABLE IF NOT EXISTS/g, 'CREATE TEMPORARY TABLE')) });
        const [[medien]] = await c.query('SHOW CREATE TABLE guild_media');
        // Ohne Fremdschlüssel: TEMPORARY-Tabellen können keine haben.
        const ohneFk = medien['Create Table'].split('\n').filter(z => !/^\s*CONSTRAINT\b/.test(z)).join('\n').replace(/,\n\)/, '\n)');
        await c.query(ohneFk.replace(/^CREATE TABLE/, 'CREATE TEMPORARY TABLE'));
        await c.query('CREATE TEMPORARY TABLE guilds (_id VARCHAR(20) PRIMARY KEY, owner_id VARCHAR(20))');
        const gesendet = [];
        ServiceManager.register('Logger', { info() {}, warn() {}, error() {}, debug() {} });
        ServiceManager.register('dbService', {
            async query(sql, params = []) { const [r] = await c.query(sql, params); return r; },
            async getEnabledPlugins() { return ['core', 'music']; },
        });
        ServiceManager.register('pluginManager', { async isPluginEnabledForGuild(p) { return p === 'music'; } });
        ServiceManager.register('ipcServer', { async broadcast(name, daten) { gesendet.push([name, daten]); } });

        await pruefe('10.–12. Reihenfolge, Zwischenspeicher, Bilder', () => laeufeSdk(ladeSdk(SDK_DATEI), c));

        await pruefe('13. Speichern prüft und räumt auf, der Bot erfährt es', async () => {
            const A = '900000000000000001';
            const B = '900000000000000002';
            const S = require(path.join(WURZEL, 'apps/dashboard/helpers/GestaltungSeite.js'));
            const { Gestaltung } = require('dunebot-sdk');
            await c.query('DELETE FROM guild_gestaltung');
            await c.query('DELETE FROM guild_media');
            await c.query("INSERT INTO guild_media (guild_id, uploaded_by, filename, stored_name, mime_type, file_size) VALUES (?, '1', 'l.png', 'eigen.png', 'image/png', 1), (?, '1', 'f.png', 'fremd.png', 'image/png', 1), (?, '1', 't.txt', 'text.txt', 'text/plain', 1)", [A, B, A]);
            await assert.rejects(() => S.speichereGuild(A, { farben: { akzent: 'rot' } }), S.Eingabefehler, 'falsche Farbe');
            await assert.rejects(() => S.speichereGuild(A, { logo: `/uploads/media/${B}/fremd.png` }), S.Eingabefehler, 'Bild einer fremden Guild');
            await assert.rejects(() => S.speichereGuild(A, { logo: `/uploads/media/${A}/fremd.png` }), S.Eingabefehler, 'fremdes Bild unter eigenem Pfad');
            await assert.rejects(() => S.speichereGuild(A, { banner: `/uploads/media/${A}/text.txt` }), S.Eingabefehler, 'kein Bild');
            gesendet.length = 0;
            await S.speichereGuild(A, { farben: { akzent: '#ABCDEF', erfolg: '' }, logo: `/uploads/media/${A}/eigen.png` });
            gleich(gesendet, [['dashboard:GESTALTUNG_GEAENDERT', { guildId: A }]], 'Nachricht an den Bot');
            gleich((await Gestaltung.aufloesen(A, 'akzent', 'music')).hex, '#abcdef', 'gespeichert, klein, sofort wirksam');
            const seite = await S.seite(A);
            gleich(seite.logo?.datei, 'l.png', 'Seite zeigt das Logo');
            await S.speichereGuild(A, { farben: {}, logo: '', banner: '' });
            gleich((await c.query("SELECT COUNT(*) n FROM guild_gestaltung WHERE guild_id = ?", [A]))[0][0].n, 0, 'alles leer: Zeile weg');

            await assert.rejects(() => S.speicherePlugin(A, 'giveaway', { eigen: true, farben: { akzent: '#000000', gefahr: '#000000' } }), /nicht eingeschaltet/, 'Plugin aus');
            await assert.rejects(() => S.speicherePlugin(A, 'music', { eigen: true, farben: { akzent: '#000000' } }), S.Eingabefehler, 'Rolle fehlt');
            await S.speicherePlugin(A, 'music', { eigen: true, farben: { akzent: '#010203', warnung: '#040506', gefahr: '#070809', erfolg: '#ffffff' } });
            const [[z]] = await c.query("SELECT * FROM guild_gestaltung WHERE guild_id = ? AND plugin = 'music'", [A]);
            gleich([z.akzent, z.erfolg], ['#010203', null], 'nur erklärte Rollen gespeichert');
            gleich((await S.seite(A)).abweichend.map(x => x.plugin), ['music'], 'Liste „weichen ab“');
            await S.speicherePlugin(A, 'music', { eigen: false });
            gleich((await c.query("SELECT COUNT(*) n FROM guild_gestaltung WHERE guild_id = ? AND plugin = 'music'", [A]))[0][0].n, 0, 'Farben der Guild nutzen: Zeile weg');
        });

        await pruefe('14. Kontroll-Guild: nur der Besitzer schreibt', async () => {
            const { requireBesitzerInKontrollGuild, istKontrollGuildGesperrt } = require(path.join(WURZEL, 'apps/dashboard/middlewares/permissions.middleware.js'));
            const KONTROLLE = process.env.CONTROL_GUILD_ID;
            assert(KONTROLLE, 'CONTROL_GUILD_ID fehlt in apps/dashboard/.env');
            await c.query('INSERT INTO guilds (_id, owner_id) VALUES (?, ?), (?, ?)', [KONTROLLE, '111', '900000000000000003', '222']);
            const lauf = (guildId, userId) => new Promise((fertig) => {
                const req = { session: { user: { info: { id: userId } } }, params: {}, headers: { accept: 'application/json' } };
                const res = { locals: { guildId }, status(n) { this.n = n; return this; }, json() { fertig(this.n); } };
                requireBesitzerInKontrollGuild()(req, res, () => fertig('weiter'));
            });
            gleich(await lauf(KONTROLLE, '999'), 403, 'anderer in der Kontroll-Guild');
            gleich(await lauf(KONTROLLE, '111'), 'weiter', 'Besitzer der Kontroll-Guild');
            gleich(await lauf('900000000000000003', '999'), 'weiter', 'andere Guild: das Recht entscheidet');
            gleich(await istKontrollGuildGesperrt(KONTROLLE, '999'), true, 'Anzeige: gesperrt');
            gleich(await istKontrollGuildGesperrt(KONTROLLE, '111'), false, 'Anzeige: Besitzer frei');
            gleich(await istKontrollGuildGesperrt('900000000000000003', '999'), false, 'Anzeige: andere Guild frei');
        });

        await pruefe('15. Gegenproben an Kopien des SDK werden rot', async () => {
            const quelle = fs.readFileSync(SDK_DATEI, 'utf8');
            const kaputt = {
                'unverändert (muss grün bleiben)': [],
                'Guild vor Plugin': [/if \(eigen\) return \{ hex: eigen, quelle: 'plugin' \};\n(\s*)const guild = hex\(s\.zeilen\.get\(''\)\?\.\[rolle\]\);\n\s*if \(guild\) return \{ hex: guild, quelle: 'guild' \};/,
                    "const guild = hex(s.zeilen.get('')?.[rolle]);\n$1if (guild) return { hex: guild, quelle: 'guild' };\n$1if (eigen) return { hex: eigen, quelle: 'plugin' };"],
                'ohne Vorgabe des Plugins': [/const vorgabe = erklaerung\(plugin\)\?\.rollen\[rolle\];/, 'const vorgabe = null;'],
                'ohne Guild-Grenze bei Bildern': [/ AND lm\.guild_id = g\.guild_id/, '', / AND bm\.guild_id = g\.guild_id/, ''],
                'vergiss wirkungslos': [/else merker\.delete\(String\(guildId\)\);/, 'else void 0;'],
            };
            const tmp = fs.mkdtempSync(path.join(path.dirname(SDK_DATEI), '.gegenprobe-'));
            const gruen = [];
            try {
                for (const [name, ersetzungen] of Object.entries(kaputt)) {
                    // Rohtext gewollt: Die Kopie ist die ganze Datei, nur verändert
                    // (check-waechter-prosa). Sie liegt eine Ebene tiefer, deshalb
                    // den Plugin-Ordner fest eintragen.
                    let text = quelle.replace(/const PLUGINS = path\.join\(__dirname[^;]*;/, `const PLUGINS = ${JSON.stringify(path.join(WURZEL, 'plugins'))};`);
                    assert.notStrictEqual(text, quelle, 'PLUGINS-Zeile nicht gefunden');
                    for (let i = 0; i < ersetzungen.length; i += 2) {
                        const neu = text.replace(ersetzungen[i], ersetzungen[i + 1]);
                        assert.notStrictEqual(neu, text, `Gegenprobe „${name}“ greift nicht mehr (Quelle geändert?)`);
                        text = neu;
                    }
                    const datei = path.join(tmp, 'Gestaltung.js');
                    fs.writeFileSync(datei, text);
                    let fehler = null;
                    try { await laeufeSdk(ladeSdk(datei), c); } catch (e) { fehler = e; }
                    if (!ersetzungen.length) assert(!fehler, `unveränderte Kopie ist rot: ${fehler?.message}`);
                    else if (!fehler) gruen.push(name);
                }
            } finally {
                fs.rmSync(tmp, { recursive: true, force: true });
            }
            assert(!gruen.length, `blieben grün: ${gruen.join(', ')}`);
        });

        await pruefe('5. Tote Schlüssel aus der Datenbank (nach der Migration)', async () => {
            // Ob die Migrationen gelaufen sind, zeigt ihr zweiter Teil: Spalte
            // weg (music), Spalte darf leer sein (giveaway). Dann muss auch der
            // erste Teil (configs) erledigt sein.
            const spalte = async (t, s) => (await c.query('SELECT IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?', [t, s]))[0][0];
            const zeilen = async (p, keys) => (await c.query('SELECT COUNT(*) n FROM configs WHERE plugin_name = ? AND config_key IN (?)', [p, keys]))[0][0].n;
            const musik = await spalte('music_settings', 'embed_color');
            const verlosung = await spalte('giveaways', 'embed_color');
            const offen = [];
            if (musik) offen.push('music'); else gleich(await zeilen('music', ['EMBED_FARBE']), 0, 'music: EMBED_FARBE in configs');
            if (verlosung?.IS_NULLABLE !== 'YES') offen.push('giveaway'); else gleich(await zeilen('giveaway', ['START_EMBED_COLOR', 'END_EMBED_COLOR']), 0, 'giveaway: START/END_EMBED_COLOR in configs');
            if (offen.length) console.log(`      (Migration offen: ${offen.join(', ')}; grün nach dem Neustart)`);
        });
    } finally {
        await c.end();
    }

    console.log(rot ? `\n${rot} rot` : '\nalles grün');
    process.exit(rot ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(2); });
