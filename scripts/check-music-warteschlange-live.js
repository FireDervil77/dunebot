#!/usr/bin/env node
/**
 * Die Seite `/warteschlange` zieht selbst nach (P15, Betreiber 2026-10-29: F27).
 *
 *   Vorlage   `music-warteschlange-voll.ejs`: Seite und Route rendern dieselbe,
 *             drei Zustände (Liste, nur laufender Titel, leer)
 *   Route     `?voll=1` nimmt die volle Vorlage, ohne die kurze; `gesamt` kommt mit
 *   Skript    das echte `music-steuerung.js` in einer Testumgebung: Auf
 *             /warteschlange läuft der Takt ohne Spieler, die erste Runde holt
 *             nichts, eine Änderung holt `?voll=1`, nichts lädt die Seite neu.
 *             Die Übersicht holt weiter die kurze Karte.
 *
 *   node scripts/check-music-warteschlange-live.js
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ejs = require('ejs');
const WURZEL = path.join(__dirname, '..');
const { ohneKommentare } = require('./lib/quelltext');

let fehler = 0;
async function pruefe(was, tun) {
    try { await tun(); console.log(`  ✓ ${was}`); }
    catch (e) { fehler++; console.log(`  ✗ ${was}\n      ${String(e.message).split('\n').slice(0, 3).join('\n      ')}`); }
}
const lies = (rel) => fs.readFileSync(path.join(WURZEL, rel), 'utf8');
const ruhe = () => new Promise(r => setTimeout(r, 15));

/** Das echte Skript in einer Seite mit den genannten Elementen. */
function seite(ids, zustaende) {
    const elemente = Object.fromEntries(ids.map(id => [id, { id, innerHTML: 'alt', textContent: '?', value: '' }]));
    const lauscher = {};
    const abrufe = [];
    let neuGeladen = 0;
    let z = zustaende;
    const window = {
        setTimeout: () => 1, clearTimeout: () => {},
        location: { reload: () => { neuGeladen++; }, href: 'http://x/' },
        toastr: { success: () => {}, error: () => {}, warning: () => {} },
        confirm: () => true, alert: () => {},
    };
    const document = {
        hidden: false,
        getElementById: (id) => elemente[id] || null,
        querySelector: (s) => (s === '[data-music-basis]' ? { dataset: { musicBasis: '/b' } } : null),
        querySelectorAll: () => [],
        addEventListener: (n, f) => { lauscher[n] = f; },
    };
    const fetch = async (url, opt = {}) => {
        abrufe.push(`${opt.method || 'GET'} ${url}`);
        let daten = { success: true };
        if (url.endsWith('/steuerung/state')) daten = { success: true, zustand: z };
        if (url.includes('/steuerung/warteschlange-teil')) daten = { success: true, html: 'NEU', anzahl: 1, gesamt: 2 };
        return { ok: true, json: async () => daten };
    };
    vm.runInNewContext(lies('plugins/music/dashboard/assets/js/music-steuerung.js'),
        { window, document, fetch, console, URL, JSON, Promise, Math, String, Boolean, parseInt, Number });
    return {
        elemente, abrufe, window,
        setze: (neu) => { z = neu; },
        los: async () => { lauscher.DOMContentLoaded(); await ruhe(); },
        neuGeladen: () => neuGeladen,
        teilAbrufe: () => abrufe.filter(a => a.includes('warteschlange-teil')),
    };
}

const A = { url: 'a', title: 'A', positionSek: 1, durationSec: 9 };
const B = { url: 'b', title: 'B' };

(async () => {
    console.log('\nWarteschlange live (F27)');

    await pruefe('Vorlage: alle drei Zustände, Seite und Route nehmen dieselbe', async () => {
        const datei = path.join(WURZEL, 'plugins/music/dashboard/views/guild/partials/music-warteschlange-voll.ejs');
        const tr = (k) => k;
        const spielzeitText = () => '3 min';
        const titel = { title: 'Lied', url: 'u', durationSec: 60, source: 'youtube' };
        const liste = await ejs.renderFile(datei, { tr, spielzeitText, zustand: { aktuell: titel, warteschlange: [titel], restspielzeitSek: 60 } });
        assert.match(liste, /musicVerschieben\(0, 0\)/);
        assert.match(liste, /musicEntfernen\(0\)/);
        assert.match(liste, /music:DASHBOARD\.NOW_PLAYING/);
        assert.doesNotMatch(liste, /\[object Promise\]/);
        assert.match(await ejs.renderFile(datei, { tr, spielzeitText, zustand: { aktuell: titel, warteschlange: [] } }), /music:QUEUE\.ONLY_CURRENT/);
        assert.match(await ejs.renderFile(datei, { tr, spielzeitText, zustand: { aktuell: null, warteschlange: [] } }), /music:QUEUE\.EMPTY_HINT/);
        const v = lies('plugins/music/dashboard/views/guild/music-queue.ejs');
        assert.match(v, /id="music-warteschlange-voll"/);
        assert.match(v, /include\('partials\/music-warteschlange-voll'/);
        assert.match(v, /id="music-warteschlange-gesamt"/);
        assert.doesNotMatch(v, /musicVerschieben\(/, 'die Liste steht wieder zweimal');
    });

    await pruefe('Route: ?voll=1 wählt die volle Vorlage, gesamt kommt mit', async () => {
        const r = ohneKommentare(lies('plugins/music/dashboard/routes/control.router.js'));
        assert.match(r, /voll \? 'music-warteschlange-voll\.ejs' : 'music-warteschlange-teil\.ejs'/);
        assert.match(r, /gesamt: zustand\.titelGesamt/);
    });

    await pruefe('/warteschlange: Takt läuft ohne Spieler, erste Runde holt nichts', async () => {
        const s = seite(['music-warteschlange-voll', 'music-warteschlange-gesamt'], { aktuell: A, warteschlange: [B] });
        await s.los();
        assert.ok(s.abrufe.includes('GET /b/steuerung/state'), 'kein Takt auf der Seite');
        assert.deepStrictEqual(s.teilAbrufe(), []);
    });

    await pruefe('Änderung von außen: holt ?voll=1, tauscht Inhalt und Zahl', async () => {
        const s = seite(['music-warteschlange-voll', 'music-warteschlange-gesamt'], { aktuell: A, warteschlange: [B] });
        await s.los();
        s.setze({ aktuell: A, warteschlange: [B, { url: 'c' }] });
        s.window.musicSteuern('mischen'); await ruhe();
        assert.deepStrictEqual(s.teilAbrufe(), ['GET /b/steuerung/warteschlange-teil?voll=1']);
        assert.strictEqual(s.elemente['music-warteschlange-voll'].innerHTML, 'NEU');
        assert.strictEqual(s.elemente['music-warteschlange-gesamt'].textContent, 2);
    });

    await pruefe('Titelwechsel und „nichts läuft mehr" laden nicht neu', async () => {
        const s = seite(['music-warteschlange-voll'], { aktuell: A, warteschlange: [] });
        await s.los();
        s.setze({ aktuell: B, warteschlange: [] });
        s.window.musicSteuern('ueberspringen'); await ruhe();
        assert.strictEqual(s.teilAbrufe().length, 1, 'der laufende Titel steht in der Karte, sein Wechsel muss nachziehen');
        s.setze({ aktuell: null, warteschlange: [] });
        s.window.musicSteuern('ueberspringen'); await ruhe();
        assert.strictEqual(s.teilAbrufe().length, 2);
        assert.strictEqual(s.neuGeladen(), 0, 'die Seite wurde neu geladen');
    });

    await pruefe('Verschieben und Entfernen ziehen nach, statt neu zu laden', async () => {
        const s = seite(['music-warteschlange-voll'], { aktuell: A, warteschlange: [B, { url: 'c' }] });
        await s.los();
        s.setze({ aktuell: A, warteschlange: [{ url: 'c' }] });
        s.window.musicEntfernen(0); await ruhe();
        s.setze({ aktuell: A, warteschlange: [{ url: 'd' }] });
        s.window.musicVerschieben(1, 0); await ruhe();
        assert.strictEqual(s.teilAbrufe().length, 2);
        assert.strictEqual(s.neuGeladen(), 0);
    });

    await pruefe('Übersicht: weiter die kurze Karte', async () => {
        const s = seite(['music-spieler', 'music-titel', 'music-warteschlange-teil', 'music-warteschlange-zahl'], { aktuell: A, warteschlange: [B] });
        await s.los();
        s.setze({ aktuell: A, warteschlange: [B, { url: 'c' }] });
        s.window.musicSteuern('mischen'); await ruhe();
        assert.deepStrictEqual(s.teilAbrufe(), ['GET /b/steuerung/warteschlange-teil']);
        assert.strictEqual(s.elemente['music-warteschlange-zahl'].textContent, 1);
    });

    await pruefe('andere Musikseiten: kein Takt', async () => {
        const s = seite([], { aktuell: A, warteschlange: [] });
        await s.los();
        assert.deepStrictEqual(s.abrufe, []);
    });

    console.log(fehler ? `\n✗ ${fehler} Prüfung(en) rot` : '\n✅ Warteschlange zieht auf beiden Seiten nach, ein Weg');
    process.exit(fehler ? 1 : 0);
})();
