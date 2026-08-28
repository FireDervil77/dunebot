#!/usr/bin/env node
/**
 * Prueft die **Frist fuer IPC-Handler** im Bot.
 *
 * Am 2026-08-27 brauchte jedes `streaming:edit` fuer einen bestimmten Kanal
 * exakt 1200 Sekunden. Der Aufrufer im Dashboard gibt nach 30 s auf — die
 * Handler liefen aber weiter und wurden ueber die ganze Nacht fertig, der
 * letzte um 13:32 Uhr des Folgetages. Sichtbar wurde davon: 26 Auftraege
 * `Timed out.`, eine Ankuendigung blieb auf „ist live" stehen, und der Bot
 * schrieb stundenalte Aenderungen in einen Kanal.
 *
 * Vier Regeln halten das fest:
 *
 *   1. **Die Frist muss unter der des Aufrufers liegen.** Sonst gibt das
 *      Dashboard zuerst auf und erfaehrt wieder nur „Timed out." statt des
 *      Grundes. Beide Zahlen werden hier aus dem Quelltext gelesen und
 *      verglichen — nicht abgeschrieben.
 *   2. **Nur Plugin-Ereignisse.** `dashboard:GET_ALL_GUILD_MEMBERS` darf
 *      laenger dauern und bringt seine eigene Frist mit.
 *   3. **Der Wecker muss abgeraeumt werden.** Ein offener Timer haelt den
 *      Vorgang am Leben; bei einem schnellen Handler waeren das 25 s Nachlauf
 *      je Aufruf.
 *   4. **`restRequestTimeout` darf nicht zurueckkommen.** Das ist eine
 *      v13-Option, die v14 still ignoriert — hier gegen einen echten Client
 *      geprueft, nicht gegen den Quelltext.
 *
 * Nebenwirkungsfrei: keine Datenbank, kein Discord-Login, kein IPC.
 *
 *   node scripts/check-ipc-frist.js
 *
 * Exitcode 1 bei jeder Abweichung.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const WURZEL = path.join(__dirname, '..');
let faelle = 0;
let abweichungen = 0;

/**
 * @param {boolean} gut Bedingung
 * @param {string} text Beschreibung
 * @param {string} [zusatz] Warum es zaehlt
 * @returns {void}
 */
function pruefe(gut, text, zusatz = '') {
    faelle++;
    if (gut) { console.log(`  ✓ ${text}`); return; }
    abweichungen++;
    console.log(`  ✗ ${text}`);
    if (zusatz) console.log(`      → ${zusatz}`);
}

/** @param {string} p Pfad ab Projektwurzel @returns {string} Inhalt */
const lies = (p) => fs.readFileSync(path.join(WURZEL, p), 'utf8');

(async () => {

const { mitFrist } = require(path.join(WURZEL, 'apps/bot/helpers/IPCClient'));
const IPCClient = require(path.join(WURZEL, 'apps/bot/helpers/IPCClient'));

// ---------------------------------------------------------------------
console.log('\n1. Die Frist greift, und sie greift nur wenn noetig');
// ---------------------------------------------------------------------

const schnell = await mitFrist(1000, async () => 'da', 'test:schnell');
pruefe(schnell === 'da', 'ein schneller Handler kommt unveraendert durch',
    'die Frist darf im Normalfall nichts aendern');

let gefangen = null;
try {
    await mitFrist(50, () => new Promise(() => {}), 'streaming:edit');
} catch (err) { gefangen = err; }
pruefe(gefangen instanceof Error,
    'ein Handler, der nie antwortet, laesst die Frist ablaufen',
    'ohne sie liefe er weiter und antwortete Stunden spaeter ins Leere');
pruefe(Boolean(gefangen) && /streaming:edit/.test(gefangen.message),
    'und die Meldung nennt das Ereignis',
    `sonst steht im Protokoll nicht, WAS haengt — gefunden: ${gefangen && gefangen.message}`);
pruefe(Boolean(gefangen) && /\b50\b/.test(gefangen.message),
    'und die ueberschrittene Frist');

// Ein Handler, der wirft, muss weiterhin seinen eigenen Fehler zeigen -
// nicht den der Frist.
let eigener = null;
try {
    await mitFrist(1000, async () => { throw new Error('Kanal nicht gefunden'); }, 'x');
} catch (err) { eigener = err; }
pruefe(Boolean(eigener) && eigener.message === 'Kanal nicht gefunden',
    'ein Handler, der scheitert, behaelt seinen eigenen Fehler',
    'die Frist darf den Grund nicht ueberschreiben');

// ---------------------------------------------------------------------
console.log('\n2. Der Wecker wird abgeraeumt');
// ---------------------------------------------------------------------

// Nach einem schnellen Durchlauf darf kein Timer mehr offen sein.
//
// **Gemessen mit `getActiveResourcesInfo`, nicht mit `_getActiveHandles`.**
// Die erste Fassung dieser Regel nahm `_getActiveHandles()` — und blieb in
// der Gegenprobe gruen, obwohl `clearTimeout` entfernt war: Node 20 fuehrt
// Timer dort nicht mehr auf. Eine Regel, die den Fehler nicht sieht, ist
// keine.
const zaehleTimer = () => process.getActiveResourcesInfo().filter(r => r === 'Timeout').length;
const vorher = zaehleTimer();
await mitFrist(30_000, async () => 'fertig', 'test:aufraeumen');
const nachher = zaehleTimer();
pruefe(nachher <= vorher,
    'nach einem schnellen Handler bleibt kein Timer offen',
    `vorher ${vorher}, nachher ${nachher} — ein offener Wecker haelt den Vorgang 25 s am Leben`);

// ---------------------------------------------------------------------
console.log('\n3. Die Frist liegt unter der des Aufrufers');
// ---------------------------------------------------------------------

const drossel = lies('plugins/streaming/dashboard/ausgabe/drossel.js');
const mAufrufer = /const BOT_FRIST_MS = ([\d_]+)/.exec(drossel);
pruefe(Boolean(mAufrufer), 'die Frist des Aufrufers steht in drossel.js');

const aufruferMs = mAufrufer ? Number(mAufrufer[1].replace(/_/g, '')) : NaN;
const handlerMs  = IPCClient.HANDLER_FRIST_MS;

pruefe(Number.isFinite(handlerMs) && handlerMs > 0,
    `der Bot hat eine Handler-Frist (${handlerMs} ms)`);
pruefe(handlerMs < aufruferMs,
    `und sie liegt unter der des Aufrufers (${handlerMs} < ${aufruferMs})`,
    'sonst gibt das Dashboard zuerst auf und erfaehrt wieder nur „Timed out." statt des Grundes');

// ---------------------------------------------------------------------
console.log('\n4. Nur Plugin-Ereignisse, nicht die Kernereignisse');
// ---------------------------------------------------------------------

const quelle = lies('apps/bot/helpers/IPCClient.js');
const nachDashboard = quelle.slice(quelle.indexOf('if (pluginName === "dashboard")'));
const kernZweig = nachDashboard.slice(0, nachDashboard.indexOf('const plugin ='));

pruefe(!/mitFrist/.test(kernZweig),
    'der Kernzweig (`dashboard:`) laeuft ohne Frist',
    'GET_ALL_GUILD_MEMBERS darf laenger dauern und bringt seine eigene mit');
pruefe(/const data = await mitFrist\(/.test(quelle),
    'der Plugin-Zweig ruft den Handler ueber die Frist auf',
    'ohne diesen Aufruf ist die Frist angemeldet und wirkungslos');

// ---------------------------------------------------------------------
console.log('\n5. Die tote v13-Option kommt nicht zurueck');
// ---------------------------------------------------------------------

const botClient = lies('apps/bot/extenders/BotClient.js');
const alsOption = /^\s*restRequestTimeout\s*:/m.test(botClient);
pruefe(!alsOption,
    'restRequestTimeout steht nicht mehr als Option',
    'discord.js v14 ignoriert sie still — die Grenze gaebe es nicht');
pruefe(/rest:\s*\{\s*timeout:/.test(botClient),
    'stattdessen steht `rest: { timeout: … }`');

// **Gegen einen echten Client geprueft, nicht gegen den Quelltext.** Genau
// hier lag der Fehler: Die Zeile SAH nach einer Grenze aus.
const { Client, GatewayIntentBits } = require('discord.js');
const mitAlt = new Client({ intents: [GatewayIntentBits.Guilds], restRequestTimeout: 20_000 });
const mitNeu = new Client({ intents: [GatewayIntentBits.Guilds], rest: { timeout: 20_000 } });

pruefe(mitAlt.rest.options.timeout !== 20_000,
    `die v13-Schreibweise kommt nachweislich NICHT an (${mitAlt.rest.options.timeout} ms)`,
    'das ist der Beweis, dass die alte Zeile wirkungslos war');
pruefe(mitNeu.rest.options.timeout === 20_000,
    'die v14-Schreibweise kommt an (20000 ms)');
mitAlt.destroy();
mitNeu.destroy();

console.log(abweichungen === 0
    ? `\nErgebnis: ${faelle} Pruefungen, 0 Abweichungen.\n`
    : `\nErgebnis: ${faelle} Pruefungen, ${abweichungen} Abweichung(en).\n`);
process.exit(abweichungen === 0 ? 0 : 1);

})().catch(err => { console.error('\nAbbruch:', err.message, '\n', err.stack); process.exit(1); });
