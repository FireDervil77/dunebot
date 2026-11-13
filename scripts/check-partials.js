#!/usr/bin/env node
/**
 * Intents und Partials des Bots — und was die Partials mit den Handlern machen
 * (G-13, K382, 2026-11-13).
 *
 * Seit G-13 stehen `Partials.GuildMember` und `Partials.ThreadMember` im Client.
 * Gemessen an discord.js 14.22.1:
 *
 *   guildMemberRemove  kommt auch fuer ungecachte Mitglieder, als Partial
 *                      (`joinedAt` null, Rollen nur @everyone)
 *   guildMemberUpdate  kommt fuer ungecachte Mitglieder mit einem LEEREN alten
 *                      Mitglied (`partial`, `premiumSince` null). Vorher kam
 *                      dafuer `guildMemberAvailable`.
 *
 * Der Boost-Handler von greeting haette damit jedem boostenden, ungecachten
 * Nutzer bei jeder Aenderung erneut die Boost-Nachricht geschickt.
 *
 * Der Waechter misst Verhalten, nicht Anwesenheit: Er baut einen Client mit den
 * Partials, die in BotClient.js stehen, laesst discord.js selbst das Ereignis
 * erzeugen und ruft damit JEDEN Handler fuer guildMemberUpdate und
 * guildMemberRemove auf (Datenbank und Logger als Attrappe). Ein Handler, der
 * hier nicht eingetragen ist, ist rot — mit Erwartung eintragen, nicht
 * ueberspringen.
 *
 *   Voraussetzung  discord.js liefert bei ungecachtem Mitglied ein Partial als
 *                  altes Mitglied. Aendert sich das (Update), meldet die erste
 *                  Pruefung rot: dann ist der Waechter neu zu denken.
 *   Gegenprobe     derselbe Handler mit einem gecachten Mitglied muss weiter
 *                  wirken (sonst waere „schickt nichts“ wertlos)
 *
 * `Partials.Channel` ist bewusst nicht gesetzt (Begruendung in BotClient.js);
 * steht es irgendwann drin, meldet die Pruefung das, damit die Begruendung
 * mitgelesen wird.
 *
 *   node scripts/check-partials.js
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ohneKommentare } = require('./lib/quelltext');
const { Client, Partials, GatewayIntentBits, Status } = require('discord.js');
const { ServiceManager } = require('dunebot-core');

const WURZEL = path.join(__dirname, '..');
const BOTCLIENT = 'apps/bot/extenders/BotClient.js';

let fehler = 0;
async function pruefe(was, tun) {
    try { await tun(); console.log(`  ✓ ${was}`); }
    catch (e) { fehler++; console.log(`  ✗ ${was}\n      ${String(e.message).split('\n').slice(0, 4).join('\n      ')}`); }
}

/** Liste `schluessel: [ … ]` aus dem Konstruktor, nur die Namen hinter `Praefix.` */
function liste(quelle, schluessel, praefix) {
    const m = quelle.match(new RegExp(`\\b${schluessel}\\s*:\\s*\\[([\\s\\S]*?)\\]`));
    if (!m) throw new Error(`${schluessel}: [ … ] nicht gefunden in ${BOTCLIENT}`);
    return [...m[1].matchAll(new RegExp(`${praefix}\\.(\\w+)`, 'g'))].map((t) => t[1]);
}

const PFLICHT_INTENTS = ['GuildScheduledEvents', 'GuildWebhooks', 'GuildIntegrations', 'AutoModerationExecution', 'GuildMembers'];
const PFLICHT_PARTIALS = ['GuildMember', 'ThreadMember'];

/**
 * Jeder Handler mit Erwartung. `partialAlt`: was er mit dem leeren alten
 * Mitglied tun darf. `gegenprobe`: was er mit einem echten Fall tun muss.
 */
const HANDLER = {
    'plugins/greeting/bot/events/guildMemberUpdate.js': {
        ereignis: 'guildMemberUpdate',
        partialAlt: 'keine Abfrage, keine Nachricht (Vorher-Stand unbekannt)',
        gegenprobe: 'Mitglied ohne Boost → mit Boost: Boost-Nachricht geht raus',
    },
    'plugins/greeting/bot/events/guildMemberRemove.js': {
        ereignis: 'guildMemberRemove',
        partialAlt: 'Abschied geht raus, ohne Fehler, Name steht drin',
    },
};

/** Ein Client, eine Gilde mit Ziel-Kanal, Attrappen fuer DB und Logger. */
function aufbau(partials) {
    const client = new Client({ intents: [], partials: partials.map((p) => Partials[p]) });
    client.user = { id: '999' };
    const guild = client.guilds._add({
        id: '1', name: 'Probe', member_count: 10, channels: [], members: [],
        roles: [{ id: '1', name: '@everyone', permissions: '0', position: 0 }],
    });
    const gesendet = [];
    guild.channels.cache.set('77', { id: '77', send: async (inhalt) => { gesendet.push(inhalt); } });

    const abfragen = [];
    const fehlerLog = [];
    ServiceManager.register('dbService', {
        query: async (sql, werte) => {
            abfragen.push(sql);
            return [{
                guild_id: '1',
                boost_enabled: 1, boost_channel: '77', boost_content: 'Boost {member:name}', boost_embed: null,
                farewell_enabled: 1, farewell_channel: '77', farewell_content: 'Tschuess {member:name}', farewell_embed: null,
            }];
        },
    });
    ServiceManager.register('Logger', {
        info() {}, warn() {}, debug() {},
        error: (...a) => fehlerLog.push(a.map((x) => (x && x.message) || String(x)).join(' ')),
    });
    return { client, guild, gesendet, abfragen, fehlerLog };
}

/** Laesst discord.js selbst ein Ereignis erzeugen und gibt dessen Argumente zurueck. */
function erzeuge(client, ereignis, ausloesen) {
    let args = null;
    client.once(ereignis, (...a) => { args = a; });
    ausloesen();
    return args;
}

const NUTZER = { id: '4', username: 'nutzer', discriminator: '0', global_name: null, avatar: null };
// Ein Boost bringt die verwaltete Booster-Rolle mit ('88'). Das ist noetig:
// `GuildMember#equals` vergleicht `premiumSince` nicht — aendert sich nur
// das, sendet discord.js gar kein guildMemberUpdate (gemessen 14.22.1).
const updateDaten = (premium) => ({
    guild_id: '1', user: NUTZER, roles: premium ? ['1', '88'] : ['1'], nick: 'neu', joined_at: '2025-01-01T00:00:00Z',
    premium_since: premium ? '2026-01-01T00:00:00Z' : null,
});

(async () => {
    console.log('\nIntents und Partials (G-13)');
    const quelle = ohneKommentare(fs.readFileSync(path.join(WURZEL, BOTCLIENT), 'utf8'));
    const intents = liste(quelle, 'intents', 'GatewayIntentBits');
    const partials = liste(quelle, 'partials', 'Partials');

    await pruefe(`Intents: ${PFLICHT_INTENTS.join(', ')}`, () => {
        const fehlt = PFLICHT_INTENTS.filter((i) => !intents.includes(i));
        assert.deepStrictEqual(fehlt, [], `fehlt: ${fehlt.join(', ')}`);
        const unbekannt = intents.filter((i) => GatewayIntentBits[i] === undefined);
        assert.deepStrictEqual(unbekannt, [], `kennt discord.js nicht: ${unbekannt.join(', ')}`);
    });
    await pruefe(`Partials: ${PFLICHT_PARTIALS.join(', ')}; Channel nicht`, () => {
        const fehlt = PFLICHT_PARTIALS.filter((p) => !partials.includes(p));
        assert.deepStrictEqual(fehlt, [], `fehlt: ${fehlt.join(', ')}`);
        assert.ok(!partials.includes('Channel'),
            'Partials.Channel steht drin — Begruendung in BotClient.js lesen (in Gilden wirkungslos, bei Interaktionen DMChannel fuer Threads)');
    });

    await pruefe('Voraussetzung: ungecachtes Mitglied kommt als guildMemberUpdate mit leerem altem Mitglied', () => {
        const { client } = aufbau(partials);
        const args = erzeuge(client, 'guildMemberUpdate', () =>
            client.actions.GuildMemberUpdate.handle(updateDaten(true), { status: Status.Ready }));
        assert.ok(args, 'kein guildMemberUpdate — discord.js verhaelt sich anders als gemessen, Waechter neu denken');
        assert.strictEqual(args[0].partial, true, 'altes Mitglied ist kein Partial');
        assert.strictEqual(args[0].premiumSince, null);
    });

    // Alle Handler einsammeln, die es gibt — nicht nur die eingetragenen.
    const gefunden = [];
    for (const ort of ['apps/bot/events', ...fs.readdirSync(path.join(WURZEL, 'plugins')).map((p) => `plugins/${p}/bot/events`)]) {
        for (const name of ['guildMemberUpdate.js', 'guildMemberRemove.js']) {
            if (fs.existsSync(path.join(WURZEL, ort, name))) gefunden.push(`${ort}/${name}`);
        }
    }
    await pruefe(`jeder Handler eingetragen (${gefunden.length} gefunden)`, () => {
        const neu = gefunden.filter((f) => !HANDLER[f]);
        const weg = Object.keys(HANDLER).filter((f) => !gefunden.includes(f));
        assert.deepStrictEqual(neu, [], `nicht eingetragen (Erwartung in HANDLER ergaenzen): ${neu.join(', ')}`);
        assert.deepStrictEqual(weg, [], `eingetragen, aber nicht mehr da: ${weg.join(', ')}`);
    });

    for (const datei of gefunden.filter((f) => HANDLER[f])) {
        const { ereignis, partialAlt, gegenprobe } = HANDLER[datei];
        const handler = require(path.join(WURZEL, datei));
        const kurz = datei.replace(/^plugins\//, '').replace('/bot/events/', ': ');

        if (ereignis === 'guildMemberUpdate') {
            await pruefe(`${kurz} — ungecacht: ${partialAlt}`, async () => {
                const { client, gesendet, abfragen, fehlerLog } = aufbau(partials);
                const args = erzeuge(client, ereignis, () =>
                    client.actions.GuildMemberUpdate.handle(updateDaten(true), { status: Status.Ready }));
                await handler(...args);
                assert.deepStrictEqual(gesendet, [], `hat gesendet: ${JSON.stringify(gesendet).slice(0, 120)}`);
                assert.deepStrictEqual(abfragen, [], 'hat die Datenbank gefragt');
                assert.deepStrictEqual(fehlerLog, []);
            });
            await pruefe(`${kurz} — Gegenprobe: ${gegenprobe}`, async () => {
                const { client, guild, gesendet, fehlerLog } = aufbau(partials);
                guild.members._add(updateDaten(false));
                const args = erzeuge(client, ereignis, () =>
                    client.actions.GuildMemberUpdate.handle(updateDaten(true), { status: Status.Ready }));
                assert.strictEqual(args[0].partial, false);
                await handler(...args);
                assert.deepStrictEqual(fehlerLog, []);
                assert.strictEqual(gesendet.length, 1, `gesendet: ${gesendet.length}`);
            });
        } else {
            await pruefe(`${kurz} — ungecacht: ${partialAlt}`, async () => {
                const { client, gesendet, fehlerLog } = aufbau(partials);
                const args = erzeuge(client, ereignis, () =>
                    client.actions.GuildMemberRemove.handle({ guild_id: '1', user: NUTZER }, { status: Status.Ready }));
                assert.ok(args, 'kein guildMemberRemove fuer ungecachtes Mitglied');
                assert.strictEqual(args[0].partial, true);
                await handler(...args);
                assert.deepStrictEqual(fehlerLog, []);
                assert.strictEqual(gesendet.length, 1, `gesendet: ${gesendet.length}`);
                assert.match(JSON.stringify(gesendet[0]), /nutzer/);
            });
        }
    }

    console.log(fehler ? `\n${fehler} Pruefung(en) rot\n` : '\nalles gruen\n');
    process.exit(fehler ? 1 : 0);
})();
