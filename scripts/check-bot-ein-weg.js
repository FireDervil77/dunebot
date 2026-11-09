#!/usr/bin/env node
/**
 * Bot-Kern, Durchgang 2 (K334, 2026-11-09): ein Weg je Aufgabe.
 *
 * Gemessen vorher:
 *   - Zwei Befehlsverteiler: plugins/core/bot/handler.js (lebend) und eine
 *     ältere Kopie apps/bot/handler.js, die nur help.js nutzte.
 *   - CommandManager.registerClientEventHandlers (gut 300 Zeilen) hängte
 *     eigene Zuhörer nur an, wenn niemand auf interactionCreate hörte — das
 *     core-Plugin tut es immer, also lief er nie.
 *   - IPC: GET_STATS und GET_CMDS_SUMMARY ohne Absender, ipc/GET_USERS_DATA.js
 *     ohne Absender, ipc/BOT_HEALTH_CHECK.js und ipc/GET_GUILD_CHANNELS.js von
 *     gleichnamigen Fällen verdeckt. Bei den Kanälen war der verdeckte der
 *     bessere: Die Auswahl nach `types` (2026-08-09) wirkte nie.
 *
 *   node scripts/check-bot-ein-weg.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { ohneKommentare } = require('./lib/quelltext');

const WURZEL = path.join(__dirname, '..');
const lies = (p) => fs.readFileSync(path.join(WURZEL, p), 'utf8');
let fehler = 0;
async function pruefe(name, fn) {
    try { await fn(); console.log(`  ✓ ${name}`); }
    catch (e) { fehler++; console.log(`  ✗ ${name}\n      ${String(e.message).split('\n').join('\n      ')}`); }
}

/** Alle .js/.ejs unter Dashboard, Plugins und packages, ohne Bot-Teile. */
function absenderQuellen() {
    const aus = [];
    (function sammle(o) {
        for (const e of fs.readdirSync(path.join(WURZEL, o), { withFileTypes: true })) {
            if (['node_modules', 'vendor', 'public', 'bot'].includes(e.name)) continue;
            const p = path.join(o, e.name);
            if (e.isDirectory()) sammle(p);
            else if (/\.(js|ejs)$/.test(e.name)) aus.push(p);
        }
    })('apps/dashboard');
    // Das SDK schickt auch: BotHealthMonitor fragt dashboard:BOT_HEALTH_CHECK.
    const ordner = [...fs.readdirSync(path.join(WURZEL, 'plugins')).map(n => path.join('plugins', n)),
        ...fs.readdirSync(path.join(WURZEL, 'packages')).map(n => path.join('packages', n))];
    for (const d of ordner) {
        if (!fs.statSync(path.join(WURZEL, d)).isDirectory()) continue;
        (function sammle(o) {
            for (const e of fs.readdirSync(path.join(WURZEL, o), { withFileTypes: true })) {
                if (['node_modules', 'vendor', 'public', 'bot'].includes(e.name)) continue;
                const p = path.join(o, e.name);
                if (e.isDirectory()) sammle(p);
                else if (/\.(js|ejs)$/.test(e.name)) aus.push(p);
            }
        })(d);
    }
    return aus;
}

(async () => {
    const quellen = absenderQuellen().map(p => ohneKommentare(lies(p))).join('\n');
    const hatAbsender = (name) => new RegExp(`['"\`]dashboard:${name}['"\`]`).test(quellen);
    const client = ohneKommentare(lies('apps/bot/helpers/IPCClient.js'));
    const schalter = client.slice(client.indexOf('switch (eventName)'), client.indexOf('default: {', client.indexOf('switch (eventName)')));
    const faelle = [...schalter.matchAll(/case "([A-Z_]+)":/g)].map(m => m[1]);
    const kern = fs.readdirSync(path.join(WURZEL, 'apps/bot/ipc')).filter(f => f.endsWith('.js') && !f.startsWith('_')).map(f => f.replace('.js', ''));

    console.log('\nIPC');

    await pruefe('jeder feste dashboard:-Fall hat einen Absender', () => {
        assert.ok(faelle.length >= 10, `kaum Fälle gefunden (${faelle.length}) — die Suche misst nicht mehr`);
        assert.deepStrictEqual(faelle.filter(n => !hatAbsender(n)), []);
    });

    await pruefe('jeder Kern-Handler in apps/bot/ipc hat einen Absender', () => {
        assert.deepStrictEqual(kern.filter(n => !hatAbsender(n)), []);
    });

    await pruefe('kein Kern-Handler wird von einem festen Fall verdeckt (außer er ruft ihn selbst)', () => {
        const verdeckt = kern.filter(n => faelle.includes(n)).filter(n =>
            !new RegExp(`case "${n}":\\s*\\{[\\s\\S]{0,300}kernIpcHandlers\\?\\.get\\('${n}'\\)`).test(schalter));
        assert.deepStrictEqual(verdeckt, []);
    });

    await pruefe('GET_GUILD_CHANNELS liefert die angeforderten Typen, ohne Angabe nur Text', () => {
        const handler = require(path.join(WURZEL, 'apps/bot/ipc/GET_GUILD_CHANNELS.js'));
        const { KANAL } = require('dunebot-core').KanalTypen;
        const kanal = (id, type, viewable = true) => ({ id, name: id, type, viewable, position: Number(id.slice(1)), parentId: null, parent: null });
        const liste = [kanal('k1', KANAL.TEXT), kanal('k2', KANAL.VOICE), kanal('k3', KANAL.TEXT, false)];
        const cache = { filter: (f) => { const t = liste.filter(f); return { sort: (s) => ({ map: (m) => t.sort(s).map(m) }) }; } };
        const client = { guilds: { cache: { get: (id) => (id === 'g' ? { channels: { cache } } : undefined) } } };
        const ohne = handler({ guildId: 'g' }, client);
        assert.deepStrictEqual([ohne.success, ohne.channels.map(c => c.id)], [true, ['k1']], 'ohne types: nur sichtbare Textkanäle');
        const mit = handler({ guildId: 'g', types: [KANAL.TEXT, KANAL.VOICE] }, client);
        assert.deepStrictEqual(mit.channels.map(c => c.id), ['k1', 'k2'], 'types werden nicht befolgt');
        assert.strictEqual(handler({ guildId: 'x' }, client).success, false);
        // Und der Fall im IPCClient antwortet mit genau dieser Form, ohne Hülle.
        assert.match(schalter, /case "GET_GUILD_CHANNELS": \{[\s\S]{0,300}return message\.reply\(await handler\(payload, this\.discordClient\)\);/);
        assert.ok(!/#handleGetGuildChannels/.test(client), 'die alte Fassung steht wieder');
    });

    console.log('\nBefehle');

    await pruefe('ein Verteiler: apps/bot/handler.js, das core-Plugin lädt ihn von dort', () => {
        assert.ok(!fs.existsSync(path.join(WURZEL, 'plugins/core/bot/handler.js')), 'die Kopie im core-Plugin ist wieder da');
        const h = require(path.join(WURZEL, 'apps/bot/handler.js'));
        assert.deepStrictEqual(Object.keys(h).sort(), ['getCommandUsage', 'getSlashUsage', 'handleContext', 'handlePrefixCommand', 'handleSlashCommand']);
        for (const p of ['plugins/core/bot/events/interactionCreate.js', 'plugins/core/bot/events/messageCreate.js']) {
            assert.match(ohneKommentare(lies(p)), /require\("\.\.\/\.\.\/\.\.\/\.\.\/apps\/bot\/handler"\)/, p);
        }
        assert.match(ohneKommentare(lies('apps/bot/commands/help.js')), /require\("\.\.\/handler"\)/);
    });

    await pruefe('der CommandManager hängt keine eigenen Zuhörer an', () => {
        const s = ohneKommentare(lies('apps/bot/helpers/CommandManager.js'));
        assert.ok(!/registerClientEventHandlers/.test(s), 'registerClientEventHandlers steht wieder');
        assert.ok(!/\.on\(\s*['"](interactionCreate|messageCreate)['"]/.test(s), 'der CommandManager hört wieder selbst auf Befehle');
    });

    console.log(fehler ? `\n❌ Bot ein Weg: ${fehler} Prüfung(en) rot` : '\n✅ Bot ein Weg: alles grün');
    process.exit(fehler ? 1 : 0);
})().catch((e) => { console.error('\n❌ Der Wächter selbst ist gescheitert:', e); process.exit(1); });
