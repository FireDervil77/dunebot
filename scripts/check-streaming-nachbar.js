#!/usr/bin/env node
'use strict';

/**
 * Streaming fragt die Guild, nicht den Registry-Eintrag (K367, K368, K369).
 *
 * ## Worum es geht
 *
 * Verlosungen, Musik und Gameserver tragen sich beim Laden in eine Registry des
 * SDK ein. Der Eintrag steht im **ganzen Prozess**, sobald das Plugin in
 * irgendeiner Guild geladen ist. Bis zum 2026-11-10 hielt Streaming ihn fuer die
 * Antwort auf "ist es hier an?":
 *
 * - die Mitmachen-Seite las „gerade keine Verlosung“ statt „gibt es hier nicht“,
 * - der Stream-Player legte aus der Musikablage einer Guild nach, in der Musik
 *   aus war,
 * - beim Streamende wurden Server einer Guild gestoppt, in der Gameserver aus
 *   war.
 *
 * Nur die Chat-Befehle fragten die Guild, mit eigenem Code. Jetzt steht die
 * Frage an einer Stelle: `Nachbar.pluginAn` im SDK (bis G-03, 2026-11-13, in
 * `plugins/streaming/shared/nachbar.js`).
 *
 * ## Was hier geprueft wird
 *
 * 1. **Verhalten:** Eintrag da, Plugin in dieser Guild aus → `ablage()` und
 *    `anbieter()` geben `null`. In der anderen Guild geben sie den Eintrag.
 *    Ohne `pluginManager` nicht raten → `null`.
 * 2. **Quelltext:** `isPluginEnabledForGuild` steht im Streaming-Plugin nur in
 *    `dashboard/entwuerfe.js` (nur als Text); die Registry-Eintraege werden
 *    nur an den Stellen gelesen, die danach die Guild fragen. Ein neuer Weg an
 *    der Schranke vorbei faellt hier auf.
 * 3. **Eine Stelle (G-03):** `pluginAn` ist nur im SDK erklaert, und eine Datei
 *    `nachbar.js` gibt es nur dort. Eine zweite Antwort auf dieselbe Frage
 *    faellt hier auf, auch ausserhalb von Streaming.
 *
 *     node scripts/check-streaming-nachbar.js
 */

const fs = require('fs');
const path = require('path');
const WURZEL = path.resolve(__dirname, '..');
const { ServiceManager } = require(path.join(WURZEL, 'node_modules/dunebot-core'));
const sdk = require(path.join(WURZEL, 'node_modules/dunebot-sdk'));
const { ohneKommentare } = require('./lib/quelltext');

let faelle = 0, abweichungen = 0;
function pruefe(gut, text, zusatz = '') {
    faelle++;
    if (!gut) abweichungen++;
    console.log(`  ${gut ? '✓' : '✗'} ${text}${zusatz ? '  — ' + zusatz : ''}`);
}

(async () => {

ServiceManager.register('Logger', {
    info: () => {}, debug: () => {}, warn: () => {}, error: () => {}, success: () => {}
});
ServiceManager.register('dbService', { async query() { return []; } });

const nachbar = sdk.Nachbar;
const musik = require(path.join(WURZEL, 'plugins/streaming/shared/musikwunsch'));
const serverstopp = require(path.join(WURZEL, 'plugins/streaming/dashboard/kern/serverstopp'));

const ABLAGE = {
    label: 'Attrappe',
    async suchen() { return []; }, async stueck() { return null; }, async tonquelle() { return null; }
};
const ANBIETER = { async server() { return []; }, async zustand() { return null; }, async stoppen() { return { ok: true }; } };

sdk.MusikablageRegistry.leeren();
sdk.MusikablageRegistry.register('music', ABLAGE);
sdk.ServersteuerungRegistry.register('gameserver', ANBIETER);

console.log('\n1. Ohne pluginManager wird nicht geraten');
{
    const s = await nachbar.pluginAn('music', 'g1');
    pruefe(s.pruefbar === false && s.an === false, 'pluginAn: nicht prüfbar, nicht an', JSON.stringify(s));
    pruefe(await musik.ablage('g1') === null, 'ablage(): null, obwohl der Eintrag steht');
    pruefe(await serverstopp.anbieter('g1') === null, 'anbieter(): null, obwohl der Eintrag steht');
}

// Musik nur in g-musik an, Gameserver nur in g-server.
const AN = { music: ['g-musik'], gameserver: ['g-server'] };
const gefragt = [];
ServiceManager.register('pluginManager', {
    async isPluginEnabledForGuild(plugin, guildId) {
        gefragt.push(`${plugin}@${guildId}`);
        return (AN[plugin] || []).includes(guildId);
    }
});

console.log('\n2. Musikablage: Eintrag steht prozessweit, gefragt wird die Guild (K368)');
pruefe(await musik.ablage('g-musik') === ABLAGE, 'Guild mit Musik an: die Ablage');
pruefe(await musik.ablage('g-server') === null, 'Guild mit Musik aus: null', gefragt.join(', '));
pruefe(gefragt.includes('music@g-server'), 'und gefragt wurde genau diese Guild');
{
    const e = await musik.ablageEinreihen('g-server');
    pruefe(e.ok === false && e.grund === 'keine_ablage', 'Einreihen in der Guild ohne Musik: keine_ablage', JSON.stringify(e));
    pruefe(await musik.nachlegen('g-server') === false, 'Nachlegen in der Guild ohne Musik: nichts');
}

console.log('\n3. Serversteuerung: Eintrag steht prozessweit, gefragt wird die Guild (K369)');
pruefe(await serverstopp.anbieter('g-server') === ANBIETER, 'Guild mit Gameserver an: der Anbieter');
pruefe(await serverstopp.anbieter('g-musik') === null, 'Guild mit Gameserver aus: null');
pruefe(gefragt.includes('gameserver@g-musik'), 'und gefragt wurde genau diese Guild');
pruefe(await serverstopp.anbieter(undefined) === null, 'ohne Guild: null');

console.log('\n4. Quelltext: kein Weg an der Schranke vorbei');
{
    const ORDNER = path.join(WURZEL, 'plugins/streaming');
    const dateien = [];
    (function lauf(d) {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            if (['node_modules', 'backups', 'public', 'assets'].includes(e.name)) continue;
            const p = path.join(d, e.name);
            if (e.isDirectory()) lauf(p);
            else if (e.name.endsWith('.js')) dateien.push(p);
        }
    })(ORDNER);

    /** Wo welches Muster stehen darf (Pfad relativ zum Plugin). */
    const ERLAUBT = [
        // `entwuerfe.js` nennt den Namen nur als Text in einer Zeichenkette
        // (Entwurfsseite: „wo“ eine Sache nachgesehen wird), ruft ihn nicht.
        { muster: /isPluginEnabledForGuild\s*\(/, nur: ['dashboard/entwuerfe.js'] },
        { muster: /MusikablageRegistry\s*\.\s*fuerStream\s*\(/, nur: ['shared/musikwunsch.js'] },
        { muster: /ServersteuerungRegistry\s*\.\s*get\s*\(/, nur: ['dashboard/kern/serverstopp.js'] },
        { muster: /LosquellenRegistry\s*\.\s*dienst\s*\(/, nur: ['dashboard/kern/mitmachen.js'] }
    ];

    for (const { muster, nur } of ERLAUBT) {
        const fremd = [];
        for (const p of dateien) {
            const rel = path.relative(ORDNER, p).split(path.sep).join('/');
            if (nur.includes(rel)) continue;
            if (muster.test(ohneKommentare(fs.readFileSync(p, 'utf8')))) fremd.push(rel);
        }
        pruefe(fremd.length === 0, `${muster.source.split('\\')[0]} nur in ${nur.join(', ')}`, fremd.join(', '));
    }

    // Die zwei Schranken selbst: Wer `ablage(` oder `anbieter(` ohne Guild
    // ruft, fragt "irgendeine Guild" - genau der alte Fehler.
    const ohneGuild = [];
    for (const p of dateien) {
        const rel = path.relative(ORDNER, p).split(path.sep).join('/');
        const code = ohneKommentare(fs.readFileSync(p, 'utf8'));
        // Auch der schlichte Aufruf in derselben Datei (`ablage()`), nicht nur
        // `musik.ablage()` - die Erklaerung `function ablage(` zaehlt nicht.
        for (const m of code.matchAll(/(?<!function\s+)(?<![\w$])(?:musik\s*\.\s*|serverstopp\s*\.\s*)?(ablage|anbieter)\s*\(\s*\)/g)) {
            ohneGuild.push(`${rel}: ${m[0]}`);
        }
    }
    pruefe(ohneGuild.length === 0, 'ablage() und anbieter() werden immer mit Guild gerufen', ohneGuild.join(' | '));

    // mitmachen: der Eintrag erst nach der Guild-Schranke.
    const mm = ohneKommentare(fs.readFileSync(path.join(ORDNER, 'dashboard/kern/mitmachen.js'), 'utf8'));
    const anfang = mm.indexOf('async function verlosungsstand');
    const rumpf = mm.slice(anfang, mm.indexOf('\n}', anfang));
    const schranke = rumpf.search(/verfuegbar\s*\(\s*guildId/);
    const eintrag = rumpf.search(/LosquellenRegistry\s*\.\s*dienst\s*\(/);
    pruefe(anfang >= 0 && schranke >= 0 && eintrag > schranke,
        'verlosungsstand fragt die Guild vor dem Eintrag (K367)', `Schranke ${schranke}, Eintrag ${eintrag}`);
}

console.log('\n5. Eine Stelle: pluginAn und nachbar.js nur im SDK (G-03)');
{
    const SOLL = 'packages/dunebot-sdk/lib/nachbar.js';
    // Nur der Code, der laeuft: `scripts/` traegt Gegenproben als Text.
    const alle = [];
    const lauf = (d) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            if (['node_modules', 'backups', 'public', 'assets', 'vendor'].includes(e.name) || e.name.startsWith('.')) continue;
            const p = path.join(d, e.name);
            if (e.isDirectory()) lauf(p);
            else if (e.name.endsWith('.js')) alle.push(path.relative(WURZEL, p).split(path.sep).join('/'));
        }
    };
    for (const o of ['apps', 'packages', 'plugins']) lauf(path.join(WURZEL, o));

    const ERKLAERT = /(?:function\s+pluginAn\b|\bpluginAn\s*[:=]\s*(?:async\b|function\b|\())/;
    const findeZweite = (dateiliste, lesen) => ({
        dateien: dateiliste.filter(r => r !== SOLL && /(^|\/)nachbar\.js$/i.test(r)),
        erklaert: dateiliste.filter(r => r !== SOLL && ERKLAERT.test(lesen(r)))
    });
    const lesen = (r) => ohneKommentare(fs.readFileSync(path.join(WURZEL, r), 'utf8'));
    const echt = findeZweite(alle, lesen);
    pruefe(alle.includes(SOLL) && ERKLAERT.test(lesen(SOLL)), `pluginAn ist in ${SOLL} erklaert`);
    pruefe(echt.dateien.length === 0, 'keine zweite nachbar.js', echt.dateien.join(', '));
    pruefe(echt.erklaert.length === 0, 'pluginAn nirgends sonst erklaert', echt.erklaert.join(', '));
    pruefe(nachbar === require(path.join(WURZEL, SOLL)), 'das SDK reicht genau diese Datei aus');

    // Gegenproben: eine zweite Datei und eine zweite Erklaerung muessen auffallen.
    const probe = { 'plugins/clan/shared/nachbar.js': '', 'plugins/leveling/x.js': 'const pluginAn = async (p, g) => true;' };
    const gegen = findeZweite([...alle, ...Object.keys(probe)], r => (r in probe ? probe[r] : lesen(r)));
    pruefe(gegen.dateien.includes('plugins/clan/shared/nachbar.js'), 'Gegenprobe: zweite nachbar.js faellt auf');
    pruefe(gegen.erklaert.includes('plugins/leveling/x.js'), 'Gegenprobe: zweites pluginAn faellt auf');
}

console.log(abweichungen === 0
    ? `\nErgebnis: ${faelle} Pruefungen, 0 Abweichungen.\n`
    : `\nErgebnis: ${faelle} Pruefungen, ${abweichungen} Abweichung(en).\n`);
process.exit(abweichungen === 0 ? 0 : 1);

})().catch(err => { console.error('\nAbbruch:', err.message, '\n', err.stack); process.exit(1); });
