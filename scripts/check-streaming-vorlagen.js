#!/usr/bin/env node
/**
 * Prueft die Vorlagenregeln - ohne Datenbank, ohne Discord.
 *
 * Drei Dinge, die im Betrieb still schiefgehen wuerden:
 *
 *   1. **Welche Vorlage gilt.** Eigene des Ziels vor Standard der Guild vor
 *      Vorgabe. Ein Feld mit nur einem Leerzeichen ist KEINE Vorlage - sonst
 *      entstuende eine leere Ankuendigung: technisch erfolgreich, im Discord
 *      unsichtbar.
 *   2. **Was gespeichert werden darf.** Ein erfundener Platzhalter erscheint
 *      woertlich in der Nachricht; ein zu langer Text laesst die Ankuendigung
 *      JEDES Mal scheitern, nicht einmal.
 *   3. **Dass die Ausgabe alle Platzhalter wirklich fuellt.** Die Liste ist ein
 *      Vertrag mit `nachricht.js` - dass sie den Vertrag halten, prueft
 *      niemand ausser diesem Skript.
 *
 *   node scripts/check-streaming-vorlagen.js
 *
 * Exitcode 1 bei jeder Abweichung.
 */
'use strict';

const {
    PLATZHALTER, VORLAGE_MAX, VORGABE_LIVE, VORGABE_RUECKSCHAU,
    pruefeVorlage, vorlageWaehlen
} = require('../plugins/streaming/shared/vorlagen');
const nachricht = require('../plugins/streaming/dashboard/ausgabe/nachricht');

let faelle = 0;
let abweichungen = 0;

/**
 * Einen Fall pruefen.
 *
 * @param {string} was Beschreibung
 * @param {*} ist Ergebnis
 * @param {*} soll Erwartung
 * @returns {void}
 */
function pruefe(was, ist, soll) {
    faelle++;
    const gleich = JSON.stringify(ist) === JSON.stringify(soll);
    if (gleich) {
        console.log(`  ✓ ${was}`);
    } else {
        abweichungen++;
        console.log(`  ✗ ${was}\n      erwartet: ${JSON.stringify(soll)}\n      bekommen: ${JSON.stringify(ist)}`);
    }
}

// ---------------------------------------------------------------
console.log('\nWelche Vorlage gilt');
// ---------------------------------------------------------------
pruefe('eigene schlaegt Guild',        vorlageWaehlen('eigen', 'guild', 'vorgabe'), 'eigen');
pruefe('Guild schlaegt Vorgabe',       vorlageWaehlen(null, 'guild', 'vorgabe'),    'guild');
pruefe('ohne alles die Vorgabe',       vorlageWaehlen(null, null, 'vorgabe'),       'vorgabe');
pruefe('leerer Text zaehlt nicht',     vorlageWaehlen('', 'guild', 'vorgabe'),      'guild');
pruefe('nur Leerzeichen zaehlt nicht', vorlageWaehlen('   ', '  ', 'vorgabe'),      'vorgabe');
// Gegenprobe: ein Objekt aus der JSON-Falle von getConfig darf nicht durchrutschen
pruefe('ein Objekt ist keine Vorlage', vorlageWaehlen({}, null, 'vorgabe'),         'vorgabe');

// ---------------------------------------------------------------
console.log('\nWas gespeichert werden darf');
// ---------------------------------------------------------------
pruefe('leer ist erlaubt (= Standard)',    pruefeVorlage(''),                              null);
pruefe('Text ohne Platzhalter',            pruefeVorlage('Wir sind live!'),                null);
pruefe('alle bekannten Platzhalter',       pruefeVorlage(PLATZHALTER.map(p => p.name).join(' ')), null);
pruefe('Grossschreibung wird erkannt',     pruefeVorlage('{STREAMER} ist live'),           null);
pruefe('erfundener Platzhalter faellt auf', pruefeVorlage('{zuschauerzahl} sehen zu'),     'platzhalter');
pruefe('Tippfehler faellt auf',            pruefeVorlage('{streemer} ist live'),           'platzhalter');
pruefe('genau an der Grenze geht',         pruefeVorlage('x'.repeat(VORLAGE_MAX)),         null);
pruefe('ein Zeichen darueber nicht',       pruefeVorlage('x'.repeat(VORLAGE_MAX + 1)),     'zu_lang');

// ---------------------------------------------------------------
console.log('\nDie Ausgabe haelt den Vertrag');
// ---------------------------------------------------------------
const streamer = { plattform: 'twitch', login: 'beispiel', anzeigename: 'Beispiel', avatar_url: null };
const zustand  = {
    titel: 'Ein Titel', kategorie: 'Just Chatting', zuschauer: 7,
    begonnen_am: new Date(Date.now() - 3 * 3600 * 1000), beendet_am: new Date()
};

// Alle Platzhalter auf einmal - was nicht gefuellt wird, bleibt stehen.
const alle = PLATZHALTER.map(p => p.name).join(' | ');

const beiLive = nachricht.live({
    streamer, zustand, ziel: { rolle_id: '123', vorlage: alle }
}).content;
const offenLive = PLATZHALTER
    .map(p => p.name)
    .filter(n => beiLive.includes(n))
    // `{dauer}` steht waehrend des Streams bewusst leer - er wird gefuellt,
    // nur eben mit nichts. Deshalb darf er hier NICHT mehr auftauchen.
    ;
pruefe('live: kein Platzhalter bleibt stehen', offenLive, []);

const beiRueck = nachricht.rueckschau({
    streamer, zustand, ziel: { vorlage_rueckschau: alle }
}).content;
pruefe('rueckschau: kein Platzhalter bleibt stehen',
    PLATZHALTER.map(p => p.name).filter(n => beiRueck.includes(n)), []);

pruefe('rueckschau fuellt {dauer}', /3 h/.test(
    nachricht.rueckschau({ streamer, zustand, ziel: { vorlage_rueckschau: '{dauer}' } }).content), true);

pruefe('live laesst {dauer} leer', nachricht.live({
    streamer, zustand, ziel: { vorlage: 'A{dauer}B' } }).content, 'AB');

// Die Erwaehnung MUSS im Klartext stehen, nicht im Embed - sonst pingt sie nicht.
const mitRolle = nachricht.live({ streamer, zustand, ziel: { rolle_id: '999', vorlage: '{rolle} live' } });
pruefe('Erwaehnung steht im Klartext', mitRolle.content.includes('<@&999>'), true);
pruefe('Erwaehnung steht NICHT im Embed',
    JSON.stringify(mitRolle.embeds).includes('<@&999>'), false);

// Ohne Rolle darf kein leerer Ping-Rest uebrigbleiben
pruefe('ohne Rolle kein Rest', nachricht.live({
    streamer, zustand, ziel: { vorlage: '{rolle} {streamer} ist live!' } }).content,
    'Beispiel ist live!');

// Der On-Air-Kanal darf NICHT als Knopf in der oeffentlichen Ankuendigung
// stehen: Er ist privat und gehoert der Stream-Crew. Ein Knopf dorthin fuehrt
// fuer fast jeden ins Leere und laedt zum Mitreden ein, wo niemand mitreden
// soll. Am 2026-08-24 vom Betreiber richtiggestellt - hier festgehalten, damit
// es nicht unbemerkt zurueckkommt.
const mitOnair = nachricht.live({
    streamer, zustand,
    ziel: { vorlage: 'live', guild_id: '111', onair_channel: '222' }
});
const knoepfe = mitOnair.components[0].components;
pruefe('genau ein Knopf, auch mit On-Air-Kanal', knoepfe.length, 1);
pruefe('kein Knopf zeigt auf einen Discord-Kanal',
    knoepfe.some(k => String(k.url).includes('discord.com/channels')), false);

// Die Vorgaben selbst muessen die eigenen Regeln bestehen
pruefe('Vorgabe live ist gueltig',       pruefeVorlage(VORGABE_LIVE),       null);
pruefe('Vorgabe rueckschau ist gueltig', pruefeVorlage(VORGABE_RUECKSCHAU), null);

console.log(abweichungen === 0
    ? `\nErgebnis: ${faelle} Faelle, 0 Abweichungen.\n`
    : `\nErgebnis: ${faelle} Faelle, ${abweichungen} Abweichung(en).\n`);
process.exit(abweichungen === 0 ? 0 : 1);
