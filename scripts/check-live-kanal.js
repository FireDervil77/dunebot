#!/usr/bin/env node
'use strict';

/**
 * Wächter: der Live-Kanal für die Gerätedaten (Baustelle 147, Weg B).
 *
 * ── Woher er kommt ───────────────────────────────────────────────────────────
 *
 * Gemessen am 2026-09-21: Den Kanal gab es zweimal (WebSocket runter, SSE rauf),
 * und die Gerätedaten benutzten ihn nicht. Sie entstanden alle 2 s, reisten alle
 * 30 s im Herzschlag, landeten im Namensraum `metrics` — den niemand hört — und
 * das zeichnende Modul hatte keinen Takt.
 *
 * Drei fertig gebaute Teile hingen nicht aneinander:
 *   `StatsEvent`                        kein Abonnent
 *   `SendGameServerResourceUsage`       kein Aufrufer
 *   `sse.on('resource_usage')`          feuerte nie
 *
 * Betreiber am 2026-09-22: „dann B und später C".
 *
 * ── Was dieser Wächter festhält ──────────────────────────────────────────────
 *
 * Nicht „gibt es die Datei", sondern die vier Entscheidungen, ohne die der Kanal
 * beim ersten Betrieb Schaden macht:
 *
 *  1. **Gedrosselt.** Der Stats-Strom liefert alle ~2 s. Ungedrosselt wären das
 *     bei fünfzig Servern 25 Nachrichten je Sekunde.
 *  2. **Flüchtig.** Nicht über `SendEvent`: Das puffert bei Verbindungsabriss in
 *     die SQLite und protokolliert jede Nachricht. Eine CPU-Messung von vor zehn
 *     Minuten nachzuliefern gibt eine Momentaufnahme als „jetzt" aus, und 2400
 *     Protokollzeilen die Stunde sagen nichts.
 *  3. **Kein zweiter Schreiber.** Der Herzschlag schreibt die Werte in die
 *     Datenbank (30 s). Der Live-Push schreibt NICHT — sonst 1200 UPDATEs die
 *     Stunde je Server für einen Wert, den niemand später liest.
 *  4. **Eine Formatierung.** Der Push trägt fertigen Text und fertige Farbe aus
 *     `baueMesswerte`. Eine zweite, knappere Formatierung im Browser würde
 *     driften: nach dem Push „12.5%", nach dem Neuladen „12,5 %".
 *
 * Aufruf:  node scripts/check-live-kanal.js
 * Rückgabe: 0 = der Kanal trägt und tut nichts, was er nicht soll.
 */

const fs = require('fs');
const path = require('path');
const { ohneKommentare } = require('./lib/quelltext');

const WURZEL = path.join(__dirname, '..');
const DAEMON = '/home/firedervil/firebot_daemon';

let geprueft = 0, fehler = 0;
const pruefe = (ok, was, zusatz = '') => {
    geprueft++;
    if (!ok) fehler++;
    console.log(`  ${ok ? '✅' : '❌'} ${was}${!ok && zusatz ? '\n       ' + zusatz : ''}`);
};

const roh = (datei) => fs.existsSync(datei) ? fs.readFileSync(datei, 'utf8') : null;

console.log('\n▸ Der Live-Kanal: gedrosselt, flüchtig, ein Schreiber, eine Formatierung\n');

// ════════════════════════════════════════════════════════════════════════════
console.log('Daemon — senden');
// ════════════════════════════════════════════════════════════════════════════
const server = ohneKommentare(roh(path.join(DAEMON, 'internal/gameserver/server.go')) || '');
const takt = server.match(/MESSWERT_TAKT = (\d+) \* time\.Second/);
pruefe(takt !== null && Number(takt[1]) >= 2,
    `der Takt ist eine Konstante und beträgt ${takt ? takt[1] : '?'} s`,
    'Ohne Drossel geht jede Messung des Stats-Stroms raus — bei fünfzig Servern 25 je Sekunde.');

const lebenslauf = ohneKommentare(roh(path.join(DAEMON, 'internal/gameserver/server_lifecycle_docker.go')) || '');
pruefe(/time\.Since\(letzteMeldung\) >= MESSWERT_TAKT/.test(lebenslauf),
    'die Drossel wird im Stats-Strom angewandt');
pruefe(/var letzteMeldung time\.Time/.test(lebenslauf),
    'und liegt je Server in ihrer eigenen Goroutine',
    'Eine gemeinsame Marke bräuchte eine Sperre — und würde alle Server auf einen Takt zwingen.');

const client = ohneKommentare(roh(path.join(DAEMON, 'internal/websocket/client.go')) || '');
pruefe(/func \(c \*Client\) SendeMesswerte\(/.test(client),
    'es gibt einen eigenen, flüchtigen Sender');

// Der Punkt: KEIN bufferEvent, KEIN Protokoll je Nachricht.
// Geschnitten an der NAECHSTEN Funktion, nicht nach n Zeichen: Ein Fenster von
// 900 Zeichen lief ueber das Ende hinaus bis in `bufferEvent` — und meldete
// dessen Namen als Befund im Sender. Ein Waechter, der ueber die Grenze seines
// Gegenstands hinausliest, misst den Nachbarn.
const iSende = client.indexOf('func (c *Client) SendeMesswerte(');
const iNaechste = iSende > -1 ? client.indexOf('\nfunc ', iSende + 1) : -1;
const senderBlock = (iSende > -1 && iNaechste > -1) ? client.slice(iSende, iNaechste) : '';
pruefe(senderBlock && !/bufferEvent/.test(senderBlock),
    'er puffert NICHT bei Verbindungsabriss',
    'Ein Messwert ist verderblich: nachgeliefert gibt er eine Momentaufnahme als „jetzt" aus, '
  + 'und die Puffertabelle läuft voll.');
pruefe(senderBlock && !/log\.Printf/.test(senderBlock),
    'und schreibt keine Zeile je Nachricht',
    'Bei zwei Servern im 3-Sekunden-Takt sind das 2400 Zeilen die Stunde, die nichts aussagen.');
pruefe(senderBlock && /!c\.connected \|\| c\.conn == nil/.test(senderBlock),
    'ohne Leitung fällt die Messung weg (statt sich zu stauen)');

const manager = ohneKommentare(roh(path.join(DAEMON, 'internal/gameserver/manager.go')) || '');
pruefe(/messwertKanal func\(map\[string\]interface\{\}\)/.test(manager)
    && /func \(m \*Manager\) SetzeMesswertKanal\(/.test(manager),
    'der Kanal ist vom gepufferten `sendEvent` getrennt');

const main = ohneKommentare(roh(path.join(DAEMON, 'cmd/daemon/main.go')) || '');
pruefe(/SetzeMesswertKanal\(/.test(main) && /SendeMesswerte\(/.test(main),
    'und in main.go verdrahtet',
    'Sonst bleibt er nil — und dann verhält sich alles wie vor dem 2026-09-22, lautlos.');

// ════════════════════════════════════════════════════════════════════════════
console.log('\nDashboard — weitergeben, nicht wegschreiben');
// ════════════════════════════════════════════════════════════════════════════
const plugin = ohneKommentare(roh(path.join(WURZEL, 'plugins/gameserver/dashboard/index.js')) || '');
const iHandler = plugin.indexOf('async _handleResourceUsage(');
const handler = iHandler > -1 ? plugin.slice(iHandler, plugin.indexOf('\n    async ', iHandler + 10)) : '';

pruefe(handler && !/UPDATE gameservers/.test(handler),
    'der Live-Handler schreibt NICHTS in die Datenbank',
    'Das tut der Herzschlag (30 s). Hier wären es 1200 UPDATEs die Stunde je Server für einen '
  + 'Wert, den niemand später liest — und ein zweiter Schreiber auf dieselben Spalten.');
pruefe(handler && /context\?\.guildId/.test(handler),
    'die Guild kommt aus dem Kontext, nicht aus einer Abfrage',
    'Sonst eine Abfrage je Messung für einen Wert, der sich nie ändert.');
pruefe(handler && /baueMesswerte\(/.test(handler),
    'gerechnet wird mit derselben Funktion wie auf der Serverseite',
    'Eine zweite Formatierung im Browser driftet: „12.5%" gegen „12,5 %".');
pruefe(handler && /Logger\.warn/.test(handler),
    'eine fehlende Guild wird gemeldet, nicht verschwiegen');

const ipm = ohneKommentare(roh(path.join(WURZEL, 'apps/dashboard/helpers/IPMServer.js')) || '');
pruefe(/eventRouter\.route\(message, \{[\s\S]{0,200}?guildId/.test(ipm),
    'der Kontext trägt die Guild-Kennung');

// ════════════════════════════════════════════════════════════════════════════
console.log('\nBrowser — zeichnen');
// ════════════════════════════════════════════════════════════════════════════
const live = ohneKommentare(roh(path.join(WURZEL,
    'plugins/gameserver/dashboard/assets/js/gameserver-live.js')) || '');
const iOn = live.indexOf("sse.on('resource_usage'");
const zuhoerer = iOn > -1 ? live.slice(iOn, iOn + 900) : '';

pruefe(zuhoerer && /d\.messwerte/.test(zuhoerer),
    'der Zuhörer nimmt die Messwerte an',
    'Bis zum 2026-09-22 nahm er nur die Spielerzahl — und feuerte nie.');
pruefe(zuhoerer && !/holeBald\(\)/.test(zuhoerer),
    'und holt NICHT nach',
    'Das Ereignis trägt alles Gezeichnete. Ein Abruf je Messwert wäre alle drei Sekunden eine '
  + 'Runde durch die Datenbank für Zahlen, die schon da sind.');
pruefe(zuhoerer && /installation:/.test(zuhoerer),
    'und behält die Installationsbahn',
    '`uebernimm` ersetzt `messwerte` als Block — ohne Zusammenlegen verschwände die Bahn bei '
  + 'der ersten Messung (Baustelle 44).');

// Keine zweite Formatierung im Browser.
pruefe(!/toLocaleString\('de-DE'\)/.test(live) && !/ GiB'/.test(live),
    'im Browser steht keine eigene Formatierung',
    'Text und Farbe kommen fertig vom Server.');

console.log(`\n${fehler === 0 ? '✅' : '❌'} ${geprueft - fehler} von ${geprueft} Prüfungen bestanden`);
if (fehler === 0) {
    console.log('   Die Messwerte reisen live — gedrosselt, flüchtig, mit einem Schreiber.\n');
} else {
    console.log('');
}
process.exit(fehler === 0 ? 0 : 1);
