#!/usr/bin/env node
/**
 * Prueft den **Chat-Eingang** (Conduit, Stufe 13a).
 *
 * Fuenf Regeln, und jede haelt einen Fehler fest, der schon einmal Geld
 * gekostet hat:
 *
 *   1. **Nichts zwischen Welcome und PATCH.** Twitch: *„you have 10 seconds
 *      from the time you receive the Welcome message to associate it with a
 *      shard."* Deshalb liegt der Conduit im Dashboard und nicht im Bot: Ein
 *      IPC-Umweg laege in diesem Fenster, und am 2026-08-27 haben IPC-Handler
 *      1200 s gebraucht (Baustelle 82).
 *   2. **Ein Conduit, nicht zwei.** `conduitSichern` muss erst suchen. Ein
 *      zweiter waere nicht falsch, aber die Abos haengen an genau einem -
 *      niemand wuesste mehr, welcher der echte ist.
 *   3. **Verdrahtet, nicht nur vorhanden.** Ein Eingang, den niemand startet,
 *      ist das Muster, das dieses Projekt an anderen bemaengelt.
 *   4. **Die Leitung muss ausdruecklich geschlossen werden.** Ein WebSocket
 *      baut sich nach jedem Abriss selbst wieder auf; ohne `beenden()` laeuft
 *      er nach dem Abschalten des Plugins weiter.
 *   5. **Eine Wache gegen die stille Leitung.** Eine TCP-Verbindung kann offen
 *      aussehen und nichts mehr liefern; `close` kommt dann nie.
 *
 * Nebenwirkungsfrei: Quelltext und Attrappen, kein Twitch, keine Datenbank.
 *
 *   node scripts/check-conduit.js
 *
 * Exitcode 1 bei jeder Abweichung.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const WURZEL = path.join(__dirname, '..');
let faelle = 0;
let abweichungen = 0;

/**
 * @param {boolean} gut Bedingung
 * @param {string} text Beschreibung
 * @param {string} [zusatz] Warum es zaehlt
 * @returns {void}
 */
function pruefe(gut, text, zusatz = '') {
    faelle++;
    if (gut) { console.log(`  ✓ ${text}`); return; }
    abweichungen++;
    console.log(`  ✗ ${text}`);
    if (zusatz) console.log(`      → ${zusatz}`);
}

/** @param {string} p Pfad ab Projektwurzel @returns {string} Inhalt */
const lies = (p) => fs.readFileSync(path.join(WURZEL, p), 'utf8');

(async () => {

const conduitQuelle = lies('plugins/streaming/dashboard/eingang/conduit.js');
const twitchQuelle  = lies('plugins/streaming/dashboard/plattformen/twitch.js');
const indexQuelle   = lies('plugins/streaming/dashboard/index.js');

// ---------------------------------------------------------------------
console.log('\n1. Zwischen Welcome und PATCH liegt nichts');
// ---------------------------------------------------------------------

const welcome = conduitQuelle.slice(
    conduitQuelle.indexOf("case 'session_welcome'"),
    conduitQuelle.indexOf("case 'session_reconnect'"));

pruefe(/shardSetzen\(/.test(welcome),
    'der Welcome-Zweig setzt den Shard selbst',
    'ohne das bliebe der Conduit ohne Verbindung und lieferte nichts');
pruefe(!/fragBot|sendToDashboard|ipcServer|broadcast/.test(welcome),
    'und tut es OHNE Umweg ueber einen anderen Vorgang',
    'ein IPC-Aufruf laege im 10-Sekunden-Fenster — genau der Grund, warum der Conduit nicht im Bot liegt');
pruefe(!/await db\(\)|dbService|SELECT |INSERT /.test(welcome),
    'und ohne Datenbankabfrage dazwischen',
    'jede Millisekunde im 10-s-Fenster ist geliehen');

// Der Conduit gehoert ins Dashboard - im Bot-Teil darf er nicht auftauchen.
let imBot = false;
const botDir = path.join(WURZEL, 'plugins/streaming/bot');
const durchgehen = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const voll = path.join(d, e.name);
        if (e.isDirectory()) durchgehen(voll);
        else if (e.name.endsWith('.js') && /conduit|eventsub\.wss/i.test(fs.readFileSync(voll, 'utf8'))) imBot = true;
    }
};
durchgehen(botDir);
pruefe(!imBot, 'im Bot-Teil steht kein Conduit',
    'die Entscheidung vom 2026-08-28 legt ihn ins Dashboard — dort sind Token und Datenbank');

// ---------------------------------------------------------------------
console.log('\n2. Ein Conduit, nicht zwei');
// ---------------------------------------------------------------------

const sichern = twitchQuelle.slice(
    twitchQuelle.indexOf('async function conduitSichern'),
    twitchQuelle.indexOf('async function shardSetzen'));

const holen = sichern.indexOf("helix('/eventsub/conduits')");
const legen = sichern.indexOf("method: 'POST'");
pruefe(holen !== -1 && legen !== -1 && holen < legen,
    'conduitSichern sucht ERST und legt nur an, was fehlt',
    'sonst entstuende bei jedem Start ein weiterer, und die Abos haengen an genau einem');
pruefe(/neu: false/.test(sichern) && /neu: true/.test(sichern),
    'und sagt, ob er neu war',
    'sonst sieht ein versehentlich zweiter Conduit aus wie der alte');

pruefe(/SHARDS = 1/.test(conduitQuelle),
    'es wird genau ein Shard betrieben',
    'Twitch verteilt per Kanal-Hash — ein Shard ohne Verbindung verschluckte die halben Ereignisse');

// ---------------------------------------------------------------------
console.log('\n3. Verdrahtet, nicht nur vorhanden');
// ---------------------------------------------------------------------

pruefe(/require\('\.\/eingang\/conduit'\)\.starten\(\)/.test(indexQuelle),
    'das Plugin startet den Eingang',
    'ein Eingang ohne Aufrufer ist genau das Muster, das dieses Projekt jagt');
pruefe(/require\('\.\/eingang\/conduit'\)\.beenden\(\)/.test(indexQuelle),
    'und schliesst ihn beim Abschalten',
    'ohne das baut sich der WebSocket nach jedem Abriss weiter selbst auf');

// Der Start darf das Plugin nicht aufhalten und nicht mitreissen.
const startBlock = indexQuelle.slice(indexQuelle.indexOf("require('./eingang/conduit').starten()"));
pruefe(/\.catch\(/.test(startBlock.slice(0, 600)),
    'ein gescheiterter Eingang wird gefangen',
    'sonst nimmt ein abgelehnter Conduit das Dashboard mit');
pruefe(!/await require\('\.\/eingang\/conduit'\)\.starten/.test(indexQuelle),
    'und nicht abgewartet',
    'sonst haengt der Start des Plugins an Twitchs Erreichbarkeit');

// ---------------------------------------------------------------------
console.log('\n4. Die Wache gegen die stille Leitung');
// ---------------------------------------------------------------------

pruefe(/keepalive_timeout_seconds/.test(conduitQuelle),
    'Twitchs Keepalive-Frist wird gelesen, nicht geraten');
pruefe(/function wacheStellen/.test(conduitQuelle) && /clearTimeout\(wache\)/.test(conduitQuelle),
    'es gibt eine Wache, und sie wird zurueckgesetzt',
    'eine offene Leitung, die nichts mehr liefert, meldet kein `close`');
pruefe(/removeAllListeners/.test(conduitQuelle),
    'beim Neuaufbau werden die Zuhoerer abgeraeumt',
    'sonst loest das eigene `close` einen zweiten Neuaufbau aus — die Versuche verdoppeln sich je Abriss');

const {WARTEN_MS} = require(path.join(WURZEL, 'plugins/streaming/dashboard/eingang/conduit'));
pruefe(Array.isArray(WARTEN_MS) && WARTEN_MS.length > 1
       && WARTEN_MS.every((w, i) => i === 0 || w >= WARTEN_MS[i - 1]),
    `die Wartezeit waechst (${WARTEN_MS.join(', ')} ms)`,
    'ein fester kurzer Abstand haemmert bei einer Twitch-Stoerung dagegen');

// ---------------------------------------------------------------------
console.log('\n5. Fehlschlaege werden gemeldet, nicht geschluckt');
// ---------------------------------------------------------------------

pruefe(/Shard NICHT gesetzt/.test(conduitQuelle),
    'ein nicht gesetzter Shard wird als Fehler gemeldet',
    'ohne Shard liefert der Conduit nichts — und die Verbindung saehe gesund aus');

const setzen = twitchQuelle.slice(
    twitchQuelle.indexOf('async function shardSetzen'),
    twitchQuelle.indexOf('* Abonnement abbestellen'));
pruefe(/json\?\.errors/.test(setzen),
    'shardSetzen liest auch `errors`, nicht nur den Statuscode',
    'Twitch antwortet 202 und legt abgelehnte Shards trotzdem in `errors`');

pruefe(!/catch\s*\(\s*\)\s*\{\s*\}|catch\s*\{\s*\}\s*$/m.test(conduitQuelle.replace(/catch \{ \/\* [^*]*\*\/ \}/g, '')),
    'es gibt kein stilles Verschlucken',
    'ein leeres catch um einen benutzten Abruf ist immer ein Befund');

console.log(abweichungen === 0
    ? `\nErgebnis: ${faelle} Pruefungen, 0 Abweichungen.\n`
    : `\nErgebnis: ${faelle} Pruefungen, ${abweichungen} Abweichung(en).\n`);
process.exit(abweichungen === 0 ? 0 : 1);

})().catch(err => { console.error('\nAbbruch:', err.message, '\n', err.stack); process.exit(1); });
