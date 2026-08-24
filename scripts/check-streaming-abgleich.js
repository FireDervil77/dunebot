#!/usr/bin/env node
/**
 * Spielt den Abgleich durch - ohne Datenbank, ohne Twitch.
 *
 * Der Abgleich ist die gefaehrlichste Stelle des Plugins: Er **loescht** Abos.
 * Ein Denkfehler hier bestellt ab, was gerade laeuft — und niemand merkt es,
 * weil danach einfach keine Ankuendigung mehr kommt.
 *
 * Vier Faelle und drei Fallen:
 *
 *   Faelle:  bei ihnen nicht bei uns -> Leck  ·  bei uns nicht bei ihnen ->
 *            verloren  ·  Zustand weicht ab -> uebernehmen  ·  unbekannter
 *            Zustand -> nichts tun
 *
 *   Fallen:  (1) ein Streamer ohne Zuschauer darf NICHT neu angelegt werden -
 *            er wird gleich danach abbestellt
 *            (2) eine Zeile ohne `anbieter_abo_id` ist verloren, nicht heil
 *            (3) ein unbekannter Zustand darf NICHT als Abweichung gelten
 *
 *   node scripts/check-streaming-abgleich.js
 *
 * Exitcode 1 bei jeder Abweichung.
 */
'use strict';

const { vergleichen } = require('../plugins/streaming/dashboard/kern/abgleich');
const { zustandUebersetzen } = require('../plugins/streaming/dashboard/plattformen/twitch');

let faelle = 0;
let abweichungen = 0;

/**
 * @param {string} was Beschreibung
 * @param {*} ist Ergebnis
 * @param {*} soll Erwartung
 * @returns {void}
 */
function pruefe(was, ist, soll) {
    faelle++;
    if (JSON.stringify(ist) === JSON.stringify(soll)) {
        console.log(`  ✓ ${was}`);
    } else {
        abweichungen++;
        console.log(`  ✗ ${was}\n      erwartet: ${JSON.stringify(soll)}\n      bekommen: ${JSON.stringify(ist)}`);
    }
}

/**
 * Eine Bestandszeile.
 *
 * @param {Object} teile Abweichungen von der Vorgabe
 * @returns {Object} Zeile
 */
function unsere(teile = {}) {
    return {
        id: 1, streamer_id: 7, ereignis: 'stream.online', anbieter_abo_id: 'A1',
        zustand: 'bestaetigt', plattform: 'twitch', kanal_id: '999', login: 'beispiel',
        zuschauer: 1, ...teile
    };
}

/**
 * Ein Abo bei der Plattform.
 *
 * @param {Object} teile Abweichungen von der Vorgabe
 * @returns {Object} Abo
 */
function fremd(teile = {}) {
    return {
        anbieter_abo_id: 'A1', ereignis: 'stream.online', kanal_id: '999',
        zustand: 'bestaetigt', unbekannt: null, kosten: 1, ...teile
    };
}

/** @param {Object} u Urteil @returns {Object} Zaehlung */
const zaehl = (u) => ({
    lecks: u.lecks.length, verloren: u.verloren.length,
    zustaende: u.zustaende.length, unbekannt: u.unbekannt.length
});

// ---------------------------------------------------------------
console.log('\nDie vier Faelle');
// ---------------------------------------------------------------
pruefe('alles deckt sich -> nichts zu tun',
    zaehl(vergleichen([unsere()], [fremd()])),
    { lecks: 0, verloren: 0, zustaende: 0, unbekannt: 0 });

pruefe('bei ihnen, nicht bei uns -> Leck',
    zaehl(vergleichen([unsere()], [fremd(), fremd({ anbieter_abo_id: 'FREMD' })])),
    { lecks: 1, verloren: 0, zustaende: 0, unbekannt: 0 });

pruefe('bei uns, nicht bei ihnen -> verloren',
    zaehl(vergleichen([unsere()], [])),
    { lecks: 0, verloren: 1, zustaende: 0, unbekannt: 0 });

pruefe('Zustand weicht ab -> uebernehmen',
    zaehl(vergleichen([unsere()], [fremd({ zustand: 'widerrufen' })])),
    { lecks: 0, verloren: 0, zustaende: 1, unbekannt: 0 });

pruefe('    und zwar mit Richtung',
    vergleichen([unsere()], [fremd({ zustand: 'widerrufen' })]).zustaende[0],
    { id: 1, login: 'beispiel', ereignis: 'stream.online', war: 'bestaetigt', ist: 'widerrufen' });

// ---------------------------------------------------------------
console.log('\nDie drei Fallen');
// ---------------------------------------------------------------
pruefe('Falle 1: ohne Zuschauer wird NICHT neu angelegt',
    zaehl(vergleichen([unsere({ zuschauer: 0 })], [])),
    { lecks: 0, verloren: 0, zustaende: 0, unbekannt: 0 });

pruefe('    auch der Zustand bleibt dann unberuehrt',
    zaehl(vergleichen([unsere({ zuschauer: 0 })], [fremd({ zustand: 'widerrufen' })])),
    { lecks: 0, verloren: 0, zustaende: 0, unbekannt: 0 });

pruefe('Falle 2: Zeile ohne Abo-Kennung gilt als verloren',
    zaehl(vergleichen([unsere({ anbieter_abo_id: null })], [fremd()])),
    // Das Abo bei Twitch gehoert dann niemandem mehr -> zusaetzlich ein Leck.
    { lecks: 1, verloren: 1, zustaende: 0, unbekannt: 0 });

pruefe('Falle 3: unbekannter Zustand ist keine Abweichung',
    zaehl(vergleichen([unsere()], [fremd({ zustand: null, unbekannt: 'irgendwas_neues' })])),
    { lecks: 0, verloren: 0, zustaende: 0, unbekannt: 1 });

// ---------------------------------------------------------------
console.log('\nMengen und Reihenfolge');
// ---------------------------------------------------------------
const viele = [unsere({ id: 1, anbieter_abo_id: 'A1' }),
               unsere({ id: 2, anbieter_abo_id: 'A2', ereignis: 'stream.offline' }),
               unsere({ id: 3, anbieter_abo_id: 'A3', ereignis: 'channel.update' })];

pruefe('drei Abos, zwei bei Twitch weg',
    zaehl(vergleichen(viele, [fremd({ anbieter_abo_id: 'A1' })])),
    { lecks: 0, verloren: 2, zustaende: 0, unbekannt: 0 });

pruefe('leerer Bestand, drei bei Twitch -> drei Lecks',
    zaehl(vergleichen([], [fremd({ anbieter_abo_id: 'X1' }), fremd({ anbieter_abo_id: 'X2' }), fremd({ anbieter_abo_id: 'X3' })])),
    { lecks: 3, verloren: 0, zustaende: 0, unbekannt: 0 });

pruefe('beides leer -> nichts',
    zaehl(vergleichen([], [])),
    { lecks: 0, verloren: 0, zustaende: 0, unbekannt: 0 });

// ---------------------------------------------------------------
console.log('\nDie Uebersetzung der Plattform-Zustaende');
// ---------------------------------------------------------------
pruefe('enabled -> bestaetigt',                              zustandUebersetzen('enabled'), 'bestaetigt');
pruefe('webhook_callback_verification_pending -> angefragt', zustandUebersetzen('webhook_callback_verification_pending'), 'angefragt');
pruefe('notification_failures_exceeded -> fehler',           zustandUebersetzen('notification_failures_exceeded'), 'fehler');
pruefe('authorization_revoked -> widerrufen',                zustandUebersetzen('authorization_revoked'), 'widerrufen');
pruefe('user_removed -> widerrufen',                         zustandUebersetzen('user_removed'), 'widerrufen');
// Gegenprobe: Unbekanntes darf NICHT zu "fehler" werden - das waere ein
// Fehler, den es nicht gibt, und der Abgleich handelte darauf.
pruefe('etwas Neues -> null, nicht "fehler"',                zustandUebersetzen('irgendwas_2027'), null);
pruefe('leerer Zustand -> null',                             zustandUebersetzen(''), null);

console.log(abweichungen === 0
    ? `\nErgebnis: ${faelle} Faelle, 0 Abweichungen.\n`
    : `\nErgebnis: ${faelle} Faelle, ${abweichungen} Abweichung(en).\n`);
process.exit(abweichungen === 0 ? 0 : 1);
