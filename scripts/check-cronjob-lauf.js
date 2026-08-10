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

/**
 * Vergleicht ohne Ruecksicht auf die Reihenfolge der Schluessel — die sagt
 * nichts ueber die Richtigkeit aus, laesst aber sonst jeden Objektvergleich
 * scheitern.
 */
function normiert(wert) {
    if (Array.isArray(wert)) return wert.map(normiert);
    if (wert && typeof wert === 'object') {
        return Object.fromEntries(
            Object.keys(wert).sort().map(k => [k, normiert(wert[k])])
        );
    }
    return wert;
}

function pruefe(was, tatsaechlich, erwartet) {
    geprueft++;
    const gleich = JSON.stringify(normiert(tatsaechlich)) === JSON.stringify(normiert(erwartet));
    if (!gleich) {
        gescheitert++;
        console.log(`  ✗ ${was}`);
        console.log(`      erwartet:     ${JSON.stringify(erwartet)}`);
        console.log(`      tatsaechlich: ${JSON.stringify(tatsaechlich)}`);
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

console.log('\nBaukasten: Zeitpunkt zusammenklicken\n');

const { baue, lies, beschreibe, loeseAufbewahrung } = require('../plugins/gameserver/dashboard/assets/js/cronPlan');

pruefe('alle 30 Minuten',  baue({ takt: 'minuten', intervall: 30 }), '*/30 * * * *');
pruefe('stuendlich zur 15', baue({ takt: 'stuendlich', minute: 15 }), '15 * * * *');
pruefe('taeglich 3:30',    baue({ takt: 'taeglich', stunde: 3, minute: 30 }), '30 3 * * *');
pruefe('Montag 4:00',      baue({ takt: 'woechentlich', stunde: 4, minute: 0, wochentag: 1 }), '0 4 * * 1');
pruefe('monatlich am 1.',  baue({ takt: 'monatlich', stunde: 4, minute: 0, tag: 1 }), '0 4 1 * *');

// Grenzen: der Baukasten darf nichts Unsinniges erzeugen.
pruefe('Intervall unter 5 wird angehoben', baue({ takt: 'minuten', intervall: 1 }), '*/5 * * * *');
pruefe('Stunde 99 wird geklemmt',  baue({ takt: 'taeglich', stunde: 99, minute: 0 }), '0 23 * * *');
pruefe('Minute -5 wird geklemmt',  baue({ takt: 'taeglich', stunde: 4, minute: -5 }), '0 4 * * *');
// Der 31. faellt in manchen Monaten aus — der Job liefe dann stillschweigend
// gar nicht. Deshalb endet der Baukasten beim 28.
pruefe('Monatstag 31 wird auf 28 geklemmt', baue({ takt: 'monatlich', tag: 31, stunde: 4, minute: 0 }), '0 4 28 * *');
pruefe('unbekannter Takt ergibt nichts', baue({ takt: 'quartalsweise' }), '');

// Hin und zurueck: ohne das waere der Baukasten nur beim Anlegen eine Hilfe.
for (const plan of [
    { takt: 'minuten', intervall: 15 },
    { takt: 'stuendlich', minute: 5 },
    { takt: 'taeglich', stunde: 6, minute: 45 },
    { takt: 'woechentlich', stunde: 23, minute: 0, wochentag: 6 },
    { takt: 'monatlich', stunde: 1, minute: 10, tag: 15 },
]) {
    pruefe(`hin und zurueck: ${plan.takt}`, lies(baue(plan)), plan);
}

pruefe('fremde Form ergibt keinen Plan', lies('1 2 3 4 5'), null);
pruefe('zu wenige Felder ergeben keinen Plan', lies('0 4 * *'), null);
pruefe('Monatsangabe wird nicht verschluckt', lies('0 4 * 6 *'), null);
pruefe('fremde Form wird nicht beschrieben', beschreibe('1 2 3 4 5'), null);
pruefe('Beschreibung nennt den Wochentag', beschreibe('0 4 * * 1'), 'jeden Montag um 04:00 Uhr');

console.log('\nAufbewahrung: was gilt, Server oder Cronjob?\n');

pruefe('ohne Job gilt der Server',
    loeseAufbewahrung({ backup_keep: 7, backup_keep_days: 30 }),
    { keep: 7, keepDays: 30, quelle: 'server' });
pruefe('Job ohne eigene Angabe erbt',
    loeseAufbewahrung({ backup_keep: 7, backup_keep_days: 30 }, { backup_keep: null, backup_keep_days: null }),
    { keep: 7, keepDays: 30, quelle: 'server' });
pruefe('Job mit eigener Angabe sticht',
    loeseAufbewahrung({ backup_keep: 7 }, { backup_keep: 3, backup_keep_days: null }),
    { keep: 3, keepDays: 0, quelle: 'job' });
// Die Falle: 0 am Job ist eine Ansage ("unbegrenzt"), null ist keine.
// Ein `|| 0` an der falschen Stelle macht aus "erbt 7" ein "unbegrenzt".
pruefe('0 am Job heisst ausdruecklich unbegrenzt',
    loeseAufbewahrung({ backup_keep: 7, backup_keep_days: 30 }, { backup_keep: 0, backup_keep_days: 0 }),
    { keep: 0, keepDays: 0, quelle: 'job' });
pruefe('leerer Server ergibt unbegrenzt',
    loeseAufbewahrung({}, null),
    { keep: 0, keepDays: 0, quelle: 'server' });

console.log(`\n${geprueft} Pruefungen, ${gescheitert} gescheitert.\n`);
process.exit(gescheitert ? 1 : 0);
