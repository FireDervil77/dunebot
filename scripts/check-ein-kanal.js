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
 *   - Die Übersicht gibt den Kanal in einem verdeckten Tab frei.
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
    const k = {
        console: { log: still, warn: still, debug: still, error: still },
        JSON, Math, String, Number, Promise, Map, Set, Array, Object,
        setTimeout: (fn) => { zeitgeber.push(fn); return zeitgeber.length; },
        clearTimeout: (n) => { zeitgeber[n - 1] = still; },
        document: { hidden: false, addEventListener: (art, fn) => { horcherAmDokument[art] = fn; } },
        fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) }),
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
    const laufe = () => { const z = zeitgeber.splice(0); z.forEach(fn => fn()); };
    return { k, quellen, sende, laufe, horcherAmDokument };
}

function konsole(s) {
    vm.runInContext(`${lies('console-client.js')}\nthis.GameserverConsoleClient = GameserverConsoleClient;`, s.k);
    const still = () => {};
    const c = Object.create(s.k.GameserverConsoleClient.prototype);
    c.config = { apiBase: '/x', guildId: 'g', serverId: '216' };
    c.zeilen = [];
    c.terminal = { writeln: still, write: still, refresh: still, scrollToBottom: still, rows: 24 };
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
    await pruefe('Konsole und Übersicht laden den Client vor sich', () => {
        const index = fs.readFileSync(path.join(WURZEL, 'plugins/gameserver/dashboard/index.js'), 'utf8');
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

    console.log('\nÜbersicht');
    await pruefe('ein verdeckter Tab gibt den Kanal frei, ein sichtbarer holt ihn zurück und lädt nach', () => {
        const s = seite();
        vm.runInContext(`${lies('servers-overview.js')}\nthis.GameserverOverview = GameserverOverview;`, s.k);
        const o = new s.k.GameserverOverview('g');
        let nachgeladen = 0;
        o.refreshAllServerStates = () => { nachgeladen++; };
        o.init();
        assert.strictEqual(s.quellen.length, 1);

        s.k.document.hidden = true;
        s.horcherAmDokument.visibilitychange();
        assert.strictEqual(s.quellen[0].zu, true, 'der verdeckte Tab hält den Kanal offen');

        s.k.document.hidden = false;
        s.horcherAmDokument.visibilitychange();
        s.laufe();
        assert.strictEqual(s.quellen.length, 2);
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
