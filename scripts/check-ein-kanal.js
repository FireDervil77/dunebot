#!/usr/bin/env node
/**
 * Eine Seite, ein Kanal (Baustelle 217, 2026-11-02).
 *
 * Live-Anzeige, Serverseite, Konsole und Übersicht öffneten je einen eigenen
 * EventSource auf `/servers/events`, eine Serverseite also drei. Alle Tabs eines
 * Browsers teilen sich eine HTTP/2-Verbindung: Drei Tabs mit 14 Kanälen ließen
 * das Panel für diesen Browser stehen, während es für alle anderen antwortete.
 *
 * Geprüft wird das Verhalten am echten Code, in einer VM mit nachgebautem
 * EventSource, und dass niemand neben `fuerSeite` einen Kanal öffnet:
 *
 *   - Alle Nutzer einer Seite teilen einen Kanal, auch nach neuem `setupSSE`.
 *   - Zuhörer überleben eine Neuverbindung, und die Konsole lässt den Kanal offen.
 *   - `fuerServer` lässt nur den eigenen Server durch, wie vorher `?server_id=`.
 *   - Nach einem Dashboard-Neustart verbindet sich der Kanal neu, ohne Grenze.
 *   - Ein verdeckter Tab gibt den Kanal nach der Frist frei, für jede Seite
 *     (K256, 2026-11-08); beim Sichtbarwerden holen Live-Anzeige, Übersicht und
 *     Konsole nach, was in der Lücke kam.
 *   - `connected` erreicht auch die `on()`-Handler, mit `wieder` ab dem zweiten Mal.
 *
 * Nichts wird geschrieben.
 *
 *   node scripts/check-ein-kanal.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const { ohneKommentare } = require('./lib/quelltext');

const WURZEL = path.join(__dirname, '..');
const JS = path.join(WURZEL, 'plugins/gameserver/dashboard/assets/js');
const lies = (datei) => fs.readFileSync(path.join(JS, datei), 'utf8');

let fehler = 0;
async function pruefe(was, tun) {
    try { await tun(); console.log(`  ✓ ${was}`); }
    catch (e) { fehler++; console.log(`  ✗ ${was}\n      ${String(e.message).split('\n').join('\n      ')}`); }
}

function seite() {
    const quellen = [];
    const zeitgeber = [];
    const still = () => {};
    const horcherAmDokument = {};
    const abrufe = [];
    let nummer = 0;
    const k = {
        console: { log: still, warn: still, debug: still, error: still },
        JSON, Math, String, Number, Promise, Map, Set, Array, Object,
        setTimeout: (fn, ms) => { nummer++; zeitgeber.push({ fn, ms: ms || 0, nummer }); return nummer; },
        clearTimeout: (n) => { const i = zeitgeber.findIndex(z => z.nummer === n); if (i >= 0) zeitgeber.splice(i, 1); },
        document: {
            hidden: false,
            addEventListener: (art, fn) => { (horcherAmDokument[art] = horcherAmDokument[art] || []).push(fn); },
        },
        fetch: (url, opt) => {
            abrufe.push({ url, body: opt && opt.body });
            const antwort = /\/attach$/.test(url)
                ? { success: true, verbunden: true, client_id: 'neu', history: ['eins', 'zwei'] }
                : { success: true };
            return Promise.resolve({ ok: true, json: () => Promise.resolve(antwort) });
        },
        EventSource: class {
            constructor(url) { this.url = url; this.horcher = {}; this.zu = false; quellen.push(this); }
            addEventListener(art, fn) { (this.horcher[art] = this.horcher[art] || []).push(fn); }
            close() { this.zu = true; }
        },
    };
    k.window = k;
    vm.createContext(k);
    vm.runInContext(`${lies('gameserver-sse.js')}\nthis.GameserverSSEClient = GameserverSSEClient;`, k);
    const sende = (q, art, nutzlast) => (q.horcher[art] || []).forEach(fn => fn({ data: JSON.stringify(nutzlast) }));
    // Laeuft alle Zeitgeber bis `bisMs` (Vorgabe: alle).
    const laufe = (bisMs = Infinity) => {
        const z = zeitgeber.filter(t => t.ms <= bisMs);
        for (const t of z) zeitgeber.splice(zeitgeber.indexOf(t), 1);
        z.forEach(t => t.fn());
    };
    const sicht = (verdeckt) => {
        k.document.hidden = verdeckt;
        (horcherAmDokument.visibilitychange || []).forEach(fn => fn());
    };
    return { k, quellen, sende, laufe, sicht, zeitgeber, abrufe, horcherAmDokument };
}

function konsole(s) {
    vm.runInContext(`${lies('console-client.js')}\nthis.GameserverConsoleClient = GameserverConsoleClient;`, s.k);
    const still = () => {};
    const c = Object.create(s.k.GameserverConsoleClient.prototype);
    c.config = { apiBase: '/x', guildId: 'g', serverId: '216' };
    c.zeilen = [];
    c.terminal = { writeln: (z) => c.geschrieben.push(z), write: still, refresh: still, scrollToBottom: still,
        reset: () => { c.geschrieben = []; c.zurueckgesetzt++; }, rows: 24 };
    c.geschrieben = [];
    c.zurueckgesetzt = 0;
    c.colorizeLogLine = (z) => z;
    c.fitAddon = { fit: still };
    c.connected = true;
    c.updateStatus = (text) => { c.status = text; };
    c.handleOutputLine = (zeile) => c.zeilen.push(zeile);
    return c;
}

(async () => {
    console.log('Quelltext');
    await pruefe('nur der Client öffnet `/servers/events`, gebaut wird er nur in `fuerSeite`', () => {
        const ordner = path.join(WURZEL, 'plugins/gameserver/dashboard');
        const dateien = [];
        (function gehe(d) {
            for (const e of fs.readdirSync(d, { withFileTypes: true })) {
                if (e.name === 'vendor' || e.name === 'node_modules') continue;
                const v = path.join(d, e.name);
                if (e.isDirectory()) gehe(v);
                else if (/\.(js|ejs)$/.test(e.name)) dateien.push(v);
            }
        }(ordner));
        const falsch = [];
        for (const d of dateien) {
            const text = ohneKommentare(fs.readFileSync(d, 'utf8'));
            const client = d.endsWith('assets/js/gameserver-sse.js');
            if (/new\s+(window\.)?GameserverSSEClient\(/.test(text) && !client) falsch.push(`${path.basename(d)} baut einen eigenen Client`);
            // Die Konsolenseite hat mit `/console/:id/stream` einen eigenen, einzigen Kanal.
            if (/new\s+EventSource\(/.test(text) && !client && !d.endsWith('gameserver-console.ejs')) {
                falsch.push(`${path.basename(d)} öffnet selbst einen Kanal`);
            }
        }
        assert.deepStrictEqual(falsch, []);
    });
    await pruefe('nur der Client pausiert im verdeckten Tab, keine Seite daneben', () => {
        const falsch = ['servers-overview.js', 'console-client.js', 'gameserver-live.js']
            .filter(d => /visibilitychange/.test(ohneKommentare(lies(d))));
        const ejs = path.join(WURZEL, 'plugins/gameserver/dashboard/views/guild');
        for (const d of ['server-detail.ejs', 'servers-overview.ejs', 'partials/server-detail-console.ejs']) {
            if (/visibilitychange/.test(ohneKommentare(fs.readFileSync(path.join(ejs, d), 'utf8')))) falsch.push(d);
        }
        assert.deepStrictEqual(falsch, []);
    });
    await pruefe('Konsole und Übersicht laden den Client vor sich', () => {
        const index = ohneKommentare(fs.readFileSync(path.join(WURZEL, 'plugins/gameserver/dashboard/index.js'), 'utf8'));
        for (const name of ['gameserver-console', 'gameserver-overview', 'gameserver-live']) {
            const stelle = index.indexOf(`registerScript('${name}'`);
            assert.ok(stelle >= 0, name);
            assert.match(index.slice(stelle, stelle + 260), /deps:\s*\[[^\]]*'gameserver-sse'/, name);
        }
    });

    console.log('\nEin Kanal');
    await pruefe('Live, Serverseite und Konsole teilen genau einen', () => {
        const s = seite();
        const C = s.k.GameserverSSEClient;
        const live = C.fuerSeite('g'); live.connect();
        const detail = C.fuerSeite('g').fuerServer(216); detail.connect();
        konsole(s).setupSSE();
        assert.strictEqual(s.quellen.length, 1);
        assert.ok(!/server_id/.test(s.quellen[0].url), 'der Kanal ist ungefiltert');
        assert.strictEqual(C.fuerSeite('g'), live);
    });
    await pruefe('die Konsole bekommt ihre Zeilen, ein zweites `setupSSE` verdoppelt sie nicht', () => {
        const s = seite();
        const c = konsole(s);
        c.setupSSE();
        c.setupSSE();
        s.sende(s.quellen[0], 'console', { action: 'output', server_id: '216', line: 'hallo' });
        s.sende(s.quellen[0], 'console', { action: 'output', server_id: '999', line: 'fremd' });
        assert.deepStrictEqual(c.zeilen, ['hallo']);
        assert.strictEqual(s.quellen.length, 1);
    });
    await pruefe('schließt die Konsole, bleibt der Kanal für die Seite offen', async () => {
        const s = seite();
        const c = konsole(s);
        c.setupSSE();
        c.clientId = null;
        await c.disconnect();
        s.sende(s.quellen[0], 'console', { action: 'output', server_id: '216', line: 'danach' });
        assert.strictEqual(s.quellen[0].zu, false);
        assert.deepStrictEqual(c.zeilen, []);
    });

    console.log('\nFilter');
    await pruefe('`fuerServer` lässt nur den eigenen Server durch, auch bei Zahl gegen Text', () => {
        const s = seite();
        const kanal = s.k.GameserverSSEClient.fuerSeite('g');
        const sicht = kanal.fuerServer('216');
        const da = [];
        sicht.on('gameserver_migration', (m) => da.push(m.server_id));
        sicht.connect();
        for (const server_id of [216, '216', 999, undefined]) {
            s.sende(s.quellen[0], 'gameserver_migration', { type: 'migration_progress', server_id });
        }
        assert.deepStrictEqual(da, [216, '216']);
    });
    await pruefe('die Live-Anzeige sieht weiter alle Server', () => {
        const s = seite();
        const kanal = s.k.GameserverSSEClient.fuerSeite('g');
        const da = [];
        kanal.on('status_changed', (m) => da.push(m.server_id));
        kanal.connect();
        s.sende(s.quellen[0], 'gameserver', { action: 'status_changed', server_id: 1 });
        s.sende(s.quellen[0], 'gameserver', { action: 'status_changed', server_id: 2 });
        assert.deepStrictEqual(da, [1, 2]);
    });

    console.log('\nNeuverbindung');
    await pruefe('nach einem Neustart des Dashboards verbindet er sich neu, Zuhörer bleiben', () => {
        const s = seite();
        const kanal = s.k.GameserverSSEClient.fuerSeite('g');
        const da = [];
        kanal.hoere('install', (e) => da.push(JSON.parse(e.data).n));
        kanal.connect();
        s.sende(s.quellen[0], 'shutdown', { message: 'Neustart' });
        s.quellen[0].onerror(new Error('weg'));
        s.laufe();
        assert.strictEqual(s.quellen.length, 2, 'kein neuer Kanal nach dem Neustart');
        s.sende(s.quellen[1], 'install', { n: 1 });
        assert.deepStrictEqual(da, [1]);
    });
    await pruefe('nach zehn Fehlversuchen meldet er es einmal und versucht es weiter', () => {
        const s = seite();
        const kanal = s.k.GameserverSSEClient.fuerSeite('g');
        let meldungen = 0;
        kanal.on('verbindung_verloren', () => { meldungen++; });
        kanal.connect();
        for (let i = 0; i < 15; i++) {
            s.quellen[s.quellen.length - 1].onerror(new Error('weg'));
            s.laufe();
        }
        assert.strictEqual(meldungen, 1);
        assert.strictEqual(s.quellen.length, 16);
    });
    await pruefe('ein Kanal, der wieder steht, darf erneut melden', () => {
        const s = seite();
        const kanal = s.k.GameserverSSEClient.fuerSeite('g');
        let meldungen = 0;
        kanal.on('verbindung_verloren', () => { meldungen++; });
        kanal.connect();
        const fall = (n) => { for (let i = 0; i < n; i++) { s.quellen[s.quellen.length - 1].onerror(new Error('weg')); s.laufe(); } };
        fall(11);
        s.sende(s.quellen[s.quellen.length - 1], 'connected', {});
        fall(11);
        assert.strictEqual(meldungen, 2);
    });
    await pruefe('getrennt von Hand bleibt getrennt, bis jemand verbindet', () => {
        const s = seite();
        const kanal = s.k.GameserverSSEClient.fuerSeite('g');
        kanal.connect();
        kanal.disconnect();
        s.laufe();
        assert.strictEqual(s.quellen.length, 1);
        assert.strictEqual(s.quellen[0].zu, true);
        kanal.connect();
        assert.strictEqual(s.quellen.length, 2);
    });

    console.log('\nVerdeckter Tab');
    await pruefe('`connected` erreicht `on()` und `fuerServer`, `wieder` erst ab dem zweiten Mal', () => {
        const s = seite();
        const kanal = s.k.GameserverSSEClient.fuerSeite('g');
        const da = [];
        kanal.on('connected', (d) => da.push(['seite', d.wieder]));
        kanal.fuerServer('216').on('connected', (d) => da.push(['server', d.wieder]));
        kanal.connect();
        s.sende(s.quellen[0], 'connected', {});
        s.quellen[0].onerror(new Error('Neustart'));
        s.laufe();
        s.sende(s.quellen[1], 'connected', {});
        assert.deepStrictEqual(da, [['seite', false], ['server', false], ['seite', true], ['server', true]]);
    });
    await pruefe('verdeckt hält er den Kanal bis zur Frist, danach gibt er ihn frei', () => {
        const s = seite();
        const kanal = s.k.GameserverSSEClient.fuerSeite('g');
        kanal.connect();
        s.sende(s.quellen[0], 'connected', {});
        s.sicht(true);
        s.laufe(29999);
        assert.strictEqual(s.quellen[0].zu, false, 'vor der Frist schon zu');
        assert.ok(s.zeitgeber.some(t => t.ms === 30000), 'keine Frist von 30 s geplant');
        s.laufe();
        assert.strictEqual(s.quellen[0].zu, true, 'nach der Frist noch offen');
        assert.strictEqual(kanal.isConnected(), false);
    });
    await pruefe('wer vor der Frist zurückkommt, behält den Kanal', () => {
        const s = seite();
        const kanal = s.k.GameserverSSEClient.fuerSeite('g');
        kanal.connect();
        s.sicht(true);
        s.sicht(false);
        s.laufe();
        assert.strictEqual(s.quellen.length, 1);
        assert.strictEqual(s.quellen[0].zu, false);
    });
    await pruefe('pausiert öffnet weder ein Neuversuch noch ein `connect()` den Kanal, Sichtbarwerden schon', () => {
        const s = seite();
        const kanal = s.k.GameserverSSEClient.fuerSeite('g');
        kanal.connect();
        s.quellen[0].onerror(new Error('weg'));
        s.sicht(true);
        s.zeitgeber.filter(t => t.ms === 30000).forEach(t => { s.zeitgeber.splice(s.zeitgeber.indexOf(t), 1); t.fn(); });
        s.laufe();
        kanal.connect();
        assert.strictEqual(s.quellen.length, 1, 'im verdeckten Tab neu verbunden');
        s.sicht(false);
        assert.strictEqual(s.quellen.length, 2);
    });
    await pruefe('ein von Hand getrennter Kanal kommt beim Sichtbarwerden nicht zurück', () => {
        const s = seite();
        const kanal = s.k.GameserverSSEClient.fuerSeite('g');
        kanal.connect();
        s.sicht(true);
        kanal.disconnect();
        s.laufe();
        s.sicht(false);
        assert.strictEqual(s.quellen.length, 1);
    });
    await pruefe('nach der Pause holt die Live-Anzeige alles nach', () => {
        // Die Klasse steckt in einer Hülle ohne Ausgang, geprüft wird die Stelle.
        assert.ok(/sse\.on\('connected',\s*\(d\)\s*=>\s*\{\s*if \(d\.wieder\) this\.holeAlles\(\)/
            .test(ohneKommentare(lies('gameserver-live.js'))), 'gameserver-live.js holt bei `wieder` nicht nach');
    });
    await pruefe('nach der Pause lädt die Konsole ihren Verlauf neu und meldet den alten Attach ab', async () => {
        const s = seite();
        const c = konsole(s);
        c.clientId = 'alt';
        c.setupSSE();
        s.sende(s.quellen[0], 'connected', {});
        assert.strictEqual(c.zurueckgesetzt, 0, 'schon beim ersten Verbinden neu geladen');
        s.sicht(true);
        s.laufe();
        s.sicht(false);
        s.sende(s.quellen[1], 'connected', {});
        await new Promise(r => setImmediate(r));
        assert.strictEqual(c.zurueckgesetzt, 1);
        assert.deepStrictEqual(c.geschrieben.slice(1), ['eins', 'zwei']);
        assert.strictEqual(c.clientId, 'neu');
        const ab = s.abrufe.find(a => /\/detach$/.test(a.url));
        assert.ok(ab, 'alter Attach nicht abgemeldet');
        assert.strictEqual(JSON.parse(ab.body).client_id, 'alt');
    });

    console.log('\nÜbersicht');
    await pruefe('nach der Pause holt die Übersicht die Stati nach', () => {
        const s = seite();
        vm.runInContext(`${lies('servers-overview.js')}\nthis.GameserverOverview = GameserverOverview;`, s.k);
        const o = new s.k.GameserverOverview('g');
        let nachgeladen = 0;
        o.refreshAllServerStates = () => { nachgeladen++; };
        o.init();
        assert.strictEqual(s.quellen.length, 1);
        s.sende(s.quellen[0], 'connected', {});
        assert.strictEqual(nachgeladen, 0, 'schon beim ersten Verbinden nachgeladen');

        s.sicht(true);
        s.laufe();
        assert.strictEqual(s.quellen[0].zu, true, 'der verdeckte Tab hält den Kanal offen');

        s.sicht(false);
        assert.strictEqual(s.quellen.length, 2);
        s.sende(s.quellen[1], 'connected', {});
        assert.strictEqual(nachgeladen, 1);
    });
    await pruefe('Übersicht und Live-Anzeige teilen ihn', () => {
        const s = seite();
        vm.runInContext(`${lies('servers-overview.js')}\nthis.GameserverOverview = GameserverOverview;`, s.k);
        s.k.GameserverSSEClient.fuerSeite('g').connect();
        new s.k.GameserverOverview('g').init();
        assert.strictEqual(s.quellen.length, 1);
    });

    console.log(fehler ? `\n❌ ${fehler} Prüfung(en) rot` : '\n✅ Eine Seite, ein Kanal');
    process.exit(fehler ? 1 : 0);
})();
