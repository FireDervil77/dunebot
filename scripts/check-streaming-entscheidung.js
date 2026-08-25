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

// ---------------------------------------------------------------
console.log('\nSchonfrist fuer frische Sendungen');
// ---------------------------------------------------------------
pruefe('gerade begonnen -> in Ruhe lassen',
    e.inSchonfrist(new Date(JETZT - 1 * MIN), JETZT, 10 * MIN), true);
pruefe('kurz vor Ablauf -> immer noch',
    e.inSchonfrist(new Date(JETZT - 9 * MIN), JETZT, 10 * MIN), true);
pruefe('genau abgelaufen -> anfassen',
    e.inSchonfrist(new Date(JETZT - 10 * MIN), JETZT, 10 * MIN), false);
pruefe('lange her -> anfassen',
    e.inSchonfrist(new Date(JETZT - 3 * 60 * MIN), JETZT, 10 * MIN), false);
// Gegenprobe: Ohne Startzeit gibt es keinen Schutz - sonst bliebe ein Zustand
// ohne `begonnen_am` fuer immer auf "live" stehen.
pruefe('ohne Startzeit -> keine Schonfrist',
    e.inSchonfrist(null, JETZT, 10 * MIN), false);
pruefe('unlesbare Startzeit -> keine Schonfrist',
    e.inSchonfrist('kein Datum', JETZT, 10 * MIN), false);
pruefe('Start in der Zukunft -> keine Schonfrist',
    e.inSchonfrist(new Date(JETZT + 5 * MIN), JETZT, 10 * MIN), false);

// ---------------------------------------------------------------
console.log('\nRuhezeiten');
// ---------------------------------------------------------------
const U = (h, m = 0) => h * 60 + m;

pruefe('ohne Zeiten keine Ruhe',            e.inRuhezeit(null, null, U(3)), false);
pruefe('nur Beginn gesetzt -> keine Ruhe',  e.inRuhezeit('23:00', null, U(3)), false);
pruefe('Fenster am Tag, mittendrin',        e.inRuhezeit('09:00', '17:00', U(12)), true);
pruefe('Fenster am Tag, davor',             e.inRuhezeit('09:00', '17:00', U(8)), false);
pruefe('Fenster am Tag, genau Beginn',      e.inRuhezeit('09:00', '17:00', U(9)), true);
pruefe('Fenster am Tag, genau Ende',        e.inRuhezeit('09:00', '17:00', U(17)), false);

// Der Fall, den man vergisst: ueber Mitternacht. Ein schlichtes
// "jetzt >= von && jetzt < bis" waere hier IMMER falsch.
pruefe('ueber Mitternacht, nachts um 3',    e.inRuhezeit('23:00', '08:00', U(3)), true);
pruefe('ueber Mitternacht, abends um 23',   e.inRuhezeit('23:00', '08:00', U(23)), true);
pruefe('ueber Mitternacht, 22:59 noch nicht', e.inRuhezeit('23:00', '08:00', U(22, 59)), false);
pruefe('ueber Mitternacht, mittags frei',   e.inRuhezeit('23:00', '08:00', U(12)), false);
pruefe('ueber Mitternacht, 08:00 vorbei',   e.inRuhezeit('23:00', '08:00', U(8)), false);

// Gegenproben: Ein Eingabefehler darf Ankuendigungen nicht fuer immer abschalten.
pruefe('gleiche Zeiten -> KEINE Ruhe (nicht ganztaegig)', e.inRuhezeit('10:00', '10:00', U(10)), false);
pruefe('Unsinn statt Uhrzeit -> keine Ruhe', e.inRuhezeit('abends', '08:00', U(3)), false);
pruefe('Stunde 25 -> keine Ruhe',            e.inRuhezeit('25:00', '08:00', U(3)), false);
pruefe('mit Sekunden geht auch',             e.inRuhezeit('23:00:00', '08:00:00', U(3)), true);

// ---------------------------------------------------------------
console.log('\nAusschlussfilter');
// ---------------------------------------------------------------
const zielAus = (t) => ({ aktiv: 1, ...t });

pruefe('ausgeschlossenes Spiel -> nicht melden',
    e.zielPasst(zielAus({ filter_spiel_aus: 'Just Chatting' }), { kategorie: 'Just Chatting', titel: 'x' }).passt, false);
pruefe('anderes Spiel -> melden',
    e.zielPasst(zielAus({ filter_spiel_aus: 'Just Chatting' }), { kategorie: 'Minecraft', titel: 'x' }).passt, true);
pruefe('Gross- und Kleinschreibung egal',
    e.zielPasst(zielAus({ filter_spiel_aus: 'just chatting' }), { kategorie: 'Just Chatting', titel: 'x' }).passt, false);
pruefe('mehrere ausgeschlossen, zweites trifft',
    e.zielPasst(zielAus({ filter_spiel_aus: 'Minecraft, Just Chatting' }), { kategorie: 'Just Chatting', titel: 'x' }).passt, false);
pruefe('ausgeschlossenes Titelwort -> nicht melden',
    e.zielPasst(zielAus({ filter_titel_aus: 'test' }), { kategorie: 'x', titel: 'Nur ein TEST heute' }).passt, false);
pruefe('Titel ohne das Wort -> melden',
    e.zielPasst(zielAus({ filter_titel_aus: 'test' }), { kategorie: 'x', titel: 'Ernsthafter Stream' }).passt, true);

// Der wichtigste Fall: Ausschluss schlaegt Erlaubnis. Ein doppelt eingetragenes
// Spiel fuehrt zu einer Meldung ZU WENIG, nicht zu einer zu viel.
pruefe('in beiden Listen -> nicht melden',
    e.zielPasst(zielAus({ filter_spiel: 'Minecraft', filter_spiel_aus: 'Minecraft' }), { kategorie: 'Minecraft', titel: 'x' }).passt, false);
// Die Reihenfolge entscheidet nicht ueber das Urteil (beide Pruefungen muessen
// bestehen), sondern ueber die BEGRUENDUNG - und die liest ein Mensch.
//
// Der Fall muss so gebaut sein, dass BEIDE Pruefungen ablehnen, aber mit
// verschiedenem Grund: Kategorie steht nicht auf der Erlaubnisliste UND steht
// auf der Ausschlussliste. Nur dann zeigt sich, welche zuerst lief. Zwei
// Anlaeufe davor waren so gebaut, dass die Reihenfolge gar nichts aenderte -
// und blieben deshalb gruen, egal wie der Code aussah.
pruefe('    Begruendung nennt den Ausschluss, nicht die Erlaubnisliste',
    /ausgeschlossen/.test(e.zielPasst(
        zielAus({ filter_spiel: 'Fortnite', filter_spiel_aus: 'Minecraft' }),
        { kategorie: 'Minecraft', titel: 'x' }).grund), true);

// Auch ein reiner Ausschlussfilter muss auf die Anreicherung warten - sonst
// meldet er genau das, was er ausschliessen sollte.
pruefe('Ausschluss ohne Kategorie -> wartet',
    e.zielPasst(zielAus({ filter_spiel_aus: 'Just Chatting' }), { titel: 'x' }).wartetAufAnreicherung, true);

// Ruhezeit im Zusammenspiel
pruefe('Ruhezeit schlaegt alles',
    e.zielPasst(zielAus({ ruhe_von: '23:00', ruhe_bis: '08:00' }), { kategorie: 'x', titel: 'x', minutenJetzt: U(3) }).passt, false);
pruefe('ausserhalb der Ruhezeit normal',
    e.zielPasst(zielAus({ ruhe_von: '23:00', ruhe_bis: '08:00' }), { kategorie: 'x', titel: 'x', minutenJetzt: U(12) }).passt, true);
pruefe('ohne minutenJetzt greift die Ruhezeit nicht',
    e.zielPasst(zielAus({ ruhe_von: '23:00', ruhe_bis: '08:00' }), { kategorie: 'x', titel: 'x' }).passt, true);

// ---------------------------------------------------------------
console.log('\nVergleichswert der Nachricht');
// ---------------------------------------------------------------
const A = { titel: 'Erster Versuch', kategorie: 'Minecraft', vorschaubild: 'https://x/1.jpg', zuschauer: 42 };

pruefe('gleicher Inhalt -> gleicher Wert',
    e.inhaltsStand(A) === e.inhaltsStand({ ...A }), true);
pruefe('anderer Titel -> anderer Wert',
    e.inhaltsStand(A) === e.inhaltsStand({ ...A, titel: 'Zweiter' }), false);
pruefe('andere Kategorie -> anderer Wert',
    e.inhaltsStand(A) === e.inhaltsStand({ ...A, kategorie: 'Fortnite' }), false);
pruefe('anderes Bild -> anderer Wert',
    e.inhaltsStand(A) === e.inhaltsStand({ ...A, vorschaubild: 'https://x/2.jpg' }), false);

// **Der Fall, um den es geht.** Nimmt man die Zuschauerzahl in den Wert auf,
// aendert er sich bei jedem Anreicherungslauf - und die Bearbeitungsschleife,
// die dieser Vergleich verhindern soll, waere sofort wieder da.
pruefe('andere Zuschauerzahl -> GLEICHER Wert',
    e.inhaltsStand(A) === e.inhaltsStand({ ...A, zuschauer: 999 }), true);

// Leere Angaben duerfen nicht ineinanderfallen: Ein Titel "a" ohne Kategorie
// darf nicht denselben Wert haben wie kein Titel mit Kategorie "a".
pruefe('leer und gesetzt sind unterscheidbar',
    e.inhaltsStand({ titel: 'a' }) === e.inhaltsStand({ kategorie: 'a' }), false);
pruefe('null und leerer Text gelten gleich',
    e.inhaltsStand({ titel: null }) === e.inhaltsStand({ titel: '' }), true);
pruefe('leerer Zustand stuerzt nicht ab',
    typeof e.inhaltsStand({}), 'string');
pruefe('ohne Argument auch nicht',
    typeof e.inhaltsStand(), 'string');

console.log(gescheitert === 0
    ? `\nErgebnis: ${geprueft} Faelle, 0 Abweichungen.\n`
    : `\nErgebnis: ${geprueft} Faelle, ${gescheitert} Abweichung(en).\n`);

process.exit(gescheitert === 0 ? 0 : 1);
