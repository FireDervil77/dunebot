#!/usr/bin/env node
/**
 * Interne Plugins gibt es nur in der Kontroll-Guild (2026-11-02).
 *
 * Die Werkbank ist „vorerst nur wir" (W-2), stand aber in der Pluginliste jeder
 * Guild. Gemeint war dafür eine `config.json` mit `BOT_OWNER_ID`, die kein Plugin
 * hatte: Die Prüfung griff nie. Und die Route fragte gar nicht, ob ein Plugin in
 * einer Guild eingeschaltet ist, geschützt war sie nur durch die Rechte, die sich
 * ein fremder Admin über die Liste selbst hätte holen können.
 *
 * Jetzt zählt `"nurKontrollGuild": true` in der package.json, eine Regel in
 * `BasePluginManager.istVerfuegbar`, geprüft am Einschalten selbst.
 *
 * Nichts wird geschrieben.
 *
 *   node scripts/check-nur-kontrollguild.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { ohneKommentare } = require('./lib/quelltext');

const WURZEL = path.join(__dirname, '..');
const lies = (d) => ohneKommentare(fs.readFileSync(path.join(WURZEL, d), 'utf8'));
const { BasePluginManager } = require('dunebot-core');

let fehler = 0;
function pruefe(was, tun) {
    try { tun(); console.log(`  ✓ ${was}`); }
    catch (e) { fehler++; console.log(`  ✗ ${was}\n      ${String(e.message).split('\n').join('\n      ')}`); }
}

const manager = Object.create(BasePluginManager.prototype);
manager.pluginsDir = path.join(WURZEL, 'plugins');
const KONTROLLE = '111';
const FREMD = '222';
const mitKontrolle = (wert, tun) => {
    const vorher = process.env.CONTROL_GUILD_ID;
    if (wert === null) delete process.env.CONTROL_GUILD_ID; else process.env.CONTROL_GUILD_ID = wert;
    try { tun(); } finally {
        if (vorher === undefined) delete process.env.CONTROL_GUILD_ID; else process.env.CONTROL_GUILD_ID = vorher;
    }
};

console.log('Die Regel');
pruefe('die Werkbank ist als intern ausgezeichnet', () => {
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(WURZEL, 'plugins/werkbank/package.json'))).nurKontrollGuild, true);
});
pruefe('die Werkbank gibt es in der Kontroll-Guild, in einer fremden nicht', () => mitKontrolle(KONTROLLE, () => {
    assert.strictEqual(manager.istVerfuegbar('werkbank', KONTROLLE), true);
    assert.strictEqual(manager.istVerfuegbar('werkbank', FREMD), false);
    assert.strictEqual(manager.istVerfuegbar('werkbank', Number(KONTROLLE)), true, 'Zahl gegen Text');
}));
pruefe('ohne gesetzte Kontroll-Guild gibt es sie nirgends', () => mitKontrolle(null, () => {
    assert.strictEqual(manager.istVerfuegbar('werkbank', KONTROLLE), false);
}));
pruefe('alle anderen Plugins bleiben für jede Guild da', () => mitKontrolle(KONTROLLE, () => {
    const andere = fs.readdirSync(manager.pluginsDir, { withFileTypes: true })
        .filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'werkbank').map(e => e.name);
    assert.ok(andere.length > 5);
    for (const name of andere) assert.strictEqual(manager.istVerfuegbar(name, FREMD), true, name);
}));

console.log('\nJeder Weg');
pruefe('beide Manager prüfen am Einschalten selbst', () => {
    for (const d of ['apps/dashboard/helpers/PluginManager.js', 'apps/bot/helpers/PluginManager.js']) {
        const t = ohneKommentare(lies(d));
        const kopf = t.indexOf('async enableInGuild(');
        assert.ok(kopf > 0, d);
        assert.match(t.slice(kopf, kopf + 260), /if \(!this\.istVerfuegbar\(pluginName, guildId\)\)\s*\{\s*throw/, d);
    }
});
pruefe('Liste und Schalter im Dashboard fragen die Regel, der tote Weg ist weg', () => {
    const t = ohneKommentare(lies('apps/dashboard/controllers/guild.controller.js'));
    assert.strictEqual((t.match(/pluginManager\.istVerfuegbar\(pluginName, guildId\)/g) || []).length, 2);
    assert.ok(!/BOT_OWNER_ID/.test(t), 'config.json-Weg: Den hatte kein Plugin');
});
pruefe('die Route einer fremden Guild gibt 404', () => {
    const t = ohneKommentare(lies('apps/dashboard/routes/guild.router.js'));
    assert.match(t, /istVerfuegbar\(plugin\.name, req\.params\.guildId\)\)\s*\{\s*return res\.status\(404\)/);
    assert.ok(t.indexOf('istVerfuegbar') < t.indexOf('!plugin.guildRouter'), 'die Prüfung muss vor dem Router stehen');
});
pruefe('die öffentliche Startseite zeigt interne Plugins nicht', () => {
    assert.match(lies('apps/dashboard/controllers/frontend.controller.js'), /packageJson\.nurKontrollGuild === true\) return null/);
});
pruefe('der Bot-Befehl `plugin` bietet sie fremden Guilds nicht an', () => {
    const t = ohneKommentare(lies('apps/bot/commands/plugin.js'));
    // Drei Listen: list, info, status. `status` nahm bis 2026-11-07 zwei (Menü
    // und Verarbeitung), seitdem eine — `waehlbar` — für beides (F4).
    assert.strictEqual((t.match(/pluginManager\.plugins[\s\S]{0,40}\.filter\(\(?p\)? => !p\.ownerOnly/g) || []).length, 3, 'drei Listen');
    assert.strictEqual((t.match(/istVerfuegbar\(p\.name, guild\.id\)/g) || []).length, 3);
    assert.match(t, /const kandidaten = waehlbar\.filter/, 'status verarbeitet nicht die gefilterte Liste');
});

console.log(fehler ? `\n❌ ${fehler} Prüfung(en) rot` : '\n✅ Interne Plugins bleiben in der Kontroll-Guild');
process.exit(fehler ? 1 : 0);
