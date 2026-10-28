#!/usr/bin/env node
/**
 * Die Zeit in der Logausgabe ist die Ortszeit der Maschine (2026-10-28).
 *
 * `translateTime` stand auf "yyyy-mm-dd HH:mm:ss". Bei dateformat heißt `mm`
 * Monat und `MM` Minute, und ohne `SYS:` gilt UTC — jede Zeile in
 * `pm2 logs` zeigte „15:10:…" (UTC-Stunde, Monat 10), um 16:36 Ortszeit.
 * Wer danach einen Vorfall zeitlich einordnet, liegt Stunden daneben.
 *
 * Geprüft wird mit der pino-pretty-Fassung, die das SDK wirklich lädt, und der
 * Schreibweise, die in `Logger.js` steht — an einem Zeitpunkt, an dem Minute
 * und Monat verschieden sind.
 *
 *   node scripts/check-logzeit.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const SDK = path.join(__dirname, '../packages/dunebot-sdk');

const quelle = fs.readFileSync(path.join(SDK, 'lib/utils/Logger.js'), 'utf8');
const m = quelle.match(/translateTime:\s*"([^"]+)"/);
const { prettyFactory } = require(require.resolve('pino-pretty', { paths: [SDK] }));

const zeit = new Date(2026, 2, 7, 21, 45, 9);   // 7. März, 21:45:09 Ortszeit — Minute 45, Monat 03
const zwei = (n) => String(n).padStart(2, '0');
const erwartet = `[${zeit.getFullYear()}-${zwei(zeit.getMonth() + 1)}-${zwei(zeit.getDate())} `
    + `${zwei(zeit.getHours())}:${zwei(zeit.getMinutes())}:${zwei(zeit.getSeconds())}]`;

console.log('\nZeit in der Logausgabe');
let rot = 0;
if (!m) { console.log('  ✗ translateTime in Logger.js nicht gefunden'); rot++; }
else {
    const zeile = prettyFactory({ translateTime: m[1], colorize: false })({ level: 30, time: zeit.getTime(), msg: 'x' });
    const ok = zeile.startsWith(erwartet);
    console.log(`  ${ok ? '✓' : '✗'} "${m[1]}" ergibt ${zeile.slice(0, 21)} — Ortszeit ${erwartet}`);
    if (!ok) rot++;
}
console.log(rot ? '\n✗ rot' : '\n✓ alles grün');
process.exit(rot ? 1 : 0);
