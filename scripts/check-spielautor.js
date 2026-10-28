#!/usr/bin/env node
/**
 * Wer steht unter einem Spiel der Spiele-Datenbank? (2026-10-28)
 *
 * Bis dahin „von Unknown": Die Ansicht fragte `author_name` ab, das keine
 * Abfrage lieferte. Jetzt der Autor der gezeigten Fassung (`identity.author`,
 * von der Werkbank beim Veröffentlichen eingetragen), sonst „FireBot-Team"
 * für Spiele der Plattform, sonst keine Zeile.
 *
 *   node scripts/check-spielautor.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ServiceManager } = require('dunebot-core');
const still = () => {};
if (!ServiceManager.has('Logger')) ServiceManager.register('Logger', { debug: still, info: still, warn: still, error: still });

const WURZEL = path.join(__dirname, '..');
const { ohneKommentare } = require('./lib/quelltext');
const Paketfassung = require(path.join(WURZEL, 'plugins/gameserver/dashboard/helpers/Paketfassung'));

let bestanden = 0;
function pruefe(name, fn) {
    try { fn(); console.log(`  ✓ ${name}`); bestanden++; } catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

pruefe('Der Autor der Fassung gewinnt', () => {
    assert.strictEqual(Paketfassung.autor({ guild_id: null }, { autor: 'firedervil' }), 'firedervil');
    assert.strictEqual(Paketfassung.autor({ guild_id: '123' }, { autor: 'jemand' }), 'jemand');
});
pruefe('Ohne Autor: Plattform-Spiel → FireBot-Team, Guild-Paket → keine Zeile', () => {
    assert.strictEqual(Paketfassung.autor({ guild_id: null }, { autor: null }), 'FireBot-Team');
    assert.strictEqual(Paketfassung.autor({ guild_id: null }, null), 'FireBot-Team');
    assert.strictEqual(Paketfassung.autor({ guild_id: '123' }, null), null);
});
pruefe('Fehlt guild_id in der Zeile, wird nichts behauptet', () => {
    assert.strictEqual(Paketfassung.autor({}, null), null);
});
pruefe('freigabeJePaket liest identity.author — freigegebene Fassung, sonst neueste', () => {
    const q = ohneKommentare(fs.readFileSync(path.join(WURZEL, 'plugins/gameserver/dashboard/helpers/Paketfassung.js'), 'utf8'));
    assert.match(q, /JSON_EXTRACT\(s\.fbpkg, '\$\.identity\.author'\)\) FROM package_versions s/);
    assert.match(q, /autor: \(z\.freigegeben \? z\.freigegeben_autor : z\.neueste_autor\) \|\| null/);
});
pruefe('Liste und Detail setzen author_name über die Regel, die Ansichten erfinden nichts', () => {
    const r = ohneKommentare(fs.readFileSync(path.join(WURZEL, 'plugins/gameserver/dashboard/routes/addons.js'), 'utf8'));
    assert.match(r, /a\.author_name = Paketfassung\.autor\(a, a\.freigabe\)/);
    assert.match(r, /addon\.author_name = Paketfassung\.autor\(addon, addon\.freigabe\)/);
    assert.strictEqual((r.match(/author_user_id, guild_id/g) || []).length, 2, 'beide Abfragen holen guild_id');
    for (const v of ['gameserver-marketplace.ejs', 'gameserver-addon-detail.ejs']) {
        const t = ohneKommentare(fs.readFileSync(path.join(WURZEL, 'plugins/gameserver/dashboard/views/guild', v), 'utf8'));
        assert.ok(!/author_name \|\| 'Unknown'/.test(t), `${v}: „Unknown" als Rückfall steht noch da`);
        assert.match(t, /<% if \(addon\.author_name\) \{ %>/);
    }
});

console.log(`\n${bestanden} Prüfung(en) bestanden.`);
