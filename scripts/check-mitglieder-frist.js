#!/usr/bin/env node
/**
 * Prueft, dass kein Abruf der Mitgliederliste unbegrenzt wartet.
 *
 * **Der Anlass.** Am 2026-08-27 meldete der Betreiber, das Speichern eines
 * Streaming-Ziels dauere sehr lange. Gemessen war das Speichern 18 ms — die
 * Zeit ging danach drauf:
 *
 *     [IPC] dashboard:GET_ALL_GUILD_MEMBERS brauchte 120003 ms
 *     [IPC] GET_ALL_GUILD_MEMBERS: 14 Members fuer Guild 565123525795643393
 *
 * **Zwei Minuten fuer vierzehn Mitglieder.** `guild.members.fetch()` ohne
 * `time` wartet die Vorgabe von discord.js ab (`_fetchMany`, `time = 120e3`),
 * und `_fetchMany` fragt **immer** ueber das Gateway — auch wenn alles schon
 * im Zwischenspeicher liegt. Dieselbe Familie wie Baustelle 76.
 *
 * Zwei Dinge werden hier festgenagelt:
 *
 *   1. Der Helfer verhaelt sich richtig — Abkuerzung bei vollem
 *      Zwischenspeicher, Frist beim Abruf, und ein Fehlschlag wird **gesagt**
 *      statt als halbe Liste ausgeliefert (die Lehre aus `49dda5a`).
 *   2. Kein Aufrufer im Bot geht am Helfer vorbei und holt die ganze Liste
 *      wieder ohne Frist.
 *
 * Nebenwirkungsfrei: Attrappen, kein Discord, keine Datenbank.
 *
 *   node scripts/check-mitglieder-frist.js
 *
 * Exitcode 1 bei jeder Abweichung.
 */
'use strict';

const fs = require('fs');
const path = require('path');

let faelle = 0;
let abweichungen = 0;

/**
 * @param {boolean} gut Bedingung
 * @param {string} text Beschreibung
 * @param {string} [zusatz] Ergaenzung
 * @returns {void}
 */
function pruefe(gut, text, zusatz = '') {
    faelle++;
    if (!gut) abweichungen++;
    console.log(`  ${gut ? '✓' : '✗'} ${text}${zusatz ? '  — ' + zusatz : ''}`);
}

const Mitglieder = require('../apps/bot/helpers/Mitglieder');

/**
 * Eine Guild-Attrappe mit Mitschrift.
 *
 * @param {Object} opt Angaben
 * @returns {Object} Guild
 */
function guildAttrappe({ memberCount = 10, imSpeicher = 0, wirft = null, holtNach = 0 }) {
    const cache = new Map();
    for (let i = 0; i < imSpeicher; i++) cache.set(String(i), { id: String(i) });
    cache.map = function (fn) { return [...this.values()].map(fn); };

    const mitschrift = { aufrufe: [] };
    return {
        id: 'g1',
        memberCount,
        mitschrift,
        members: {
            cache,
            async fetch(opt) {
                mitschrift.aufrufe.push(opt);
                if (wirft) throw new Error(wirft);
                for (let i = cache.size; i < holtNach; i++) cache.set(String(i), { id: String(i) });
                return cache;
            }
        }
    };
}

const stillesProtokoll = { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} };

(async () => {

console.log('\nWas schon da ist, wird nicht geholt');
{
    const g = guildAttrappe({ memberCount: 10, imSpeicher: 10 });
    const e = await Mitglieder.holen(g, stillesProtokoll);
    pruefe(g.mitschrift.aufrufe.length === 0,
        'voller Zwischenspeicher: kein Abruf ueber das Gateway',
        `${g.mitschrift.aufrufe.length} Aufruf(e)`);
    pruefe(e.vollstaendig === true, 'und die Antwort sagt "vollstaendig"');

    const g2 = guildAttrappe({ memberCount: 10, imSpeicher: 10 });
    await Mitglieder.holen(g2, stillesProtokoll, { erzwingen: true });
    pruefe(g2.mitschrift.aufrufe.length === 1,
        'mit `erzwingen` wird trotzdem gefragt');
}

console.log('\nJeder Abruf traegt eine Frist');
{
    const g = guildAttrappe({ memberCount: 10, imSpeicher: 3, holtNach: 10 });
    await Mitglieder.holen(g, stillesProtokoll);

    const opt = g.mitschrift.aufrufe[0];
    pruefe(Boolean(opt) && typeof opt.time === 'number',
        'die Frist wird mitgegeben', JSON.stringify(opt));
    pruefe(Boolean(opt) && opt.time > 0 && opt.time < 120000,
        'und sie ist kuerzer als die Vorgabe von discord.js (120 000 ms)',
        opt ? `${opt.time} ms` : '—');

    // `force` bei einem Vollabruf ist wirkungslos (GuildMemberManager.fetch
    // reicht es nur an `_fetchSingle`). Es mitzugeben taeuscht eine Wirkung
    // vor, die es nicht hat.
    pruefe(Boolean(opt) && !('force' in opt),
        'und `force` wird nicht mitgegeben — beim Vollabruf ist es wirkungslos');
}

console.log('\nEin Fehlschlag wird gesagt, nicht verschluckt');
{
    const g = guildAttrappe({ memberCount: 10, imSpeicher: 4, wirft: 'Members didn\'t arrive in time' });
    const gesagt = [];
    const e = await Mitglieder.holen(g, { ...stillesProtokoll, warn: (t) => gesagt.push(t) });

    pruefe(e.vollstaendig === false, 'die Antwort sagt "unvollstaendig"');
    pruefe(Boolean(e.grund), 'und nennt einen Grund', String(e.grund));
    pruefe(e.mitglieder.size === 4,
        'die angekommenen Eintraege gehen trotzdem mit — aber als das, was sie sind',
        `${e.mitglieder.size} Eintraege`);
    pruefe(gesagt.length === 1, 'es steht genau eine Zeile im Protokoll');
    pruefe(gesagt[0].includes('4') && gesagt[0].includes('10'),
        'und die Zeile nennt beide Zahlen', gesagt[0]);
}

console.log('\nEine zu kurze Liste gilt als unvollstaendig');
{
    const g = guildAttrappe({ memberCount: 10, imSpeicher: 0, holtNach: 6 });
    const e = await Mitglieder.holen(g, stillesProtokoll);
    pruefe(e.vollstaendig === false,
        'sechs von zehn ist nicht vollstaendig, auch ohne Ausnahmefehler');
}

console.log('\nOhne bekannte Mitgliederzahl wird nicht gelogen');
{
    // Sehr grosse Guilds liefern `memberCount` nicht immer. Dann laesst sich
    // Vollstaendigkeit nicht feststellen — "unvollstaendig" zu behaupten waere
    // genauso falsch wie "vollstaendig".
    const g = guildAttrappe({ memberCount: 0, imSpeicher: 0, holtNach: 5 });
    const e = await Mitglieder.holen(g, stillesProtokoll);
    pruefe(g.mitschrift.aufrufe.length === 1, 'ohne Zahl wird geholt');
    pruefe(e.vollstaendig === true,
        'und das Ergebnis gilt als vollstaendig — mehr wissen wir nicht');

    const leer = await Mitglieder.holen(null, stillesProtokoll);
    pruefe(leer.vollstaendig === false && leer.mitglieder.size === 0,
        'ohne Guild kommt eine leere Liste, aber ausdruecklich unvollstaendig');
}

console.log('\nNiemand geht am Helfer vorbei');
{
    // **Die eigentliche Regel.** Ein einziger vergessener Vollabruf haelt
    // wieder zwei Minuten — und zwar an einer Stelle, die niemand vermutet.
    const dateien = [];
    const sammle = (verz) => {
        for (const e of fs.readdirSync(verz, { withFileTypes: true })) {
            const voll = path.join(verz, e.name);
            if (e.isDirectory()) { if (e.name !== 'node_modules') sammle(voll); }
            else if (e.name.endsWith('.js')) dateien.push(voll);
        }
    };
    sammle(path.join(__dirname, '../apps/bot'));
    // Die Plugins gehoeren mit dazu: `plugins/*/bot/` laeuft im selben Vorgang
    // und kann denselben Abruf genauso unbegrenzt stellen.
    const pluginVerz = path.join(__dirname, '../plugins');
    for (const e of fs.readdirSync(pluginVerz, { withFileTypes: true })) {
        const botVerz = path.join(pluginVerz, e.name, 'bot');
        if (e.isDirectory() && fs.existsSync(botVerz)) sammle(botVerz);
    }

    const treffer = [];
    for (const datei of dateien) {
        if (datei.endsWith('helpers/Mitglieder.js')) continue;
        const roh = fs.readFileSync(datei, 'utf8');
        const code = roh.replace(/\/\*[\s\S]*?\*\//g, '')
            .split('\n').filter(z => !z.trim().startsWith('//')).join('\n');

        // **Was ein Vollabruf ist, entscheidet `GuildMemberManager.fetch`:**
        // Ohne Argument, oder mit einem Objektliteral, das weder `user` noch
        // `query` nennt — nur diese landen in `_fetchMany` und damit in der
        // 120-Sekunden-Vorgabe. Alles andere (eine Kennung, eine Variable, ein
        // Ausdruck) ist ein Einzelabruf ueber `_fetchSingle` und geht ueber
        // HTTP, nicht ueber das Gateway.
        //
        // Die erste Fassung dieser Regel meldete `members.fetch(newGuild.ownerId)`
        // — ein Einzelabruf. Eine Regel, die Richtiges meldet, wird
        // weggeklickt und ist dann wertlos.
        for (const m of code.matchAll(/members\s*\.\s*fetch\(([^)]*)\)/g)) {
            const arg = m[1].trim();
            const vollabruf = arg === '' || (arg.startsWith('{') && !/\buser\b|\bquery\b/.test(arg));
            if (!vollabruf) continue;
            if (/\btime\b/.test(arg)) continue;
            treffer.push(`${path.relative(path.join(__dirname, '..'), datei)}: members.fetch(${arg})`);
        }
    }

    pruefe(treffer.length === 0,
        'kein Vollabruf der Mitgliederliste ohne Frist im Bot',
        treffer.length ? treffer.join(' | ') : `${dateien.length} Dateien durchgesehen`);
}

console.log('\nDie Frist reicht bis zum Dashboard');
{
    const ipcQuelle = fs.readFileSync(
        path.join(__dirname, '../apps/dashboard/helpers/IPCServer.js'), 'utf8');
    pruefe(/async broadcast\(event, data, receptive = true, \{ timeout/.test(ipcQuelle),
        '`broadcast` nimmt eine Frist entgegen',
        'sonst haelt ein haengender Bot die Seite unbegrenzt fest');
    pruefe(/\{ receptive, timeout \}/.test(ipcQuelle),
        'und reicht sie an veza durch — sonst waere der Parameter Zierde');

    const sharedQuelle = fs.readFileSync(
        path.join(__dirname, '../plugins/streaming/dashboard/routes/_shared.js'), 'utf8');
    pruefe(/timeout:\s*fristMs/.test(sharedQuelle),
        '`fragBot` setzt sie auch wirklich',
        'die Vorgabe von veza bleibt -1, also muss jeder Aufrufer selbst ran');
}

console.log(abweichungen === 0
    ? `\nErgebnis: ${faelle} Pruefungen, 0 Abweichungen.\n`
    : `\nErgebnis: ${faelle} Pruefungen, ${abweichungen} Abweichung(en).\n`);

process.exit(abweichungen === 0 ? 0 : 1);

})().catch(err => { console.error('\nAbbruch:', err.message, '\n', err.stack); process.exit(1); });
