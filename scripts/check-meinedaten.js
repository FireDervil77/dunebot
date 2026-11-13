#!/usr/bin/env node
/**
 * Die Orte von G-04c (K380, 2026-11-13): `/mydata` im Bot, Seite
 * „Meine Daten“, „Server löschen“ unter Einstellungen → Allgemein.
 *
 * Gezählt, exportiert und gelöscht wird nur in `Datenauskunft` (G-04b, eigener
 * Wächter `check-datenauskunft.js`). Hier geht es um die Wege dorthin:
 *
 *   Zählung     `MeineDaten.uebersicht` je Guild + übergreifend ergibt genau
 *               die Auskunft über alles (echte Datenbank, nur lesend);
 *               `fuerGuild` zeigt dieselben Zahlen wie die Seite
 *   Rückmeldung je Plugin: Gescheitertes bleibt drin, Leeres fällt weg
 *   IPC         die drei `core:MEINEDATEN_*` des Bots kommen an; Löschen nimmt
 *               die ID aus dem Auftrag, „überall“ heißt guildId null
 *   Seite       Ansicht, Export, Löschen nur mit richtigem Namen, ID aus der
 *               Sitzung (nie aus der Anfrage), CSRF, „überall“ beendet die Sitzung
 *   Server löschen  nur der Besitzer, nie die Kontroll-Guild, CSRF, Name;
 *               erst löschen, dann verlässt der Bot die Guild, bei Abbruch nicht
 *   Bot         Befehl: Auskunft, Export als Datei, falscher Name löscht nichts,
 *               hier/überall mit der richtigen Guild; `GUILD_VERLASSEN` lässt
 *               die Kontroll-Guild nie los
 *   Gegenproben im Speicher
 *
 * **Gelöscht wird hier nichts.** `mitgliedLoeschen` und `guildLoeschen` sind
 * vor jeder Anfrage durch Attrappen ersetzt, das wird jedes Mal nachgeprüft.
 * Zusätzlich gibt es keinen PluginManager, der etwas abschalten könnte.
 *
 *   node scripts/check-meinedaten.js [mitglieds-id]
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const WURZEL = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(WURZEL, 'apps/dashboard/.env'), quiet: true });
const { ohneKommentare } = require('./lib/quelltext');

let fehler = 0;
async function pruefe(was, tun) {
    try { await tun(); console.log(`  ✓ ${was}`); }
    catch (e) { fehler++; console.log(`  ✗ ${was}\n      ${String(e.message).split('\n').slice(0, 20).join('\n      ')}`); }
}

const datei = (rel) => path.join(WURZEL, rel);
function attrappe(rel, inhalt) {
    const voll = require.resolve(datei(rel));
    require.cache[voll] = { id: voll, filename: voll, loaded: true, exports: inhalt };
}

/** Steht `/meinedaten` mit Anmeldung in app.js? (Quelltext, für die Gegenprobe getrennt) */
function meinedatenEingehaengt(text) {
    return /\.register\(\s*'\/meinedaten'\s*,\s*require\('\.\/routes\/meinedaten\.router'\)\s*,\s*\{\s*auth:\s*true\s*\}\s*\)/.test(ohneKommentare(text));
}

(async () => {
    console.log('\nMeine Daten und Server löschen (G-04c, K380)');
    const { ServiceManager } = require('dunebot-core');
    const { DBService } = require('dunebot-db-client');
    const db = new DBService();
    ServiceManager.register('dbService', db);
    const protokoll = [];
    const stumm = { info() {}, warn: (m) => protokoll.push(String(m)), error: (m) => protokoll.push(String(m)), debug() {}, success() {} };
    ServiceManager.register('Logger', stumm);

    // ── Attrappen vor jedem anderen require ────────────────────────────────
    const D = require(datei('apps/dashboard/helpers/Datenauskunft.js'));
    const echteAuskunft = D.auskunft;
    const auftraege = [];
    const mitgliedAttrappe = async (userId, opt = {}) => {
        auftraege.push({ was: 'mitglied', userId, ...opt });
        return { userId, guildId: opt.guildId ?? null, trocken: false, ok: true, plugins: [
            { plugin: 'leveling', ok: true, geloescht: { a: 2 }, mitgeloescht: {}, anonymisiert: {}, bleibt: {}, nurUeberall: [], fehler: null },
        ] };
    };
    let guildErgebnis = { ok: true, abgeschaltet: [{ plugin: 'ticket', ok: true }], geloescht: { core: { guilds: 1, configs: 9 } }, fehler: null };
    const guildAttrappe = async (guildId, opt = {}) => {
        auftraege.push({ was: 'guild', guildId, ...opt });
        return { guildId, trocken: !!opt.trocken, ...guildErgebnis };
    };
    D.mitgliedLoeschen = mitgliedAttrappe;
    D.guildLoeschen = guildAttrappe;
    const sicher = () => {
        assert.strictEqual(D.mitgliedLoeschen, mitgliedAttrappe, 'mitgliedLoeschen ist nicht die Attrappe, abgebrochen');
        assert.strictEqual(D.guildLoeschen, guildAttrappe, 'guildLoeschen ist nicht die Attrappe, abgebrochen');
        assert.ok(!ServiceManager.has('pluginManager') || ServiceManager.get('pluginManager').__waechter, 'echter PluginManager registriert');
    };
    // _handleCoreEvent holt ihn am Anfang; abschalten darf er nie.
    ServiceManager.register('pluginManager', { __waechter: true, getPlugin: () => null, disableInGuild: () => { throw new Error('Wächter: nie abschalten'); } });

    const csrf = { n: 0 };
    attrappe('apps/dashboard/middlewares/security/csrf-protection.middleware.js', {
        csrfProtection: (req, res, next) => { csrf.n++; next(); },
    });
    const echteRechte = require(datei('apps/dashboard/middlewares/permissions.middleware.js'));
    attrappe('apps/dashboard/middlewares/permissions.middleware.js', {
        ...echteRechte,
        requirePermission: () => (req, res, next) => next(),
        requireGuildOwner: echteRechte.requireGuildOwner,
    });

    const MeineDaten = require(datei('apps/dashboard/helpers/MeineDaten.js'));
    const kontroll = String(process.env.CONTROL_GUILD_ID || '');
    let server;

    try {
        const [besitzer] = await db.query('SELECT owner_id FROM guilds WHERE _id = ?', [kontroll]);
        const userId = process.argv[2] || besitzer?.owner_id;
        assert.ok(/^\d{17,20}$/.test(String(userId || '')), 'kein Mitglied für die Probe (CONTROL_GUILD_ID gesetzt?)');

        // ── Zählung ────────────────────────────────────────────────────────
        console.log('\nZählung (echte Datenbank, nur lesend)');
        let ueb;
        let leereGuildSpalte = [];
        await pruefe(`Übersicht: je Guild + übergreifend = Auskunft über alles (${userId})`, async () => {
            ueb = await MeineDaten.uebersicht(userId);
            const gesamt = await echteAuskunft(userId);
            assert.deepStrictEqual(ueb.fehler, []);
            assert.ok(ueb.guilds.length > 0, 'Probe-Mitglied hat keine Guild mit Daten, die Probe sagt nichts');
            const soll = MeineDaten.zusammenzaehlen(gesamt.plugins).summe;
            assert.deepStrictEqual(ueb.summe, soll);
            const ist = { loeschen: 0, anonymisieren: 0, mitgeloescht: 0, bleibt: 0, ausgenommen: 0 };
            for (const teil of [...ueb.guilds, ueb.uebergreifend]) for (const k of Object.keys(ist)) ist[k] += teil.summe[k];
            assert.deepStrictEqual(ist, soll, 'Teile ergeben nicht das Ganze');
            assert.deepStrictEqual(ueb.guilds.map(g => g.guildId).sort(), [...gesamt.guilds].sort());
            // Unabhängig nachgerechnet: übergreifend ist, was keine Guild hat —
            // ganze Tabellen ohne Guild-Bezug UND Zeilen mit leerer Guild-Spalte.
            const nachJeGuild = {};
            for (const p of gesamt.plugins) for (const e of p.eintraege) {
                if (e.weg === 'mitgeloescht') continue;
                const n = e.bereich === 'uebergreifend' ? e.zeilen : (e.jeGuild?.uebergreifend || 0);
                const k = { loeschen: 'loeschen', anonymisieren: 'anonymisieren', frist: 'bleibt', ausgenommen: 'ausgenommen' }[e.weg];
                if (n) nachJeGuild[k] = (nachJeGuild[k] || 0) + n;
            }
            const istUeber = Object.fromEntries(Object.entries(ueb.uebergreifend.summe).filter(([k, n]) => n && k !== 'mitgeloescht'));
            assert.deepStrictEqual(istUeber, nachJeGuild, 'übergreifender Teil passt nicht zu jeGuild');
            leereGuildSpalte = gesamt.plugins.flatMap(p => p.eintraege.filter(e => e.bereich !== 'uebergreifend' && e.jeGuild?.uebergreifend)
                .map(e => `${e.tabelle}.${e.spalte} ${e.jeGuild.uebergreifend}`));
            const ohneName = ueb.guilds.filter(g => !g.name).map(g => g.guildId);
            assert.deepStrictEqual(ohneName, [], 'Guild ohne Namen (der Name ist die Bestätigung)');
            if (leereGuildSpalte.length) console.log(`      Zeilen ohne Guild in Guild-Tabellen (nur „überall“): ${leereGuildSpalte.join(', ')}`);
            console.log(`      ${ueb.guilds.length} Guild(s): ${ueb.guilds.map(g => `${g.name} ${g.summe.loeschen}/${g.summe.anonymisieren}/${g.summe.mitgeloescht}`).join(', ')}; übergreifend ${ueb.uebergreifend.summe.loeschen}/${ueb.uebergreifend.summe.anonymisieren}`);
        });
        await pruefe('fuerGuild (Befehl) zeigt dieselben Zahlen wie die Seite', async () => {
            const g = ueb.guilds[0];
            const f = await MeineDaten.fuerGuild(userId, g.guildId);
            assert.deepStrictEqual(f.hier.summe, g.summe);
            assert.deepStrictEqual(f.uebergreifend, ueb.uebergreifend);
            assert.strictEqual(f.andereGuilds, ueb.guilds.length - 1);
        });

        console.log('\nRückmeldung');
        await pruefe('je Plugin gezählt, Gescheitertes bleibt, Leeres fällt weg', async () => {
            const r = MeineDaten.rueckmeldung({ ok: false, guildId: null, plugins: [
                { plugin: 'a', ok: true, geloescht: { t1: 2, t2: 3 }, mitgeloescht: { k: 1 }, anonymisiert: { 't.s': 4 }, bleibt: {}, nurUeberall: [], fehler: null },
                { plugin: 'b', ok: true, geloescht: {}, mitgeloescht: {}, anonymisiert: {}, bleibt: {}, nurUeberall: [], fehler: null },
                { plugin: 'c', ok: false, geloescht: {}, mitgeloescht: {}, anonymisiert: {}, bleibt: {}, nurUeberall: [], fehler: 'vorher: Bot weg' },
                { plugin: 'd', ok: true, geloescht: {}, mitgeloescht: {}, anonymisiert: {}, bleibt: { 'm.x': { zeilen: 2, grund: 'Fall', tage: 365 } }, nurUeberall: ['u.v'], fehler: null },
            ] });
            assert.strictEqual(r.ok, false);
            assert.strictEqual(r.ueberall, true);
            assert.deepStrictEqual(r.plugins.map(p => p.plugin), ['a', 'c', 'd']);
            assert.deepStrictEqual([r.plugins[0].geloescht, r.plugins[0].mitgeloescht, r.plugins[0].anonymisiert], [5, 1, 4]);
            assert.strictEqual(r.plugins[1].fehler, 'vorher: Bot weg');
            assert.deepStrictEqual(r.plugins[2].bleibt, [{ was: 'm.x', zeilen: 2, grund: 'Fall', tage: 365 }]);
            assert.strictEqual(r.plugins[2].nurUeberall, 1);
            assert.strictEqual(MeineDaten.rueckmeldung({ ok: true, guildId: '1', plugins: [] }).ueberall, false);
        });

        // ── IPC ────────────────────────────────────────────────────────────
        console.log('\nIPC (Bot fragt das Dashboard)');
        const IPCServer = require(datei('apps/dashboard/helpers/IPCServer.js'));
        const ipc = (action, payload) => new Promise((fertig) =>
            IPCServer.prototype._handleCoreEvent.call({}, action, payload, { reply: fertig }));
        const befehl = fs.readFileSync(datei('apps/bot/commands/mydata.js'), 'utf8');
        await pruefe('jedes Ereignis, das der Befehl sendet, hat eine Stelle im Dashboard', async () => {
            const gesendet = [...new Set([...ohneKommentare(befehl).matchAll(/"core:([A-Z_]+)"/g)].map(m => m[1]))];
            assert.deepStrictEqual(gesendet.sort(), ['MEINEDATEN_AUSKUNFT', 'MEINEDATEN_EXPORT', 'MEINEDATEN_LOESCHEN']);
            for (const a of gesendet) {
                const r = await ipc(a, {});
                assert.ok(!/Unbekannte core-Aktion/.test(r.error || ''), `${a}: ${r.error}`);
            }
        });
        await pruefe('Auskunft und Export kommen an, ungültige IDs nicht', async () => {
            const g = ueb.guilds[0].guildId;
            const a = await ipc('MEINEDATEN_AUSKUNFT', { userId, guildId: g });
            assert.ok(a.success, a.error);
            assert.deepStrictEqual(a.data.hier.summe, ueb.guilds[0].summe);
            const e = await ipc('MEINEDATEN_EXPORT', { userId, guildId: g });
            assert.ok(e.success, e.error);
            assert.ok(e.data.plugins.some(p => p.zeilen && Object.keys(p.zeilen).length), 'Export ohne Zeilen');
            assert.strictEqual(e.data.guildNamen[g], ueb.guilds[0].name);
            assert.strictEqual((await ipc('MEINEDATEN_AUSKUNFT', { userId: 'x', guildId: g })).success, false);
            assert.strictEqual((await ipc('MEINEDATEN_LOESCHEN', { userId, guildId: '1 OR 1=1' })).success, false);
            assert.strictEqual(auftraege.length, 0, 'bei ungültiger ID wurde gelöscht');
        });
        await pruefe('Löschen: hier mit Guild, überall mit null, Rückmeldung je Plugin', async () => {
            sicher();
            const g = ueb.guilds[0].guildId;
            const h = await ipc('MEINEDATEN_LOESCHEN', { userId, guildId: g });
            const u = await ipc('MEINEDATEN_LOESCHEN', { userId, guildId: null });
            assert.deepStrictEqual(auftraege.map(a => [a.userId, a.guildId, a.anlass]), [[userId, g, '/mydata'], [userId, null, '/mydata']]);
            assert.strictEqual(h.data.ueberall, false);
            assert.strictEqual(u.data.ueberall, true);
            assert.deepStrictEqual(h.data.plugins[0], { plugin: 'leveling', ok: true, geloescht: 2, mitgeloescht: 0, anonymisiert: 0, bleibt: [], nurUeberall: 0, fehler: null });
            auftraege.length = 0;
        });

        // ── Seite und Einstellungen über Express ──────────────────────────
        const express = require('express');
        const gerendert = [];
        ServiceManager.register('themeManager', {
            renderView: async (res, view, daten) => { gerendert.push({ view, daten }); res.json({ view }); },
            getThemeForGuild: async () => 'default',
            getInstalledThemes: async () => [{ name: 'default', displayName: 'Standard' }],
        });
        ServiceManager.register('i18n', { languagesMeta: [] });
        const verlassen = [];
        let verlassenAntwort = { success: true, data: { success: true } };
        ServiceManager.register('ipcServer', {
            broadcastOne: async (event, payload) => {
                verlassen.push({ event, payload, nach: auftraege.filter(a => a.was === 'guild' && !a.trocken).length });
                return verlassenAntwort;
            },
            broadcast: async () => [],
        });
        const app = express();
        app.use(express.json());
        let zerstoert = 0;
        app.use((req, res, next) => {
            const id = req.headers['x-user'];
            req.session = id ? {
                user: { info: { id, username: req.headers['x-name'] || 'probe' } },
                destroy(fertig) { zerstoert++; fertig(); },
            } : {};
            next();
        });
        app.use('/meinedaten', require(datei('apps/dashboard/routes/meinedaten.router.js')));
        app.use('/guild/:guildId/settings', (req, res, next) => { res.locals.guildId = req.params.guildId; next(); },
            require(datei('apps/dashboard/routes/guild/settings.router.js')));
        server = http.createServer(app).listen(0, '127.0.0.1');
        await new Promise((r) => server.once('listening', r));
        const basis = `http://127.0.0.1:${server.address().port}`;
        const kopf = (id, extra = {}) => ({ 'x-user': id, 'Content-Type': 'application/json', Accept: 'application/json', ...extra });
        const post = (pfad, id, koerper, extra) => { sicher(); return fetch(basis + pfad, { method: 'POST', headers: kopf(id, extra), body: JSON.stringify(koerper) }); };

        console.log('\nSeite „Meine Daten“');
        await pruefe('Ansicht bekommt die Übersicht des Angemeldeten', async () => {
            const r = await fetch(basis + '/meinedaten', { headers: kopf(userId) });
            assert.strictEqual(r.status, 200);
            const g = gerendert.pop();
            assert.strictEqual(g.view, 'auth/meine-daten');
            assert.deepStrictEqual(g.daten.daten.summe, ueb.summe);
        });
        await pruefe('Export als Datei, ungültige Guild abgewiesen', async () => {
            const g = ueb.guilds[0].guildId;
            const r = await fetch(basis + `/meinedaten/export?guild=${g}`, { headers: kopf(userId) });
            assert.strictEqual(r.status, 200);
            assert.match(r.headers.get('content-disposition') || '', new RegExp(`attachment; filename="meine-daten-${g}\\.json"`));
            const j = await r.json();
            assert.strictEqual(j.userId, String(userId));
            assert.strictEqual((await fetch(basis + '/meinedaten/export?guild=abc', { headers: kopf(userId) })).status, 400);
        });
        await pruefe('Löschen: falscher Name löscht nichts, die ID kommt aus der Sitzung, CSRF läuft', async () => {
            const g = ueb.guilds[0];
            const vorher = csrf.n;
            let r = await post('/meinedaten/loeschen', userId, { guildId: g.guildId, bestaetigung: 'falsch' });
            assert.strictEqual(r.status, 400);
            assert.strictEqual(auftraege.length, 0);
            r = await post('/meinedaten/loeschen', userId, { guildId: g.guildId, bestaetigung: ` ${g.name.toUpperCase()} `, userId: '123456789012345678' });
            assert.strictEqual(r.status, 200, await r.clone().text());
            assert.deepStrictEqual(auftraege.map(a => [a.userId, a.guildId]), [[String(userId), g.guildId]]);
            assert.strictEqual(csrf.n - vorher, 2, 'csrfProtection läuft nicht vor dem Löschen');
            assert.strictEqual(zerstoert, 0, 'Sitzung beendet, obwohl nur in einer Guild gelöscht');
            auftraege.length = 0;
        });
        await pruefe('überall: Bestätigung ist der eigene Name, die Sitzung endet', async () => {
            let r = await post('/meinedaten/loeschen', userId, { guildId: 'alle', bestaetigung: ueb.guilds[0].name }, { 'x-name': 'ich' });
            assert.strictEqual(r.status, 400);
            r = await post('/meinedaten/loeschen', userId, { guildId: 'alle', bestaetigung: 'Ich' }, { 'x-name': 'ich' });
            const j = await r.json();
            assert.strictEqual(r.status, 200);
            assert.deepStrictEqual(auftraege.map(a => a.guildId), [null]);
            assert.strictEqual(j.abgemeldet, true);
            assert.strictEqual(zerstoert, 1);
            auftraege.length = 0;
        });
        await pruefe('Ansichten rendern in beiden Sprachen, jeder Text vorhanden, Namen escaped', async () => {
            const ejs = require('ejs');
            for (const sprache of ['de-DE', 'en-GB']) {
                const quelle = {
                    '': JSON.parse(fs.readFileSync(datei(`apps/dashboard/locales/${sprache}.json`), 'utf8')),
                    core: JSON.parse(fs.readFileSync(datei(`plugins/core/dashboard/locales/${sprache}.json`), 'utf8')),
                };
                const tr = (k, w = {}) => {
                    const [ns, rest] = k.includes(':') ? k.split(':') : ['', k];
                    let o = quelle[ns];
                    for (const t of rest.split('.')) o = o?.[t];
                    if (typeof o !== 'string') throw new Error(`${sprache}: ${k} fehlt`);
                    return o.replace(/\{\{(\w+)\}\}/g, (m, n) => (n in w ? w[n] : m));
                };
                const seite = await ejs.renderFile(datei('apps/dashboard/themes/default/views/auth/meine-daten.ejs'),
                    { tr, daten: ueb, fehler: null, benutzername: 'probe' });
                for (const g of ueb.guilds) assert.ok(seite.includes(`/meinedaten/export?guild=${g.guildId}`), `${g.name}: Export fehlt`);
                const ziel = ueb.guilds.find(g => g.summe.loeschen + g.summe.anonymisieren + g.summe.mitgeloescht > 0);
                assert.ok(seite.includes(`data-loeschen="${ziel.guildId}"`), 'Löschknopf fehlt');
                const allgemein = { tr, guildId: '1', settings: {}, languagesMeta: [], aktivesTheme: 'x' };
                const mit = await ejs.renderFile(datei('apps/dashboard/themes/default/views/guild/settings/general.ejs'),
                    { ...allgemein, guildLoeschen: { name: 'A "B" <c>' } });
                assert.ok(mit.includes('id="guildLoeschenModal"') && mit.includes('A &#34;B&#34; &lt;c&gt;'), 'Karte fehlt oder Name nicht escaped');
                const ohne = await ejs.renderFile(datei('apps/dashboard/themes/default/views/guild/settings/general.ejs'), allgemein);
                assert.ok(!ohne.includes('guildLoeschenModal'), 'Karte ohne guildLoeschen sichtbar');
            }
        });
        await pruefe('ohne Anmeldung kein Zugang über app.js (auth: true)', async () => {
            assert.ok(meinedatenEingehaengt(fs.readFileSync(datei('apps/dashboard/app.js'), 'utf8')), 'app.js hängt /meinedaten nicht mit auth: true ein');
        });

        console.log('\nServer löschen (Einstellungen → Allgemein)');
        const [eigene] = await db.query('SELECT _id, guild_name FROM guilds WHERE owner_id = ? AND _id <> ? ORDER BY _id LIMIT 1', [userId, kontroll]);
        const [fremde] = await db.query('SELECT _id, owner_id FROM guilds WHERE owner_id <> ? LIMIT 1', [userId]);
        await pruefe('Karte nur für den Besitzer, nie in der Kontroll-Guild', async () => {
            assert.ok(eigene, 'Probe-Mitglied besitzt keine Guild außer der Kontroll-Guild');
            await fetch(basis + `/guild/${eigene._id}/settings/general`, { headers: kopf(userId) });
            assert.deepStrictEqual(gerendert.pop().daten.guildLoeschen, { name: eigene.guild_name });
            await fetch(basis + `/guild/${kontroll}/settings/general`, { headers: kopf(userId) });
            assert.strictEqual(gerendert.pop().daten.guildLoeschen, null, 'Kontroll-Guild zeigt die Karte');
            if (fremde) {
                await fetch(basis + `/guild/${fremde._id}/settings/general`, { headers: kopf(userId) });
                assert.strictEqual(gerendert.pop().daten.guildLoeschen, null, 'Nicht-Besitzer sieht die Karte');
            }
        });
        await pruefe('Probe zählt nur (trocken), Nicht-Besitzer und Kontroll-Guild abgewiesen', async () => {
            sicher();
            let r = await fetch(basis + `/guild/${eigene._id}/settings/general/loeschen-probe`, { headers: kopf(userId) });
            assert.strictEqual(r.status, 200, await r.clone().text());
            const j = await r.json();
            assert.deepStrictEqual(j.data.zeilen, { core: 10 });
            assert.deepStrictEqual(auftraege.map(a => [a.guildId, a.trocken]), [[String(eigene._id), true]]);
            auftraege.length = 0;
            r = await fetch(basis + `/guild/${eigene._id}/settings/general/loeschen-probe`, { headers: kopf('123456789012345678') });
            assert.strictEqual(r.status, 403);
            r = await fetch(basis + `/guild/${kontroll}/settings/general/loeschen-probe`, { headers: kopf(userId) });
            assert.strictEqual(r.status, 400);
            assert.strictEqual(auftraege.length, 0);
        });
        await pruefe('Löschen: Name, CSRF, Besitzer; erst löschen, dann verlässt der Bot', async () => {
            const pfad = `/guild/${eigene._id}/settings/general/loeschen`;
            const vorher = csrf.n;
            let r = await post(pfad, userId, { bestaetigung: 'falsch' });
            assert.strictEqual(r.status, 400);
            r = await post(pfad, '123456789012345678', { bestaetigung: eigene.guild_name });
            assert.strictEqual(r.status, 403);
            assert.strictEqual(auftraege.length + verlassen.length, 0, 'ohne Recht gelöscht');
            r = await post(pfad, userId, { bestaetigung: eigene.guild_name });
            const j = await r.json();
            assert.strictEqual(r.status, 200, JSON.stringify(j));
            assert.ok(csrf.n - vorher >= 3, 'csrfProtection läuft nicht vor dem Löschen');
            assert.deepStrictEqual(auftraege.map(a => [a.guildId, !!a.trocken, a.wer.userId]), [[String(eigene._id), false, String(userId)]]);
            assert.deepStrictEqual(verlassen.map(v => [v.event, v.payload.guildId, v.nach]), [['dashboard:GUILD_VERLASSEN', String(eigene._id), 1]]);
            assert.deepStrictEqual(j.data, { abgeschaltet: ['ticket'], zeilen: 10, verlassen: true, verlassenFehler: null });
            auftraege.length = 0; verlassen.length = 0;
        });
        await pruefe('Abbruch beim Abschalten: der Bot bleibt; Bot geht nicht: ehrlich gemeldet', async () => {
            const pfad = `/guild/${eigene._id}/settings/general/loeschen`;
            guildErgebnis = { ok: false, abgeschaltet: [{ plugin: 'gameserver', ok: false, fehler: 'Daemon weg' }], geloescht: {}, fehler: 'gameserver: Daemon weg' };
            let r = await post(pfad, userId, { bestaetigung: eigene.guild_name });
            assert.strictEqual(r.status, 500);
            assert.match((await r.json()).message, /Daemon weg/);
            assert.strictEqual(verlassen.length, 0, 'Bot verlässt die Guild trotz Abbruch');
            guildErgebnis = { ok: true, abgeschaltet: [], geloescht: {}, fehler: null };
            verlassenAntwort = { success: true, data: { success: false, error: 'Missing Permissions' } };
            r = await post(pfad, userId, { bestaetigung: eigene.guild_name });
            const j = await r.json();
            assert.deepStrictEqual([j.data.verlassen, j.data.verlassenFehler], [false, 'Missing Permissions']);
            auftraege.length = 0; verlassen.length = 0;
        });

        // ── Bot ────────────────────────────────────────────────────────────
        console.log('\nBot');
        const GUILD_VERLASSEN = require(datei('apps/bot/ipc/GUILD_VERLASSEN.js'));
        await pruefe('GUILD_VERLASSEN: verlässt die Guild, nie die Kontroll-Guild', async () => {
            const gegangen = [];
            const client = { guilds: { cache: new Map([[kontroll, { leave: async () => gegangen.push(kontroll) }], ['111111111111111111', { leave: async () => gegangen.push('1') }]]) } };
            assert.strictEqual((await GUILD_VERLASSEN({ guildId: kontroll }, client)).success, false);
            assert.strictEqual((await GUILD_VERLASSEN({ guildId: '222222222222222222' }, client)).success, false);
            assert.strictEqual((await GUILD_VERLASSEN({ guildId: '111111111111111111' }, client)).success, true);
            assert.deepStrictEqual(gegangen, ['1']);
        });
        await pruefe('Befehl: Auskunft, Datei, falscher Name, hier und überall', async () => {
            const meinedaten = require(datei('apps/bot/commands/mydata.js'));
            assert.strictEqual(meinedaten.name, 'mydata', 'Befehlsnamen sind englisch (Betreiber 2026-11-13)');
            assert.strictEqual(meinedaten.command.enabled, false, 'Präfix-Fassung hätte kein Bestätigungsfenster');
            assert.ok(!meinedaten.userPermissions?.length, 'jedes Mitglied muss fragen dürfen');
            assert.ok(Array.isArray(meinedaten.slashCommand.options), '/help mydata liest slashCommand.options');
            const gesendet = [];
            const daten = {
                hier: { plugins: [{ plugin: 'leveling', loeschen: 3, anonymisieren: 0, mitgeloescht: 0, bleibt: [], ausgenommen: [] }], summe: { loeschen: 3, anonymisieren: 0, mitgeloescht: 0, bleibt: 0, ausgenommen: 0 } },
                andereGuilds: 2, uebergreifend: { plugins: [], summe: { loeschen: 0, anonymisieren: 0, mitgeloescht: 0, bleibt: 0, ausgenommen: 0 } }, fehler: [],
            };
            ServiceManager.register('ipcClient', { sendToDashboard: async (event, payload) => {
                gesendet.push({ event, payload });
                if (event === 'core:MEINEDATEN_AUSKUNFT') return { success: true, data: daten };
                if (event === 'core:MEINEDATEN_EXPORT') return { success: true, data: { userId: payload.userId, plugins: [] } };
                return { success: true, data: { ok: true, ueberall: payload.guildId == null, plugins: [{ plugin: 'leveling', ok: true, geloescht: 3, mitgeloescht: 0, anonymisiert: 0, bleibt: [], nurUeberall: 0, fehler: null }] } };
            } });
            const user = { id: '444444444444444444', username: 'probe' };
            let ausgabe = [];
            /** Ein Knopfdruck; `name` ist, was ins Fenster getippt wird (null = Fenster läuft ab). */
            const klick = (customId, name) => () => ({
                customId, id: 'k' + Math.random(), user,
                deferReply: async () => {}, editReply: async (x) => { ausgabe.push({ export: x }); },
                showModal: async (m) => { ausgabe.push({ modal: m.data.custom_id }); },
                awaitModalSubmit: async () => {
                    if (name == null) throw new Error('Zeit');
                    return {
                        fields: { getTextInputValue: () => name },
                        reply: async (x) => { ausgabe.push({ falsch: x.content }); },
                        update: async (x) => { ausgabe.push({ update: x }); },
                    };
                },
            });
            const lauf = async (klicks) => {
                ausgabe = [];
                const guild = { id: '333333333333333333', name: 'Testguild', getT: (k, w) => `${k}${w ? JSON.stringify(w) : ''}` };
                const nachricht = { awaitMessageComponent: async () => { const k = klicks.shift(); if (!k) throw new Error('Zeit'); return k(); } };
                const interaction = { guild, user, editReply: async (x) => { ausgabe.push({ antwort: x }); return nachricht; } };
                await meinedaten.interactionRun({ interaction });
                return ausgabe;
            };
            // Ablauf 1: Datei, falscher Name, Fenster läuft ab, dann hier löschen.
            const a1 = await lauf([klick('mydata-export'), klick('mydata-hier', 'Falsch'),
                klick('mydata-hier', null), klick('mydata-hier', ' testGUILD ')]);
            assert.ok(a1.some(a => a.export?.files?.length === 1), 'keine Datei beim Export');
            assert.ok(a1.some(a => /FENSTER_FALSCH/.test(a.falsch || '')), 'falscher Name nicht gemeldet');
            const knoepfe = JSON.stringify(a1[0].antwort.components);
            assert.ok(/mydata-hier/.test(knoepfe) && /mydata-ueberall/.test(knoepfe), 'Knöpfe fehlen: ' + knoepfe);
            assert.match(JSON.stringify(a1[0].antwort.embeds[0].data), /ANDERE_GUILDS\{\\"n\\":2\}/);
            const loesch = gesendet.filter(g => g.event === 'core:MEINEDATEN_LOESCHEN');
            assert.deepStrictEqual(loesch.map(g => [g.payload.userId, g.payload.guildId]), [['444444444444444444', '333333333333333333']]);
            assert.match(JSON.stringify(a1.at(-1).antwort.embeds[0].data), /ERG_TITEL_OK/);
            // Ablauf 2: überall, bestätigt mit dem eigenen Namen, nicht dem der Guild.
            gesendet.length = 0;
            await lauf([klick('mydata-ueberall', 'Testguild'), klick('mydata-ueberall', 'PROBE')]);
            assert.deepStrictEqual(gesendet.filter(g => g.event === 'core:MEINEDATEN_LOESCHEN').map(g => g.payload.guildId), [null]);
            // Ablauf 3: niemand klickt → Knöpfe weg, nichts gelöscht.
            gesendet.length = 0;
            const a3 = await lauf([]);
            assert.deepStrictEqual(a3.at(-1).antwort, { components: [] });
            assert.strictEqual(gesendet.filter(g => g.event === 'core:MEINEDATEN_LOESCHEN').length, 0);
        });

        // ── Gegenproben ────────────────────────────────────────────────────
        console.log('\nGegenproben');
        await pruefe('app.js ohne auth: true → erkannt', async () => {
            const text = ohneKommentare(fs.readFileSync(datei('apps/dashboard/app.js'), 'utf8'));
            assert.ok(!meinedatenEingehaengt(text.replace("require('./routes/meinedaten.router'), { auth: true })", "require('./routes/meinedaten.router'))")));
            assert.ok(!meinedatenEingehaengt(text.replace(".register('/meinedaten'", "// .register('/meinedaten'")));
        });
        await pruefe('nur Tabellen ohne Guild-Bezug als übergreifend → erkannt', async () => {
            if (!leereGuildSpalte.length) { console.log('      (keine Zeilen ohne Guild, Gegenprobe sagt heute nichts)'); return; }
            const gesamt = await echteAuskunft(userId);
            const naiv = MeineDaten.zusammenzaehlen(gesamt.plugins, e => e.bereich === 'uebergreifend').summe;
            assert.notDeepStrictEqual(naiv, ueb.uebergreifend.summe, 'die alte Zählung wäre nicht aufgefallen');
        });
        await pruefe('Rest: was keine Guild nimmt, bleibt übrig', async () => {
            const g = { plugins: [{ plugin: 'a', loeschen: 5, anonymisieren: 2, mitgeloescht: 1, bleibt: [{ was: 't.s', zeilen: 3, grund: 'x' }], ausgenommen: [] }] };
            const teile = [{ plugins: [{ plugin: 'a', loeschen: 4, anonymisieren: 2, mitgeloescht: 1, bleibt: [{ was: 't.s', zeilen: 1, grund: 'x' }], ausgenommen: [] }] }];
            const r = MeineDaten.rest(g, teile);
            assert.deepStrictEqual(r.summe, { loeschen: 1, anonymisieren: 0, mitgeloescht: 0, bleibt: 2, ausgenommen: 0 });
            assert.deepStrictEqual(MeineDaten.rest(g, [g]).plugins, []);
        });
    } finally {
        if (server) server.close();
        await db.pool.end();
    }

    console.log(fehler ? `\n✗ ${fehler} Prüfung(en) rot` : '\n✅ Befehl, Seite und Server löschen führen zu Datenauskunft, mit Namen und Rückmeldung');
    process.exit(fehler ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
