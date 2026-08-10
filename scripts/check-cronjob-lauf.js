#!/usr/bin/env node
/**
 * Prueft die Entscheidungslogik der Gameserver-Cronjobs.
 *
 * `plugins/gameserver/dashboard/helpers/cronEntscheidung.js` beantwortet zwei
 * Fragen ohne Datenbank und ohne Daemon: soll ein Job jetzt laufen, und welche
 * Backups fallen aus der Aufbewahrung. Fuenf Aktionen mal acht Statuswerte sind
 * 40 Faelle — die probiert niemand gegen eine laufende Anlage durch.
 *
 * Nach jeder Aenderung dort hier laufen lassen:
 *   node scripts/check-cronjob-lauf.js
 */
'use strict';

const { entscheide, zuEntfernen } = require('../plugins/gameserver/dashboard/helpers/cronEntscheidung');

let geprueft = 0;
let gescheitert = 0;

function pruefe(was, tatsaechlich, erwartet) {
    geprueft++;
    const gleich = JSON.stringify(tatsaechlich) === JSON.stringify(erwartet);
    if (!gleich) {
        gescheitert++;
        console.log(`  ✗ ${was}`);
        console.log(`      erwartet:     ${JSON.stringify(erwartet)}`);
        console.log(`      tatsaechlich: ${JSON.stringify(erwartet === undefined ? tatsaechlich : tatsaechlich)}`);
    }
}

const laeuft = (aktion, status, daemonOnline = true) =>
    entscheide({ aktion, serverStatus: status, daemonOnline }).ausfuehren;

console.log('\nEntscheidung: soll der Job laufen?\n');

// ── Der Kernfall: start braucht einen gestoppten Server ──────────────────────
pruefe('start bei gestopptem Server laeuft',        laeuft('start', 'offline'), true);
pruefe('start bei laufendem Server laeuft NICHT',   laeuft('start', 'online'),  false);

// ── Alles andere braucht einen laufenden Server ──────────────────────────────
for (const aktion of ['stop', 'restart', 'command', 'backup']) {
    pruefe(`${aktion} bei laufendem Server laeuft`,      laeuft(aktion, 'online'),  true);
    pruefe(`${aktion} bei gestopptem Server laeuft NICHT`, laeuft(aktion, 'offline'), false);
}

// ── Daemon offline: nichts laeuft, auch kein start ───────────────────────────
for (const aktion of ['start', 'stop', 'restart', 'command', 'backup']) {
    pruefe(`${aktion} ohne Daemon laeuft NICHT`, laeuft(aktion, 'offline', false), false);
}
pruefe('Grund nennt den Daemon',
    entscheide({ aktion: 'start', serverStatus: 'offline', daemonOnline: false }).grund,
    'Daemon ist offline');

// ── Beschaeftigte Zustaende: nichts wird angefasst ───────────────────────────
for (const status of ['installing', 'updating', 'starting', 'stopping']) {
    for (const aktion of ['start', 'stop', 'restart', 'command', 'backup']) {
        pruefe(`${aktion} bei ${status} laeuft NICHT`, laeuft(aktion, status), false);
    }
}

// `error` ist NICHT beschaeftigt — ein abgestuerzter Server darf per Cronjob
// wieder hochgefahren werden. Das ist der Sinn eines Start-Jobs.
pruefe('start nach Absturz laeuft',        laeuft('start', 'error'),   true);
pruefe('restart nach Absturz laeuft NICHT', laeuft('restart', 'error'), false);

// ── Jeder uebersprungene Fall nennt einen Grund ──────────────────────────────
for (const aktion of ['start', 'stop', 'restart', 'command', 'backup']) {
    for (const status of ['online', 'offline', 'installing', 'error']) {
        const e = entscheide({ aktion, serverStatus: status, daemonOnline: true });
        if (!e.ausfuehren) {
            pruefe(`${aktion}/${status} hat einen Grund`, e.grund.length > 0, true);
        }
    }
}

console.log('\nAufbewahrung: welche Backups fallen weg?\n');

const tage = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);
const reihe = [
    { id: 1, created_at: tage(0) },
    { id: 2, created_at: tage(2) },
    { id: 3, created_at: tage(9) },
    { id: 4, created_at: tage(40) },
];

pruefe('ohne Grenzen faellt nichts weg',
    zuEntfernen(reihe, { keep: 0, keepDays: 0 }), []);
pruefe('keep=2 behaelt die zwei juengsten',
    zuEntfernen(reihe, { keep: 2 }).sort(), [3, 4]);
pruefe('keepDays=7 wirft die aelteren weg',
    zuEntfernen(reihe, { keepDays: 7 }).sort(), [3, 4]);
pruefe('beide Grenzen zusammen',
    zuEntfernen(reihe, { keep: 3, keepDays: 7 }).sort(), [3, 4]);
pruefe('leere Liste bleibt leer',
    zuEntfernen([], { keep: 1 }), []);

// Die Falle: eine kurze Frist darf nicht den letzten Stand wegraeumen.
const nurAlte = [{ id: 9, created_at: tage(100) }];
pruefe('das juengste Backup bleibt, auch wenn es zu alt ist',
    zuEntfernen(nurAlte, { keepDays: 1 }), []);
pruefe('keep=0 mit keepDays laesst mindestens eins stehen',
    zuEntfernen([{ id: 1, created_at: tage(50) }, { id: 2, created_at: tage(60) }], { keepDays: 7 }),
    [2]);

console.log(`\n${geprueft} Pruefungen, ${gescheitert} gescheitert.\n`);
process.exit(gescheitert ? 1 : 0);
