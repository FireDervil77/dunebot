#!/usr/bin/env node
/**
 * Bot-Ereignisse finden ihre Guild, auch bei Sammlungen (K394, 2026-11-15).
 *
 * Der PluginManager des Bots reicht ein Discord-Ereignis nur an Plugins
 * weiter, die in der Guild des Ereignisses an sind. Findet er keine Guild,
 * bekommt es nur der Kern, lautlos. So erreichte `messageDeleteBulk` (erstes
 * Argument eine Sammlung, zweites der Kanal) nie ein Plugin: Leveling
 * stornierte die XP von `/clear` nicht, und der Handler von gameserver lief nie.
 *
 * Geprüft wird:
 *
 *   1  Formen      `PluginManager.guildIdAus` findet die Guild an Message,
 *                  Interaction, Reaktion (an der Nachricht), VoiceState,
 *                  Guild selbst, Sammlung + Kanal, Sammlung + Guild,
 *                  zwei Sammlungen + Thread (`threadMembersUpdate`, 2026-11-16)
 *                  (`guildMembersChunk`), Protokolleintrag + Guild
 *                  (`guildAuditLogEntryCreate`); ohne Guild `null`, nie die ID der
 *                  Nachricht, des Kanals oder des Nutzers
 *   2  Verdrahtung `emit` liest die Guild über `guildAus`/`guildIdAus`
 *   3  Handler     jeder `messageDeleteBulk`-Handler eines Plugins nimmt die
 *                  Sammlung als erstes Argument (nicht eine Nachricht)
 *   4  Gegenprobe  ohne die Sammlungs-Regel ist 1 rot
 *   5  Anmelden    jedes Plugin-Ereignis kommt am Client an, auch wenn das
 *                  Plugin erst nach dem Start zum ersten Mal eingeschaltet
 *                  wird (2026-11-16, gefunden an Logging: `roleCreate` kam
 *                  bis zum Neustart nie an); je Ereignis einmal, `ready` nie;
 *                  `bot.js` meldet über `meldeEreignisseAn`, nicht mehr selbst
 *
 *   node scripts/check-ereignis-guild.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const WURZEL = path.join(__dirname, '..');
const { ohneKommentare } = require('./lib/quelltext');

let fehler = 0;
function pruefe(was, tun) {
    try { tun(); console.log(`  ✓ ${was}`); }
    catch (e) { fehler++; console.log(`  ✗ ${was}\n      ${String(e.message).split('\n').slice(0, 10).join('\n      ')}`); }
}

const G = '100000000000000001';
// Eine Guild erkennt man an ihren Verwaltern; Nachricht, Kanal und Nutzer haben sie nicht.
const guild = { id: G, name: 'Probe', members: {}, channels: {}, roles: {} };

/** Je Ereignis die Argumente, wie discord.js 14 sie gibt. */
const FORMEN = [
    ['messageCreate (Message)', [{ id: '1', guildId: G, guild }]],
    ['messageDelete (Partial ohne Guild-Objekt)', [{ id: '1', guildId: G, guild: null, partial: true }]],
    ['interactionCreate', [{ guildId: G, guild }]],
    ['messageReactionAdd (Reaktion, Guild an der Nachricht)', [{ message: { guildId: G, guild } }, { id: '2' }]],
    ['voiceStateUpdate', [{ guild, channelId: '3' }, { guild, channelId: null }]],
    ['guildUpdate (Guild selbst)', [guild, guild]],
    ['messageDeleteBulk (Sammlung + Kanal)', [new Map([['1', { id: '1', guildId: G }]]), { id: '4', guildId: G, guild }]],
    ['messageDeleteBulk (leere Sammlung + Kanal)', [new Map(), { id: '4', guildId: G }]],
    ['guildMembersChunk (Sammlung + Guild)', [new Map(), guild, {}]],
    ['threadMembersUpdate (zwei Sammlungen + Thread)', [new Map(), new Map([['9', { id: '9' }]]), { id: '10', guildId: G, guild }]],
    ['guildAuditLogEntryCreate (Eintrag ohne Guild + Guild)', [{ id: '7', action: 1, targetId: '8' }, guild]],
];

function pruefeFormen(PM) {
    const aus = [];
    for (const [was, args] of FORMEN) {
        const id = PM.guildIdAus(args);
        if (id !== G) aus.push(`${was}: ${id}`);
    }
    const ohne = [
        ['ohne Argumente', []],
        ['DM-Nachricht', [{ id: '1', guildId: null, guild: null }]],
        ['userUpdate (Nutzer)', [{ id: '5', username: 'x' }, { id: '5', username: 'y' }]],
        ['messageDeleteBulk mit DM-Kanal', [new Map(), { id: '6', guildId: null, guild: null }]],
    ];
    for (const [was, args] of ohne) {
        const id = PM.guildIdAus(args);
        if (id != null) aus.push(`${was}: ${id} statt null`);
    }
    return aus;
}

/** Startstand anmelden, danach ein neues Plugin aufnehmen: alles muss am Client ankommen. */
function pruefeAnmelden(Klasse) {
    const pm = new Klasse({}, path.join(WURZEL, 'plugins'));
    const angemeldet = [];
    pm.nimmEreignisseAuf({ name: 'alt', eventHandlers: new Map([['guildMemberUpdate', () => {}], ['ready', () => {}]]) });
    pm.meldeEreignisseAn({}, (e) => angemeldet.push(e));
    pm.nimmEreignisseAuf({ name: 'neu', eventHandlers: new Map([['roleCreate', () => {}], ['guildMemberUpdate', () => {}]]) });
    pm.nimmEreignisseAuf({ name: 'noch', eventHandlers: new Map([['roleCreate', () => {}]]) });
    pm.meldeEreignisseAn({}, (e) => angemeldet.push('doppelt:' + e));
    assert.deepStrictEqual(angemeldet, ['guildMemberUpdate', 'roleCreate'], 'je Ereignis einmal, ready nie, spätere sofort');
}

console.log('\nBot-Ereignisse und ihre Guild (K394)');
const PM = require(path.join(WURZEL, 'apps/bot/helpers/PluginManager.js'));
const quelle = fs.readFileSync(path.join(WURZEL, 'apps/bot/helpers/PluginManager.js'), 'utf8');

pruefe('1. guildIdAus findet die Guild in jeder Form', () => {
    assert.deepStrictEqual(pruefeFormen(PM), []);
});

pruefe('2. emit liest die Guild über guildAus/guildIdAus', () => {
    const code = ohneKommentare(quelle);
    const ab = code.indexOf('async emit(');
    assert.ok(ab > 0, 'emit nicht gefunden');
    const rumpf = code.slice(ab, code.indexOf('\n    }\r\n', ab) > 0 ? code.indexOf('\n    }\r\n', ab) : code.indexOf('\n    }\n', ab));
    assert.match(rumpf, /PluginManager\.guildIdAus\(args\)/);
    assert.match(rumpf, /PluginManager\.guildAus\(args\)/);
    assert.doesNotMatch(rumpf, /args\[0\]/, 'emit greift wieder selbst auf args[0]');
});

pruefe('3. jeder messageDeleteBulk-Handler nimmt die Sammlung als erstes Argument', () => {
    const aus = [];
    let gefunden = 0;
    for (const p of fs.readdirSync(path.join(WURZEL, 'plugins'))) {
        const datei = path.join(WURZEL, 'plugins', p, 'bot/events/messageDeleteBulk.js');
        if (!fs.existsSync(datei)) continue;
        gefunden++;
        const code = ohneKommentare(fs.readFileSync(datei, 'utf8'));
        if (!/\.values\??\.\(\)/.test(code)) aus.push(`${p}: liest die Sammlung nicht (.values())`);
    }
    assert.ok(gefunden >= 2, `nur ${gefunden} Handler gefunden (leveling, gameserver erwartet)`);
    assert.deepStrictEqual(aus, []);
});

pruefe('5. Ereignisse eines später eingeschalteten Plugins kommen am Client an, je einmal', () => {
    const { ServiceManager } = require('dunebot-core');
    if (!ServiceManager.has?.('Logger')) ServiceManager.register('Logger', { debug() {}, info() {}, warn() {}, error() {}, success() {} });
    pruefeAnmelden(PM);
    const bot = ohneKommentare(fs.readFileSync(path.join(WURZEL, 'apps/bot/bot.js'), 'utf8'));
    assert.match(bot, /pluginManager\.meldeEreignisseAn\(client,/, 'bot.js meldet nicht über meldeEreignisseAn');
    assert.doesNotMatch(bot, /listeningEvents\.forEach/, 'bot.js meldet wieder selbst nur den Startstand an');
    const pmCode = ohneKommentare(quelle);
    assert.match(pmCode, /this\.nimmEreignisseAuf\(plugin\)/, 'Anmeldeweg ruft nimmEreignisseAuf nicht');
});

console.log('\nGegenprobe');
pruefe('rot: ohne die Sammlungs-Regel', () => {
    const alt = {
        traegerAus: (args) => args?.[0] ?? null,
        guildAus(args) { const t = this.traegerAus(args); return t?.guild || t?.message?.guild || (t?.members && t?.channels && t?.roles ? t : null); },
        guildIdAus(args) { const t = this.traegerAus(args); return this.guildAus(args)?.id || t?.guildId || t?.message?.guildId || null; },
    };
    const rot = pruefeFormen(alt);
    assert.ok(rot.some((z) => z.startsWith('messageDeleteBulk')), `bleibt grün: ${JSON.stringify(rot)}`);
});
pruefe('rot: Rückfall auf den Träger selbst (alter Stand)', () => {
    const alt = {
        traegerAus: (args) => (args?.[0] instanceof Map ? args[1] : args?.[0]) ?? null,
        guildAus(args) { const t = this.traegerAus(args); return t?.guild || t?.message?.guild || t; },
        guildIdAus(args) { const t = this.traegerAus(args); return this.guildAus(args)?.id || t?.guildId || t?.message?.guildId || null; },
    };
    const rot = pruefeFormen(alt);
    assert.ok(rot.some((z) => z.startsWith('DM-Nachricht')) && rot.some((z) => z.startsWith('userUpdate')), `bleibt grün: ${JSON.stringify(rot)}`);
});

pruefe('rot: nach einer Sammlung nur das zweite Argument (Stand K394)', () => {
    const alt = {
        traegerAus: (args) => (args?.[0] instanceof Map ? args[1] : args?.[0]) ?? null,
        guildAus: PM.guildAus,
        guildIdAus(args) { const t = this.traegerAus(args); return t?.guild?.id || t?.guildId || null; },
    };
    const rot = pruefeFormen(alt);
    assert.ok(rot.some((z) => z.startsWith('threadMembersUpdate')), `bleibt grün: ${JSON.stringify(rot)}`);
});

pruefe('rot: Anmelden nur mit dem Startstand (alter Stand)', () => {
    class Alt extends PM { nimmEreignisseAuf(plugin) { plugin.eventHandlers?.forEach((h, e) => this.listeningEvents.add(e)); } }
    let rot = false;
    try { pruefeAnmelden(Alt); } catch { rot = true; }
    assert.ok(rot, 'bleibt grün');
});

console.log(fehler ? `\n✗ ${fehler} Prüfung(en) rot` : '\n✓ alles grün');
process.exit(fehler ? 1 : 0);
