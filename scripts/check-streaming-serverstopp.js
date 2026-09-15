#!/usr/bin/env node
/**
 * Prueft die Entscheidungen des Zusatzes „Streamserver" (Baustelle 118).
 *
 * `plugins/streaming/dashboard/kern/serverstoppEntscheidung.js` beantwortet ohne
 * Datenbank und ohne Discord: Wird nach einem Streamende ein Stopp vorgemerkt?
 * Wird beim Faelligwerden gestoppt, nur gemeldet oder abgebrochen? Ist das
 * Formular gueltig? Was steht im Ankuendigungskanal?
 *
 * Die gefaehrlichen Faelle sind die, in denen ein Server mit Spielern stoppen
 * wuerde. Deshalb steht jeder Abbruchgrund hier einzeln - faellt eine Regel weg,
 * wird der Waechter rot.
 *
 * Dazu die Spielerzahl des Gameserver-Anbieters (`helpers/Serversteuerung.js`):
 * Eine alte oder gescheiterte Abfrage darf nie als 0 durchgehen.
 *
 *   node scripts/check-streaming-serverstopp.js
 *
 * Exitcode 1, wenn ein Fall scheitert.
 */
'use strict';

const e = require('../plugins/streaming/dashboard/kern/serverstoppEntscheidung');
const { spielerzahl, SPIELER_GILT_MS } = require('../plugins/gameserver/dashboard/helpers/Serversteuerung');

let geprueft = 0, gescheitert = 0;

function pruefe(was, ist, soll) {
    geprueft++;
    const gut = JSON.stringify(ist) === JSON.stringify(soll);
    if (!gut) gescheitert++;
    console.log(`  ${gut ? '✓' : '✗'} ${was}: ${JSON.stringify(ist)}${gut ? '' : ` (soll: ${JSON.stringify(soll)})`}`);
}

console.log('\nBeim Streamende — wird vorgemerkt?');
pruefe('keine Einstellung', e.beimStreamende(null, 0).vormerken, false);
pruefe('Zusatz aus', e.beimStreamende({ aktiv: 0 }, 0).vormerken, false);
pruefe('noch jemand aus der Auswahl live', e.beimStreamende({ aktiv: 1 }, 1).grund, 'noch_live');
pruefe('letzter offline', e.beimStreamende({ aktiv: 1 }, 0).vormerken, true);

console.log('\nBeim Faelligwerden — der Normalfall');
const LEER = { status: 'online', spieler: 0 };
const AN_STOPPEN = { aktiv: 1, modus: 'stoppen' };
const AN_MELDEN = { aktiv: 1, modus: 'melden' };
const lage = (ueber = {}) => ({ anbieterDa: true, einstellung: AN_STOPPEN, liveInAuswahl: 0, server: LEER, ...ueber });

pruefe('leer, niemand live, Modus stoppen', e.beimFaelligwerden(lage()).handlung, 'stoppen');
pruefe('dasselbe im Modus melden', e.beimFaelligwerden(lage({ einstellung: AN_MELDEN })).handlung, 'wuerde_stoppen');
pruefe('unbekannter Modus meldet nur', e.beimFaelligwerden(lage({ einstellung: { aktiv: 1, modus: 'irgendwas' } })).handlung, 'wuerde_stoppen');

console.log('\nBeim Faelligwerden — jeder Abbruchgrund einzeln');
pruefe('kein Anbieter', e.beimFaelligwerden(lage({ anbieterDa: false })).grund, 'kein_anbieter');
pruefe('Einstellung geloescht', e.beimFaelligwerden(lage({ einstellung: null })).grund, 'aus');
pruefe('Zusatz inzwischen aus', e.beimFaelligwerden(lage({ einstellung: { aktiv: 0, modus: 'stoppen' } })).grund, 'aus');
pruefe('jemand wieder live', e.beimFaelligwerden(lage({ liveInAuswahl: 1 })).grund, 'wieder_live');
pruefe('Server weg', e.beimFaelligwerden(lage({ server: null })).grund, 'server_fehlt');
pruefe('Server schon offline', e.beimFaelligwerden(lage({ server: { status: 'offline', spieler: 0 } })).grund, 'nicht_online');
pruefe('Server stoppt schon', e.beimFaelligwerden(lage({ server: { status: 'stopping', spieler: 0 } })).grund, 'nicht_online');
pruefe('ein Spieler da', e.beimFaelligwerden(lage({ server: { status: 'online', spieler: 1 } })).grund, 'spieler_da');
pruefe('Spielerzahl null', e.beimFaelligwerden(lage({ server: { status: 'online', spieler: null } })).grund, 'spieler_unbekannt');
pruefe('Spielerzahl fehlt ganz', e.beimFaelligwerden(lage({ server: { status: 'online' } })).grund, 'spieler_unbekannt');
pruefe('Spielerzahl negativ', e.beimFaelligwerden(lage({ server: { status: 'online', spieler: -1 } })).grund, 'spieler_unbekannt');
pruefe('Spielerzahl kein Wert', e.beimFaelligwerden(lage({ server: { status: 'online', spieler: 'abc' } })).grund, 'spieler_unbekannt');
pruefe('Spielerzahl leerer Text', e.beimFaelligwerden(lage({ server: { status: 'online', spieler: '' } })).grund, 'spieler_unbekannt');
pruefe('ohne Angaben stuerzt nichts', e.beimFaelligwerden().handlung, 'abbrechen');

console.log('\nFormular');
const ERLAUBT = [1, 3];
const gut = { aktiv: '1', modus: 'stoppen', nachlauf_min: '15', streamer: ['1', '3'] };
pruefe('gueltig', e.eingabePruefen(gut, ERLAUBT), { ok: true, werte: { aktiv: true, modus: 'stoppen', nachlaufMin: 15, streamerIds: [1, 3] } });
pruefe('ein einzelner Streamer als Text', e.eingabePruefen({ ...gut, streamer: '3' }, ERLAUBT).werte.streamerIds, [3]);
pruefe('Modus erfunden', e.eingabePruefen({ ...gut, modus: 'loeschen' }, ERLAUBT).fehler, 'modus');
pruefe('Nachlauf unter der Karenz', e.eingabePruefen({ ...gut, nachlauf_min: '2' }, ERLAUBT).fehler, 'nachlauf');
pruefe('Nachlauf zu lang', e.eingabePruefen({ ...gut, nachlauf_min: '241' }, ERLAUBT).fehler, 'nachlauf');
pruefe('Nachlauf kein Wert', e.eingabePruefen({ ...gut, nachlauf_min: 'bald' }, ERLAUBT).fehler, 'nachlauf');
pruefe('Nachlauf mit Komma', e.eingabePruefen({ ...gut, nachlauf_min: '7.5' }, ERLAUBT).fehler, 'nachlauf');
pruefe('fremder Streamer wird abgelehnt, nicht entfernt', e.eingabePruefen({ ...gut, streamer: ['1', '2'] }, ERLAUBT).fehler, 'streamer');
pruefe('an ohne Auswahl', e.eingabePruefen({ ...gut, streamer: undefined }, ERLAUBT).fehler, 'leer');
pruefe('aus ohne Auswahl ist erlaubt', e.eingabePruefen({ modus: 'melden', nachlauf_min: '15' }, ERLAUBT).ok, true);
pruefe('fehlendes Kaestchen heisst aus', e.eingabePruefen({ modus: 'melden', nachlauf_min: '15' }, ERLAUBT).werte.aktiv, false);

console.log('\nNachrichten im Ankuendigungskanal');
const ang = e.hinweisText({ art: 'angekuendigt', server_name: 'Fires *Valheim* Bude', nachlauf_min: 15 });
pruefe('Ankuendigung nennt Server und Minuten', ang.includes('**Fires Valheim Bude**') && ang.includes('15 Minuten'), true);
pruefe('Markdown aus dem Namen entfernt', ang.includes('*Valheim*'), false);
pruefe('abgebrochen, wieder live mit Namen', e.hinweisText({ art: 'abgebrochen', server_name: 'X', grund: 'wieder_live', login: 'nitrinax' }).includes('nitrinax ist wieder live'), true);
pruefe('abgebrochen, Spieler da', e.hinweisText({ art: 'abgebrochen', server_name: 'X', grund: 'spieler_da' }).includes('noch jemand auf dem Server'), true);
pruefe('gestoppt', e.hinweisText({ art: 'gestoppt', server_name: 'X' }), '🎮 **X** wird jetzt gestoppt.');

console.log('\nSpielerzahl des Gameserver-Anbieters');
const JETZT = Date.parse('2026-09-15T12:00:00Z');
const vor = (ms) => new Date(JETZT - ms).toISOString();
pruefe('frisch, 0 Spieler', spielerzahl({ players_current: 0, queried_at: vor(60_000), online: 1 }, JETZT), 0);
pruefe('frisch, 2 Spieler', spielerzahl({ players_current: 2, queried_at: vor(60_000), online: 1 }, JETZT), 2);
pruefe('keine Statuszeile', spielerzahl(null, JETZT), null);
pruefe('players_current null', spielerzahl({ players_current: null, queried_at: vor(1000), online: 1 }, JETZT), null);
pruefe('Abfrage gescheitert (online = 0)', spielerzahl({ players_current: 0, queried_at: vor(1000), online: 0 }, JETZT), null);
pruefe('ohne Zeitpunkt', spielerzahl({ players_current: 0, online: 1 }, JETZT), null);
pruefe('zu alt: der Poller steht', spielerzahl({ players_current: 0, queried_at: vor(SPIELER_GILT_MS + 1000), online: 1 }, JETZT), null);
pruefe('knapp noch gueltig', spielerzahl({ players_current: 0, queried_at: vor(SPIELER_GILT_MS - 1000), online: 1 }, JETZT), 0);

console.log(gescheitert === 0
    ? `\nErgebnis: ${geprueft} Faelle, 0 Abweichungen.\n`
    : `\nErgebnis: ${geprueft} Faelle, ${gescheitert} Abweichung(en).\n`);

process.exit(gescheitert === 0 ? 0 : 1);
