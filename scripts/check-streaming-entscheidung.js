#!/usr/bin/env node
/**
 * Prueft den Zustandsautomaten des Streaming-Plugins.
 *
 * `kern/entscheidung.js` beantwortet ohne Datenbank und ohne Twitch drei
 * Fragen: Wird gemeldet? Wird aufgeraeumt? Passt ein Ziel? Daran haengen alle
 * schwierigen Faelle — Doppel-Pings nach einem Abriss, Aufraeumen, Filter, die
 * erst nach der Anreicherung entscheidbar sind.
 *
 * Das sind Faelle, die man an einer laufenden Anlage kaum herstellen kann: Man
 * muesste einen Stream mitten in der Nacht abreissen lassen. Hier dauert es
 * Millisekunden.
 *
 *   node scripts/check-streaming-entscheidung.js
 *
 * Exitcode 1, wenn ein Fall scheitert.
 */
'use strict';

const e = require('../plugins/streaming/dashboard/kern/entscheidung');

let geprueft = 0, gescheitert = 0;

/**
 * @param {string} was Beschreibung
 * @param {*} ist Ergebnis
 * @param {*} soll Erwartung
 * @param {string} [zusatz] Begruendung aus der Entscheidung
 */
function pruefe(was, ist, soll, zusatz = '') {
    geprueft++;
    const gut = ist === soll;
    if (!gut) gescheitert++;
    console.log(`  ${gut ? '✓' : '✗'} ${was}: ${ist}${gut ? '' : ` (soll: ${soll})`}${zusatz ? `  — ${zusatz}` : ''}`);
}

const MIN = 60_000;
const JETZT = Date.parse('2026-08-24T12:00:00Z');
const vor = (minuten) => new Date(JETZT - minuten * MIN).toISOString();

console.log('\nging_live — der Normalfall');
{
    let r = e.beiGingLive({ sendung_id: 'A' }, null, {}, JETZT);
    pruefe('nie gesehener Streamer', r.handlung, 'melden', r.grund);

    r = e.beiGingLive({ sendung_id: 'B' },
        { ist_live: 0, sendung_id: 'A', beendet_am: vor(300), zuletzt_gemeldet_am: vor(300) }, {}, JETZT);
    pruefe('neue Sendung nach fuenf Stunden', r.handlung, 'melden', r.grund);
}

console.log('\nging_live — die Faelle, die Doppel-Pings erzeugen wuerden');
{
    let r = e.beiGingLive({ sendung_id: 'A' },
        { ist_live: 1, sendung_id: 'A', zuletzt_gemeldet_am: vor(1) }, {}, JETZT);
    pruefe('dieselbe Sendung noch einmal gemeldet', r.handlung, 'nichts', r.grund);

    // Der Fall, den die Marktanalyse als "klassischen Fehler" nennt: Twitch
    // vergibt nach einem Abriss eine NEUE Kennung.
    r = e.beiGingLive({ sendung_id: 'B' },
        { ist_live: 1, sendung_id: 'A', zuletzt_gemeldet_am: vor(3) }, {}, JETZT);
    pruefe('neue Kennung 3 min nach der Meldung', r.handlung, 'aktualisieren', r.grund);

    r = e.beiGingLive({ sendung_id: 'B' },
        { ist_live: 0, beendet_am: vor(1), zuletzt_gemeldet_am: vor(60) }, {}, JETZT);
    pruefe('Wiederkehr 1 min nach dem Ende (Karenz 2)', r.handlung, 'aktualisieren', r.grund);

    r = e.beiGingLive({ sendung_id: 'B' },
        { ist_live: 0, beendet_am: vor(5), zuletzt_gemeldet_am: vor(60) }, {}, JETZT);
    pruefe('Wiederkehr 5 min nach dem Ende', r.handlung, 'melden', r.grund);
}

console.log('\nging_live — eigene Zeitwerte der Guild');
{
    let r = e.beiGingLive({ sendung_id: 'B' },
        { ist_live: 0, beendet_am: vor(4), zuletzt_gemeldet_am: vor(60) },
        { karenzMinuten: 10 }, JETZT);
    pruefe('Karenz auf 10 min gesetzt, Wiederkehr nach 4', r.handlung, 'aktualisieren', r.grund);

    r = e.beiGingLive({ sendung_id: 'B' },
        { ist_live: 1, sendung_id: 'A', zuletzt_gemeldet_am: vor(20) },
        { abklingzeitMinuten: 5 }, JETZT);
    pruefe('Abklingzeit auf 5 min, letzte Meldung vor 20', r.handlung, 'melden', r.grund);
}

console.log('\nbeendet');
{
    let r = e.beiBeendet({}, { ist_live: 1, sendung_id: 'A' });
    pruefe('laufende Sendung endet', r.handlung, 'aufraeumen', r.grund);

    r = e.beiBeendet({}, { ist_live: 0 });
    pruefe('Ende ohne vorheriges Live', r.handlung, 'nichts', r.grund);

    r = e.beiBeendet({}, null);
    pruefe('Ende ohne jeden Zustand', r.handlung, 'nichts', r.grund);
}

console.log('\nZiele und Filter');
{
    let r = e.zielPasst({ aktiv: 1 }, { kategorie: 'Fortnite', titel: 'Abendrunde' });
    pruefe('ohne Filter', r.passt, true, r.grund);

    r = e.zielPasst({ aktiv: 0 }, {});
    pruefe('abgeschaltetes Ziel', r.passt, false, r.grund);

    r = e.zielPasst({ aktiv: 1, filter_spiel: 'Fortnite, Valheim' }, { kategorie: 'Valheim' });
    pruefe('Spiel steht in der Liste', r.passt, true, r.grund);

    r = e.zielPasst({ aktiv: 1, filter_spiel: 'Fortnite' }, { kategorie: 'Just Chatting' });
    pruefe('Spiel steht nicht in der Liste', r.passt, false, r.grund);

    r = e.zielPasst({ aktiv: 1, filter_spiel: 'fortnite' }, { kategorie: 'Fortnite' });
    pruefe('Gross- und Kleinschreibung egal', r.passt, true, r.grund);

    r = e.zielPasst({ aktiv: 1, filter_titel: 'ranked' }, { titel: 'Heute RANKED bis Diamant' });
    pruefe('Stichwort im Titel', r.passt, true, r.grund);

    r = e.zielPasst({ aktiv: 1, filter_titel: 'ranked' }, { titel: 'Gemuetlich bauen' });
    pruefe('Stichwort fehlt', r.passt, false, r.grund);

    // Der Fall, der beim Bauen leicht uebersehen wird: Beim Eintreffen von
    // stream.online sind Titel und Kategorie noch NICHT bekannt.
    r = e.zielPasst({ aktiv: 1, filter_spiel: 'Fortnite' }, {});
    pruefe('Filter, aber Angaben fehlen -> nicht melden', r.passt, false, r.grund);
    pruefe('   und ausdruecklich: wartet auf Anreicherung', r.wartetAufAnreicherung, true);

    r = e.zielPasst({ aktiv: 1 }, {});
    pruefe('ohne Filter wartet nichts', r.wartetAufAnreicherung, false, r.grund);
}

console.log(gescheitert === 0
    ? `\nErgebnis: ${geprueft} Faelle, 0 Abweichungen.\n`
    : `\nErgebnis: ${geprueft} Faelle, ${gescheitert} Abweichung(en).\n`);

process.exit(gescheitert === 0 ? 0 : 1);
