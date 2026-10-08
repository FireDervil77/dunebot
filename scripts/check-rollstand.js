#!/usr/bin/env node
/**
 * Nach dem Neuladen wieder an derselben Stelle (2026-10-08).
 *
 * Im Panel rollt der Inhaltsbereich, nicht das Fenster — und dessen Position
 * merkt sich kein Browser. Jede Seite, die nach dem Speichern neu lädt, stand
 * deshalb wieder oben (Betreiber, an der Werkbank). `rollstand.js` merkt sich
 * die Position je Adresse und stellt sie nach Neuladen und Vor/Zurück wieder her.
 *
 * Geprüft wird das Verhalten des Skripts selbst — in einer nachgestellten
 * Umgebung, weil es nur Fenster, Dokument und sessionStorage braucht — und
 * seine Voraussetzung: dass der Inhaltsbereich wirklich der ist, der rollt.
 * Ändert jemand das Layout zurück, sagt dieser Wächter, dass das Skript nichts
 * mehr tut.
 *
 *   node scripts/check-rollstand.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const { ohneKommentare } = require('./lib/quelltext');

const WURZEL = path.join(__dirname, '..');
const THEME = path.join(WURZEL, 'apps/dashboard/themes/default');
const skript = fs.readFileSync(path.join(THEME, 'assets/js/rollstand.js'), 'utf8');

let fehler = 0;
function pruefe(was, tun) {
    try { tun(); console.log(`  ✓ ${was}`); }
    catch (e) { fehler++; console.log(`  ✗ ${was}\n      ${String(e.message).split('\n').slice(0, 3).join('\n      ')}`); }
}

/** Eine Seite nachstellen und das Skript darin laufen lassen. */
function seite({ art = 'reload', adresse = { pathname: '/guild/1/plugins/werkbank/wb1', search: '', hash: '' }, speicher = {}, kasten = { scrollTop: 0 }, bereit = 'loading', kaputt = false } = {}) {
    const ereignisse = { fenster: {}, dokument: {} };
    const lager = {
        getItem: (k) => { if (kaputt) throw new Error('gesperrt'); return k in speicher ? speicher[k] : null; },
        setItem: (k, v) => { if (kaputt) throw new Error('gesperrt'); speicher[k] = v; },
        removeItem: (k) => { if (kaputt) throw new Error('gesperrt'); delete speicher[k]; },
    };
    const umgebung = {
        location: adresse,
        sessionStorage: lager,
        performance: { getEntriesByType: () => (art === null ? [] : [{ type: art }]) },
        document: {
            readyState: bereit,
            querySelector: (s) => (s === '.page > .page-wrapper' ? kasten : null),
            addEventListener: (n, f) => { ereignisse.dokument[n] = f; },
        },
        isFinite, Number, Math, String,
    };
    umgebung.window = { addEventListener: (n, f) => { ereignisse.fenster[n] = f; } };
    vm.runInNewContext(skript, umgebung);
    return { speicher, kasten, ereignisse };
}
const SCHLUESSEL = 'fb-rollstand:/guild/1/plugins/werkbank/wb1';

console.log('\nrollstand.js: merken und wiederherstellen');
pruefe('nach dem Neuladen steht der Inhaltsbereich wieder dort — beim Aufbau und noch einmal nach dem Laden', () => {
    const s = seite({ speicher: { [SCHLUESSEL]: '1840' } });
    assert.strictEqual(s.kasten.scrollTop, 0, 'vor dem Aufbau der Seite schon gesetzt');
    s.ereignisse.dokument.DOMContentLoaded();
    assert.strictEqual(s.kasten.scrollTop, 1840);
    s.kasten.scrollTop = 0;                    // Bilder haben die Höhe verändert
    s.ereignisse.fenster.load();
    assert.strictEqual(s.kasten.scrollTop, 1840);
});
pruefe('ist die Seite schon aufgebaut, wird sofort gesetzt', () => {
    assert.strictEqual(seite({ speicher: { [SCHLUESSEL]: '300' }, bereit: 'interactive' }).kasten.scrollTop, 300);
});
pruefe('auch nach Vor/Zurück — aber nicht, wer die Seite über einen Verweis neu betritt', () => {
    const zurueck = seite({ art: 'back_forward', speicher: { [SCHLUESSEL]: '500' }, bereit: 'complete' });
    assert.strictEqual(zurueck.kasten.scrollTop, 500);
    for (const art of ['navigate', 'prerender', null]) {
        const neu = seite({ art, speicher: { [SCHLUESSEL]: '500' }, bereit: 'complete' });
        assert.strictEqual(neu.kasten.scrollTop, 0, `bei „${art}" wiederhergestellt`);
        assert.strictEqual(neu.ereignisse.dokument.DOMContentLoaded, undefined);
    }
});
pruefe('beim Verlassen wird gemerkt — je Adresse samt #…, ganz oben wird vergessen', () => {
    const s = seite({ kasten: { scrollTop: 912.6 } });
    s.ereignisse.fenster.pagehide();
    assert.deepStrictEqual(s.speicher, { [SCHLUESSEL]: '913' });
    s.kasten.scrollTop = 0;
    s.ereignisse.fenster.pagehide();
    assert.deepStrictEqual(s.speicher, {}, 'eine Seite, die oben steht, behält einen alten Wert');
    // Ein Reiter ist eine eigene Stelle.
    const r = seite({ adresse: { pathname: '/guild/1/plugins/werkbank/wb1', search: '?x=1', hash: '#einstellungen' }, kasten: { scrollTop: 40 } });
    r.ereignisse.fenster.pagehide();
    assert.deepStrictEqual(Object.keys(r.speicher), [SCHLUESSEL + '?x=1#einstellungen']);
    const anderer = seite({ adresse: { pathname: '/guild/1/plugins/werkbank/wb1', search: '', hash: '#starten' }, speicher: { [SCHLUESSEL + '#einstellungen']: '700' }, bereit: 'complete' });
    assert.strictEqual(anderer.kasten.scrollTop, 0, 'die Stelle eines anderen Reiters wurde übernommen');
});
pruefe('nichts davon wirft: kein Inhaltsbereich, gesperrter Speicher, Unsinn im Speicher', () => {
    const ohne = seite({ kasten: null, speicher: { [SCHLUESSEL]: '5' }, bereit: 'complete' });
    ohne.ereignisse.fenster.pagehide();
    const gesperrt = seite({ kaputt: true, kasten: { scrollTop: 77 }, bereit: 'complete' });
    gesperrt.ereignisse.fenster.pagehide();
    assert.strictEqual(gesperrt.kasten.scrollTop, 77);
    for (const unsinn of ['abc', '-5', '0', '']) {
        assert.strictEqual(seite({ speicher: { [SCHLUESSEL]: unsinn }, kasten: { scrollTop: 12 }, bereit: 'complete' }).kasten.scrollTop, 12, `„${unsinn}" wurde gesetzt`);
    }
});

console.log('\nEinbindung und Voraussetzung');
pruefe('das Skript ist angemeldet und wird mit dem Panel geladen', () => {
    const theme = ohneKommentare(fs.readFileSync(path.join(THEME, 'theme.js'), 'utf8'));
    assert.ok(/registerScript\('rollstand', 'rollstand\.js'/.test(theme), 'nicht angemeldet');
    assert.ok(/enqueueScript\('rollstand'\)/.test(theme), 'nicht eingereiht');
});
pruefe('im Panel rollt wirklich der Inhaltsbereich — sonst täte das Skript nichts mehr', () => {
    const css = ohneKommentare(fs.readFileSync(path.join(THEME, 'assets/css/guild.css'), 'utf8'));
    const regel = /\.page > \.page-wrapper \{([^}]*)\}/.exec(css);
    assert.ok(regel, 'die Regel für `.page > .page-wrapper` ist verschwunden');
    assert.ok(/overflow-y:\s*auto/.test(regel[1]), 'der Inhaltsbereich rollt nicht mehr selbst — rollstand.js und dieser Wächter sind dann hinfällig');
});

console.log(fehler === 0 ? '\n✅ Rollposition: nach dem Neuladen wieder dort\n' : `\n❌ ${fehler} Abweichung(en)\n`);
process.exit(fehler === 0 ? 0 : 1);
