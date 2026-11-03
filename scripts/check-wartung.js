#!/usr/bin/env node
/**
 * Die Seiten, die der Apache selbst ausliefert (2026-11-03): „Gleich zurück" und die
 * Wartungsseite. Geschaltet wird unter /admin/wartung, gelesen vom Apache.
 *
 * Geprüft wird an einem eigenen Ablageordner, nie am echten: Schriebe der Wächter in
 * `wartung/aktiv`, wäre die Website für die Dauer der Prüfung gesperrt.
 *
 *   node scripts/check-wartung.js
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { ServiceManager } = require('dunebot-core');

const WURZEL = path.join(__dirname, '..');
const meldungen = [];
ServiceManager.register('Logger', { info: (t) => meldungen.push(t), warn: () => {}, error: () => {}, debug: () => {} });
const Wartung = require('../apps/dashboard/helpers/Wartung');

const lies = (p) => fs.readFileSync(path.join(WURZEL, p), 'utf8');
let fehler = 0;
function pruefe(was, tun) {
    try { tun(); console.log(`  ✓ ${was}`); }
    catch (e) { fehler++; console.log(`  ✗ ${was}\n      ${String(e.message).split('\n').join('\n      ')}`); }
}

console.log('Seite bauen');
pruefe('was eingegeben wird, steht escaped da, kein Platzhalter bleibt übrig', () => {
    const html = Wartung.baue({ text_de: '<script>alert(1)</script> & "x"', text_en: "it's" });
    assert.ok(!html.includes('<script>alert(1)'), 'ein Skript aus dem Text käme durch');
    assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;x&quot;'));
    assert.ok(html.includes('it&#39;s'));
    assert.ok(!/\{\{[A-Z_]+\}\}/.test(html), 'Platzhalter übrig');
});
pruefe('Sonderzeichen von replace bleiben, was sie sind', () => {
    const html = Wartung.baue({ text_de: "$& $' $1 {{TEXT_EN}}" });
    assert.ok(html.includes("$&amp; $&#39; $1 {{TEXT_EN}}"), 'der Text wurde verändert');
});
pruefe('leere Texte nehmen die Vorgabe, „bis" steht in beiden Sprachen da', () => {
    const html = Wartung.baue({ bis: '2026-11-03T14:00' });
    assert.ok(html.includes('Wir arbeiten gerade an FireBot'));
    assert.ok(html.includes('Voraussichtlich bis 03.11.2026, 14:00 Uhr'));
    assert.ok(html.includes('Expected until 03.11.2026, 14:00'));
});
pruefe('Unsinn wird abgewiesen: falsche Zeit, zu langer Text', () => {
    assert.throws(() => Wartung.baue({ bis: 'morgen' }), /kein gültiger Zeitpunkt/);
    assert.throws(() => Wartung.baue({ text_de: 'x'.repeat(Wartung.MAX_TEXT + 1) }), /zu lang/);
});

console.log('\nSchalten (eigener Ordner)');
const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'wartung-'));
const probe = Wartung.ablage(path.join(ordner, 'aktiv'));
try {
    pruefe('anfangs aus, mit den Vorgaben', () => {
        const s = probe.stand();
        assert.strictEqual(s.an, false);
        assert.strictEqual(s.text_de, '');
        assert.ok(s.vorgabe.text_de);
    });
    pruefe('einschalten legt die fertige Seite ab, lesbar für den Apache, und steht im Log', () => {
        const s = probe.setze({ text_de: 'Umbau', bis: '2026-11-03T14:00' }, true, 'probe (1)');
        assert.strictEqual(s.an, true);
        assert.ok(fs.readFileSync(probe.SEITE, 'utf8').includes('Umbau'));
        assert.strictEqual(fs.statSync(probe.SEITE).mode & 0o004, 0o004, 'für andere nicht lesbar');
        assert.strictEqual(fs.statSync(path.dirname(probe.SEITE)).mode & 0o001, 0o001, 'Ordner für andere nicht passierbar');
        assert.ok(meldungen.some(m => m === '[Wartung] Eingeschaltet von probe (1)'));
        assert.deepStrictEqual(fs.readdirSync(path.dirname(probe.SEITE)).sort(), ['stand.json', 'wartung.html'], 'Zwischendatei liegt noch da');
    });
    pruefe('Text ändern bei eingeschalteter Seite schreibt die Seite neu', () => {
        probe.setze({ text_de: 'Noch dran' }, true, 'probe (1)');
        assert.ok(fs.readFileSync(probe.SEITE, 'utf8').includes('Noch dran'));
    });
    pruefe('ausschalten löscht die Seite, die Texte bleiben für das nächste Mal', () => {
        const s = probe.setze({ text_de: 'Noch dran' }, false, 'probe (1)');
        assert.strictEqual(s.an, false);
        assert.strictEqual(fs.existsSync(probe.SEITE), false);
        assert.strictEqual(probe.stand().text_de, 'Noch dran');
        assert.ok(meldungen.some(m => m === '[Wartung] Ausgeschaltet von probe (1)'));
    });
    pruefe('eine abgewiesene Eingabe schaltet nichts', () => {
        assert.throws(() => probe.setze({ bis: 'morgen' }, true, 'probe (1)'));
        assert.strictEqual(probe.stand().an, false);
    });
} finally {
    fs.rmSync(ordner, { recursive: true, force: true });
}

console.log('\nApache');
const conf = lies('apps/dashboard/wartung/apache.conf').split('\n').filter(z => !z.trim().startsWith('#')).join('\n');
pruefe('die Regel sieht genau die Datei, die das Dashboard schreibt', () => {
    const pfade = [...conf.matchAll(/(\/\S+\/wartung\/aktiv\/wartung\.html)/g)].map(m => m[1]);
    assert.strictEqual(pfade.length, 2, 'If und RewriteCond');
    for (const p of pfade) assert.strictEqual(p, Wartung.SEITE);
});
pruefe('/_wartung/ geht nicht an Node, und beide Fehlerseiten sind gesetzt', () => {
    assert.match(conf, /ProxyPass \/_wartung\/ !/);
    assert.match(conf, /ErrorDocument 502 \/_wartung\/neustart\.html/);
    assert.match(conf, /ErrorDocument 503 \/_wartung\/neustart\.html/);
    assert.match(conf, /ErrorDocument 503 \/_wartung\/aktiv\/wartung\.html/);
    const alias = /Alias \/_wartung\/ (\S+)/.exec(conf)[1];
    assert.strictEqual(path.resolve(alias), Wartung.ORDNER);
});
pruefe('während der Wartung kommen Admin, Anmeldung, Rückrufe und die Seite selbst durch', () => {
    const ausnahmen = [...conf.matchAll(/RewriteCond %\{REQUEST_URI\} !(\S+)/g)].map(m => new RegExp(m[1]));
    const durch = (url) => ausnahmen.some(r => r.test(url));
    for (const url of ['/admin', '/admin/wartung', '/auth/callback', '/api/twitch/webhook', '/api/core/toasts/log',
        '/_wartung/seite.css', '/themes/default/assets/js/guild.js', '/downloads/daemon/version.json',
        '/api/migration/23/stream']) {
        assert.ok(durch(url), `${url} wäre gesperrt`);
    }
    for (const url of ['/', '/guild', '/guild/1/plugins/gameserver', '/kb', '/api/guild/1', '/administrator']) {
        assert.ok(!durch(url), `${url} käme durch`);
    }
});
pruefe('Texte und Zwischendateien sind nicht abrufbar', () => {
    assert.match(conf, /FilesMatch "\^\(stand\\\.json\|apache\\\.conf\)\$\|\\\.neu\$"/);
});

console.log('\nSeiten');
for (const datei of ['neustart.html', 'wartung.vorlage.html']) {
    pruefe(`${datei} braucht nichts vom Dashboard, und alles, was sie lädt, gibt es`, () => {
        const html = lies(`apps/dashboard/wartung/${datei}`);
        const quellen = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(m => m[1]);
        assert.ok(quellen.length >= 4, 'zu wenige Quellen gefunden');
        for (const q of quellen) {
            assert.ok(q.startsWith('/_wartung/'), `${q} käme vom Dashboard`);
            const datei = q.startsWith('/_wartung/kit/')
                ? path.join(WURZEL, 'apps/dashboard/themes/default/assets/images/kit', q.slice('/_wartung/kit/'.length))
                : path.join(Wartung.ORDNER, q.slice('/_wartung/'.length));
            assert.ok(fs.existsSync(datei), `${q} gibt es nicht`);
        }
    });
}
pruefe('die Schriften im Stil gibt es auch', () => {
    for (const m of lies('apps/dashboard/wartung/seite.css').matchAll(/url\("\/_wartung\/kit\/([^"]+)"\)/g)) {
        assert.ok(fs.existsSync(path.join(WURZEL, 'apps/dashboard/themes/default/assets/images/kit', m[1])), m[1]);
    }
});
pruefe('der Ablageordner ist nicht im Repository', () => {
    assert.match(lies('.gitignore'), /^apps\/dashboard\/wartung\/aktiv\/$/m);
});

console.log(fehler ? `\n✗ ${fehler} Prüfung(en) rot` : '\n✅ Die Seiten stehen, auch ohne Dashboard');
process.exit(fehler ? 1 : 0);
