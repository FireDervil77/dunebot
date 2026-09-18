#!/usr/bin/env node
/**
 * Rechnen Server und Browser dieselben Kachelzahlen?
 *
 * ── Warum es die Rechnung zweimal gibt (2026-09-19, Baustelle 140) ──────────
 *
 * Beim Zusammenlegen der beiden Serveruebersichten wanderten die vier Kacheln
 * („Gesamte Server", „Online", „Offline", „Spieler") auf die Seite
 * `/plugins/gameserver/servers`. Sie werden an zwei Stellen gerechnet:
 *
 *   - **Beim Aufbau der Seite** in `Serverseite.baueServerListe()`, aus
 *     derselben Liste, die auch die Tabelle fuellt.
 *   - **Danach im Browser** in `gameserver-live.js:summen()`, aus den
 *     Live-Zustaenden, damit die Kachel mitzaehlt, ohne dass jemand neu laedt.
 *
 * **Zwei Wege fuer dieselbe Zahl sind sonst genau das, was hier nicht sein
 * soll.** Sie sind hier unvermeidbar — der Server kann nicht in den offenen
 * Browser hineinrechnen, und der Browser hat beim ersten Bild noch keine
 * Live-Daten. Vermeidbar ist nur, dass sie AUSEINANDERLAUFEN: Dann springt die
 * Kachel beim ersten Abruf von „2" auf „1", und niemand weiss, welche stimmt.
 *
 * Dieses Skript haelt beide gegen dieselben Eingaben.
 *
 * ── Die drei Fallen, die es abdeckt ─────────────────────────────────────────
 *
 * 1. `alle` ist NICHT `online + aus`. Wer gerade startet, zaehlt in keiner der
 *    beiden Kacheln. Eine der beiden Rechnungen auf „alles was nicht online
 *    ist, ist aus" umzustellen, faellt im Betrieb erst auf, wenn jemand einen
 *    Server startet und zusieht.
 * 2. `null` bei der Spielerzahl heisst **nicht gemessen**, nicht 0. Eine Summe,
 *    die `null` als 0 nimmt, ist zufaellig richtig — bis ein Server antwortet.
 * 3. Unbekannte Zustaende (`error`, `installing`, `updating`) zaehlen nur in
 *    `alle`.
 *
 *   node scripts/check-live-zahlen.js
 */
'use strict';
const path = require('path');

const WURZEL = path.join(__dirname, '..');
const { baueServerListe } = require(
    path.join(WURZEL, 'plugins/gameserver/dashboard/helpers/Serverseite.js'));
const { summen } = require(
    path.join(WURZEL, 'plugins/gameserver/dashboard/assets/js/gameserver-live.js'));

/**
 * Faelle, die im Betrieb wirklich vorkommen — nicht nur die bequemen.
 *
 * Jede Zeile ist ein Server, wie ihn die Datenbank liefert.
 */
const FAELLE = [
    {
        name: 'Der Stand aus dem Bild des Betreibers (2026-09-18)',
        zeilen: [
            { id: 1, name: 'Fires Valheim Bude (mods)', status: 'starting', current_players: null, max_players: 10, game_name: 'Valheim' },
            { id: 2, name: 'Fires Valheim Bude',        status: 'online',   current_players: 0,    max_players: 10, game_name: 'Valheim' },
        ],
        // Genau die Zahlen des Bildes: 2 gesamt, 1 online, 0 offline, 0 Spieler
        erwartet: { alle: 2, online: 1, aus: 0, spieler: 0 },
    },
    {
        name: 'Startender Server zaehlt weder online noch aus',
        zeilen: [
            { id: 1, status: 'online',   current_players: 2, max_players: 10 },
            { id: 2, status: 'starting', current_players: null, max_players: 10 },
            { id: 3, status: 'offline',  current_players: null, max_players: 10 },
        ],
        erwartet: { alle: 3, online: 1, aus: 1, spieler: 2 },
    },
    {
        name: 'Nicht gemessen ist nicht null',
        zeilen: [
            { id: 1, status: 'online', current_players: null, max_players: 10 },
            { id: 2, status: 'online', current_players: 0,    max_players: 10 },
            { id: 3, status: 'online', current_players: 7,    max_players: 10 },
        ],
        erwartet: { alle: 3, online: 3, aus: 0, spieler: 7 },
    },
    {
        name: 'Fehler, Installation und Aktualisierung zaehlen nur in alle',
        zeilen: [
            { id: 1, status: 'error',      current_players: null, max_players: 8 },
            { id: 2, status: 'installing', current_players: null, max_players: 8 },
            { id: 3, status: 'updating',   current_players: null, max_players: 8 },
            { id: 4, status: 'installed',  current_players: null, max_players: 8 },
            { id: 5, status: 'stopping',   current_players: null, max_players: 8 },
        ],
        erwartet: { alle: 5, online: 0, aus: 0, spieler: 0 },
    },
    {
        name: 'Gar keine Server',
        zeilen: [],
        erwartet: { alle: 0, online: 0, aus: 0, spieler: 0 },
    },
];

/**
 * Aus den Datenbankzeilen das machen, was der Live-Weg im Browser haelt.
 *
 * Das ist genau die Zuordnung aus `LiveAnzeige.holeAlles()`: `status` und
 * `current_players` kommen unveraendert aus `/servers/status`.
 */
function alsLiveZustand(zeilen) {
    return zeilen.map(z => ({ status: z.status, spieler: z.current_players }));
}

console.log('\n▸ Rechnen Server und Browser dieselben Kachelzahlen?\n');

let fehler = 0;

for (const fall of FAELLE) {
    const amServer  = baueServerListe(fall.zeilen).zahlen;
    const imBrowser = summen(alsLiveZustand(fall.zeilen));

    const abweichungen = [];
    for (const feld of ['alle', 'online', 'aus', 'spieler']) {
        if (amServer[feld] !== fall.erwartet[feld]) {
            abweichungen.push(`Server.${feld} = ${amServer[feld]}, erwartet ${fall.erwartet[feld]}`);
        }
        if (imBrowser[feld] !== fall.erwartet[feld]) {
            abweichungen.push(`Browser.${feld} = ${imBrowser[feld]}, erwartet ${fall.erwartet[feld]}`);
        }
    }

    if (!abweichungen.length) {
        console.log(`  ✅ ${fall.name}`);
        continue;
    }

    fehler += abweichungen.length;
    console.log(`  ❌ ${fall.name}`);
    for (const a of abweichungen) console.log(`       ${a}`);
}

console.log(`\n▸ ${FAELLE.length} Faelle, je 4 Zahlen, beide Rechnungen.`);
console.log(fehler === 0
    ? '\n✅ Server und Browser kommen auf dieselben Zahlen\n'
    : `\n❌ ${fehler} Abweichung(en) — die Kachel springt beim ersten Live-Abruf\n`);
process.exit(fehler === 0 ? 0 : 1);
