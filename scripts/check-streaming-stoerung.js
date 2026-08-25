#!/usr/bin/env node
/**
 * Spielt durch, wann gemeldet wird - und vor allem, wann NICHT.
 *
 * Eine Meldung, die taeglich kommt, ist nach einer Woche eine Meldung, die
 * niemand liest. Dann fehlt sie genau dann, wenn sie zaehlt. Die Faelle, in
 * denen **geschwiegen** wird, sind deshalb die wichtigeren.
 *
 *   node scripts/check-streaming-stoerung.js
 *
 * Exitcode 1 bei jeder Abweichung.
 */
'use strict';

const s = require('../plugins/streaming/dashboard/kern/stoerung');

let faelle = 0, abweichungen = 0;

/**
 * @param {string} was Beschreibung
 * @param {*} ist Ergebnis
 * @param {*} soll Erwartung
 * @param {string} [zusatz] Begruendung
 * @returns {void}
 */
function pruefe(was, ist, soll, zusatz = '') {
    faelle++;
    const gut = JSON.stringify(ist) === JSON.stringify(soll);
    if (!gut) abweichungen++;
    console.log(`  ${gut ? '✓' : '✗'} ${was}: ${JSON.stringify(ist)}` +
        (gut ? '' : ` (soll: ${JSON.stringify(soll)})`) + (zusatz ? `  — ${zusatz}` : ''));
}

const JETZT = Date.parse('2026-08-26T12:00:00Z');
const vor = (stunden) => new Date(JETZT - stunden * 3_600_000).toISOString();

console.log('\nWann geschwiegen wird');
pruefe('keine Abos -> Stille ist richtig',
    s.stilleVerdaechtig({ bestaetigteAbos: 0, letzteMeldungAm: vor(100) }, JETZT).melden, false);
pruefe('noch nie etwas gehoert -> frische Einrichtung',
    s.stilleVerdaechtig({ bestaetigteAbos: 3, letzteMeldungAm: null }, JETZT).melden, false);
pruefe('erst 23 h still -> noch nicht',
    s.stilleVerdaechtig({ bestaetigteAbos: 3, letzteMeldungAm: vor(23) }, JETZT).melden, false);
pruefe('unlesbarer Zeitpunkt -> nicht melden',
    s.stilleVerdaechtig({ bestaetigteAbos: 3, letzteMeldungAm: 'gestern' }, JETZT).melden, false);

console.log('\nWann gemeldet wird');
pruefe('24 h still bei stehenden Abos -> melden',
    s.stilleVerdaechtig({ bestaetigteAbos: 3, letzteMeldungAm: vor(24) }, JETZT).melden, true);
pruefe('drei Tage still -> melden',
    s.stilleVerdaechtig({ bestaetigteAbos: 1, letzteMeldungAm: vor(72) }, JETZT).melden, true);
pruefe('    und nennt die Dauer',
    /72 h/.test(s.stilleVerdaechtig({ bestaetigteAbos: 1, letzteMeldungAm: vor(72) }, JETZT).grund), true);
pruefe('eigene Frist wird beachtet',
    s.stilleVerdaechtig({ bestaetigteAbos: 1, letzteMeldungAm: vor(2) }, JETZT, 1).melden, true);

console.log('\nWelche Stoerungen offen sind');
const abos = [
    { id: 1, zustand: 'bestaetigt',  gemeldet_am: null },
    { id: 2, zustand: 'widerrufen',  gemeldet_am: null },
    { id: 3, zustand: 'widerrufen',  gemeldet_am: '2026-08-25 10:00:00' },
    { id: 4, zustand: 'fehler',      gemeldet_am: null },
    { id: 5, zustand: 'angefragt',   gemeldet_am: null }
];
pruefe('nur widerrufen und fehler, nur ungemeldete',
    s.offeneStoerungen(abos).map(a => a.id), [2, 4]);
pruefe('leere Liste stuerzt nicht ab', s.offeneStoerungen([]), []);
pruefe('undefined auch nicht',        s.offeneStoerungen(undefined), []);
// Gegenprobe: Ein bestaetigtes Abo mit altem Meldevermerk darf NICHT wieder
// auftauchen - sonst meldet der Lauf jede behobene Stoerung erneut.
pruefe('behobene Stoerung bleibt draussen',
    s.offeneStoerungen([{ id: 9, zustand: 'bestaetigt', gemeldet_am: '2026-08-25 10:00:00' }]), []);

console.log(abweichungen === 0
    ? `\nErgebnis: ${faelle} Faelle, 0 Abweichungen.\n`
    : `\nErgebnis: ${faelle} Faelle, ${abweichungen} Abweichung(en).\n`);
process.exit(abweichungen === 0 ? 0 : 1);
