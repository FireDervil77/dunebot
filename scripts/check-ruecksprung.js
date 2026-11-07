#!/usr/bin/env node
/**
 * OAuth-Rücksprünge: Der `state` gehört der Sitzung (Kassensturz K034, 2026-11-07).
 *
 * Gemessen vor dem Umbau: Die Discord-Anmeldung schickte keinen `state` und
 * nahm jeden Code an (Login-CSRF). `CheckAuth` schrieb je Aufruf ohne
 * Anmeldung eine Zeile in `states`, die niemand las (739 seit 2026-08-06).
 * Die Verknüpfungen nutzten einen Datenbank-State, gebunden an niemanden.
 * Seitdem ein Weg für alle: `apps/dashboard/helpers/Ruecksprung.js`.
 *
 *   Helfer      an die Sitzung gebunden, befristet, einmal, Zweck passt,
 *               Kennzeichen teilen nur auf Wunsch; Ziele nur auf eigener Seite
 *   Anmeldung   der echte login() legt den Vorgang an und schickt den
 *               `state` an Discord; der echte callback() weist jeden
 *               Rücksprung ab, der nicht zu dieser Sitzung gehört, bevor er
 *               Discord fragt
 *   CheckAuth   schickt mit Ziel zum Login und schreibt nichts in die Datenbank
 *   Rest        `states`, saveState/getState/deleteState und das Model sind
 *               weg, die Migration entfernt die Tabelle
 *
 * Einladung und Verknüpfungen prüfen check-willkommen, check-anlagenkonten
 * und check-verbindungs-zusagen.
 *
 *   node scripts/check-ruecksprung.js
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const WURZEL = path.join(__dirname, '..');
const { ServiceManager } = require('dunebot-core');
const { ohneKommentare } = require('./lib/quelltext');
const Ruecksprung = require('../apps/dashboard/helpers/Ruecksprung');

let fehler = 0;
async function pruefe(was, tun) {
    try { await tun(); console.log(`  ✓ ${was}`); }
    catch (e) { fehler++; console.log(`  ✗ ${was}\n      ${String(e.message).split('\n').slice(0, 6).join('\n      ')}`); }
}
const lies = (rel) => fs.readFileSync(path.join(WURZEL, rel), 'utf8');

/** Alle .js unter einem Ordner, ohne node_modules und Browser-Dateien. */
function quellen(ordner, liste = []) {
    for (const e of fs.readdirSync(path.join(WURZEL, ordner), { withFileTypes: true })) {
        if (['node_modules', 'public', 'assets', 'vendor'].includes(e.name)) continue;
        const rel = path.join(ordner, e.name);
        if (e.isDirectory()) quellen(rel, liste);
        else if (e.name.endsWith('.js')) liste.push(rel);
    }
    return liste;
}

(async () => {
    console.log('\nOAuth-Rücksprung an der Sitzung (K034)');

    await pruefe('Helfer: gültig nur in derselben Sitzung, einmal, mit den Daten vom Start', async () => {
        const req = { session: {} };
        const state = Ruecksprung.beginne(req, 'anmeldung', { daten: { ziel: '/admin' }, fristMs: 60000 });
        assert.match(state, /^anmeldung:[0-9a-f]{32}$/);
        assert.strictEqual(Ruecksprung.zweckVon(state), 'anmeldung');
        assert.deepStrictEqual(Ruecksprung.pruefe({ session: {} }, 'anmeldung', state).grund, 'kein_vorgang', 'fremde Sitzung');
        const v = Ruecksprung.pruefe(req, 'anmeldung', state);
        assert.deepStrictEqual([v.gueltig, v.daten], [true, { ziel: '/admin' }]);
        assert.strictEqual(Ruecksprung.pruefe(req, 'anmeldung', state).grund, 'kein_vorgang', 'zweimal gültig');
    });

    await pruefe('Helfer: falsches Kennzeichen, abgelaufen, falscher Zweck, ohne state — und jeder Fehlversuch verbraucht', async () => {
        const neu = (frist = 60000) => { const req = { session: {} }; return [req, Ruecksprung.beginne(req, 'verbindung.twitch', { fristMs: frist })]; };
        let [req, state] = neu();
        assert.strictEqual(Ruecksprung.pruefe(req, 'verbindung.twitch', 'verbindung.twitch:' + '0'.repeat(32)).grund, 'kennzeichen_falsch');
        assert.strictEqual(Ruecksprung.pruefe(req, 'verbindung.twitch', state).grund, 'kein_vorgang', 'der Fehlversuch hat nicht verbraucht');
        [req, state] = neu();
        req.session.ruecksprung['verbindung.twitch'].zeit -= 60001;
        assert.strictEqual(Ruecksprung.pruefe(req, 'verbindung.twitch', state).grund, 'abgelaufen');
        [req, state] = neu();
        assert.strictEqual(Ruecksprung.pruefe(req, 'verbindung.kick', state).grund, 'fremder_zweck');
        assert.strictEqual(Ruecksprung.pruefe(req, 'verbindung.twitch', '').grund, 'ohne_state');
        assert.throws(() => Ruecksprung.beginne({ session: {} }, 'Böse:Sache', { fristMs: 1 }), /ungültiger Zweck/);
        assert.throws(() => Ruecksprung.beginne({}, 'anmeldung', { fristMs: 1 }), /keine Sitzung/);
        assert.throws(() => Ruecksprung.beginne({ session: {} }, 'anmeldung', {}), /Frist fehlt/);
    });

    await pruefe('Helfer: teilen behält das Kennzeichen, solange es frisch ist, sonst ein neues', async () => {
        const req = { session: {} };
        const a = Ruecksprung.beginne(req, 'einladung', { fristMs: 60000, teilen: true });
        const b = Ruecksprung.beginne(req, 'einladung', { fristMs: 60000, teilen: true });
        assert.strictEqual(a, b);
        assert.notStrictEqual(Ruecksprung.beginne(req, 'einladung', { fristMs: 60000 }), b, 'ohne teilen dasselbe');
        req.session.ruecksprung.einladung.zeit -= 60001;
        assert.notStrictEqual(Ruecksprung.beginne(req, 'einladung', { fristMs: 60000, teilen: true }), b, 'abgelaufenes geteilt');
    });

    await pruefe('Helfer: Ziele nur auf eigener Seite, nichts unter /auth/', async () => {
        const z = Ruecksprung.eigenesZiel;
        assert.deepStrictEqual(['/guild/1/plugins', '/admin/users?seite=2', '/kb/a/b'].map(z), ['/guild/1/plugins', '/admin/users?seite=2', '/kb/a/b']);
        assert.deepStrictEqual(['https://fremd.de', '//fremd.de', '/\\fremd.de', '/ab\ncd', 'guild', '', null, undefined,
            '/auth/logout', '/auth', '/auth?x=1', '/' + 'a'.repeat(600)].map(z), Array(12).fill(null));
    });

    // ── Die echte Anmeldung ──────────────────────────────────────────────
    const still = () => {};
    let gerendert = null, datenbank = [];
    ServiceManager.register('Logger', { debug: still, info: still, warn: still, error: still, success: still });
    ServiceManager.register('themeManager', {
        renderView: async (res, ansicht, daten) => { gerendert = { ansicht, daten }; },
        getLayout: () => 'layouts/auth',
    });
    ServiceManager.register('dbService', { query: async (sql) => { datenbank.push(sql); return []; } });
    ServiceManager.register('pluginManager', {});
    const auth = require('../apps/dashboard/controllers/auth.controller');
    const antwort = () => { const r = { ziel: null, redirect(z) { r.ziel = z; }, locals: {} }; return r; };

    await pruefe('login(): legt den Vorgang mit Ziel an und schickt den state an Discord', async () => {
        const req = { session: {}, query: { redirect: '/admin/users', direct: 'true' } };
        const res = antwort();
        await auth.login(req, res);
        const url = new URL(res.ziel);
        assert.strictEqual(url.origin + url.pathname, 'https://discord.com/api/oauth2/authorize');
        const state = url.searchParams.get('state');
        assert.match(String(state), /^anmeldung:[0-9a-f]{32}$/, 'kein state an Discord');
        assert.deepStrictEqual(req.session.ruecksprung.anmeldung.daten, { ziel: '/admin/users' });

        const fremd = { session: {}, query: { redirect: 'https://fremd.de/x' } };
        await auth.login(fremd, antwort());
        assert.strictEqual(fremd.session.ruecksprung.anmeldung.daten.ziel, '/auth/server-selector');
        assert.match(gerendert.daten.discordAuthURL, /&state=anmeldung%3A[0-9a-f]{32}$/, 'die Anmeldeseite verlinkt ohne state');
    });

    await pruefe('callback(): weist jeden Rücksprung ab, der nicht zu dieser Sitzung gehört, bevor Discord gefragt wird', async () => {
        const axios = require('axios');
        const echt = axios.post;
        let gefragt = 0;
        axios.post = async () => { gefragt++; throw new Error('darf nicht laufen'); };
        try {
            const fall = async (session, query) => {
                const res = antwort();
                await auth.callback({ session, query }, res);
                return res.ziel;
            };
            const req = { session: {}, query: {} };
            const state = Ruecksprung.beginne(req, 'anmeldung', { daten: { ziel: '/admin' }, fristMs: 60000 });
            assert.strictEqual(await fall({}, { code: 'x' }), '/auth/login?error=state', 'ohne state angenommen');
            assert.strictEqual(await fall({}, { code: 'x', state }), '/auth/login?error=state', 'fremde Sitzung angenommen');
            assert.strictEqual(await fall(req.session, { code: 'x', state: 'anmeldung:' + 'f'.repeat(32) }), '/auth/login?error=state');
            assert.strictEqual(await fall(req.session, { code: 'x', state }), '/auth/login?error=state', 'nach dem Fehlversuch noch gültig');
            assert.strictEqual(gefragt, 0, 'Discord wurde trotzdem gefragt');
        } finally { axios.post = echt; }
    });

    await pruefe('CheckAuth: ohne Anmeldung zum Login mit Ziel, nichts in die Datenbank', async () => {
        datenbank = [];
        const { CheckAuth } = require('../apps/dashboard/middlewares/auth.middleware');
        const res = antwort();
        let weiter = 0;
        await CheckAuth({ session: {}, originalUrl: '/guild/123/plugins?x=1' }, res, () => { weiter++; });
        assert.strictEqual(res.ziel, '/auth/login?redirect=%2Fguild%2F123%2Fplugins%3Fx%3D1');
        assert.deepStrictEqual([weiter, datenbank], [0, []]);
    });

    await pruefe('Rest: kein saveState/getState/deleteState, kein Model State, die Migration entfernt states', async () => {
        const treffer = [];
        for (const d of [...quellen('apps'), ...quellen('packages'), ...quellen('plugins')]) {
            if (/\.(saveState|getState|deleteState)\(|async (saveState|getState|deleteState)\(/.test(ohneKommentare(lies(d)))) treffer.push(d);
        }
        assert.deepStrictEqual(treffer, []);
        assert.ok(!fs.existsSync(path.join(WURZEL, 'packages/dunebot-db-client/models/State.js')), 'Model State ist noch da');
        assert.doesNotMatch(ohneKommentare(lies('packages/dunebot-db-client/models/index.js')), /State/);
        const migration = require('../migrations/kern/20261107_120000_states_entfernen');
        const gelaufen = [];
        await migration.up({ query: async (sql) => { gelaufen.push(sql); } });
        assert.deepStrictEqual(gelaufen, ['DROP TABLE IF EXISTS states']);
    });

    console.log(fehler ? `\n✗ ${fehler} Prüfung(en) rot` : '\n✅ Jeder OAuth-Rücksprung gehört zu einem Vorgang dieser Sitzung');
    process.exit(fehler ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
