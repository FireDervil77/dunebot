#!/usr/bin/env node
/**
 * Kommt der Schalter „Mod-Lader aktiv" beim Daemon an?
 *
 * ── Warum das eine eigene Pruefung braucht (E6/B.12, 2026-09-08) ────────────
 *
 * Ob BepInEx scharf ist, weiss nur das Dashboard: Die Liste der Inhalte liegt in
 * `gameserver_content`, der Daemon fuehrt keinen eigenen Zustand (I4). Der
 * Schalter reist deshalb als **Feldname in einer JSON-Nutzlast** ueber die
 * WebSocket-Leitung:
 *
 *   Dashboard  StartPayload.js      payload.lader_aktiv = true|false
 *   Daemon     websocket/client.go  payload["lader_aktiv"].(bool)
 *   Daemon     auftrag_ablage.go    auftrag.Eingaben{ LaderAktiv: ... }
 *
 * **Ein Tippfehler auf einer Seite faellt nirgends auf.** Der Server startet,
 * nur ohne seinen Lader — und die Mods fehlen still. Genau die Sorte Fehler,
 * die man erst beim Spielen bemerkt, wie beim Sicherungsabruf (dort ist es die
 * Unterschrift, hier der Feldname).
 *
 *   node scripts/check-lader-vertrag.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const WURZEL = path.join(__dirname, '..');
const DAEMON = '/home/firedervil/firebot_daemon';
const FELD = 'lader_aktiv';

let fehler = 0;
const pruefe = (ok, was, zusatz = '') => {
    console.log(`  ${ok ? '✅' : '❌'} ${was}${zusatz ? '\n       ' + zusatz : ''}`);
    if (!ok) fehler++;
};

/** Kommentare weg — sonst zaehlt eine Begruendung als Verdrahtung. */
function ohneKommentare(text) {
    return text
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n').map(z => z.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');
}

function lies(datei) {
    if (!fs.existsSync(datei)) return null;
    return ohneKommentare(fs.readFileSync(datei, 'utf8'));
}

console.log(`\n▸ Der Schalter "${FELD}" auf beiden Seiten`);

// ── Dashboard: setzt das Feld ───────────────────────────────────────────────
const payload = lies(path.join(WURZEL, 'plugins/gameserver/dashboard/helpers/StartPayload.js'));
pruefe(payload !== null && new RegExp(`${FELD}\\s*:`).test(payload),
    'Das Dashboard setzt das Feld in der Startnutzlast',
    'StartPayload.js');

// Die drei Bedingungen sind am 2026-09-09 aus StartPayload.js in den Helfer
// gewandert — damit die Inhalte-Seite und der Startbefehl dieselbe Abfrage
// benutzen. Der Waechter ist mitgewandert, statt die Pruefung zu lockern:
// geprueft wird jetzt, dass die Bedingungen IM HELFER stehen und dass
// StartPayload ihn wirklich aufruft.
const helfer = lies(path.join(WURZEL, 'plugins/gameserver/dashboard/helpers/Inhalte.js'));

pruefe(helfer !== null && /art\s*=\s*\?/.test(helfer) && /ART_LADER/.test(helfer)
       && /aktiv\s*=\s*1/.test(helfer) && /status\s*=\s*'installiert'/.test(helfer),
    'Der Helfer prueft alle drei Bedingungen (Lader, aktiv, installiert)',
    'Ohne diese drei waere jeder Server mit irgendeinem Inhalt "modifiziert"');

pruefe(payload !== null && /require\('\.\/Inhalte'\)\.laderAktiv/.test(payload),
    'Die Startnutzlast fragt den Helfer, statt selbst zu rechnen',
    'Zwei Abfragen fuer dieselbe Frage driften auseinander');

pruefe(payload !== null && /async function buildStartPayload/.test(payload),
    'buildStartPayload ist asynchron',
    'Ohne das kaeme ein Versprechen statt der Nutzlast beim Daemon an');

// ── Und jeder Aufrufer wartet darauf ────────────────────────────────────────
const aufrufer = [
    'plugins/gameserver/dashboard/routes/servers.js',
    'plugins/gameserver/dashboard/helpers/CronWorker.js',
];
for (const rel of aufrufer) {
    const quelle = lies(path.join(WURZEL, rel));
    const treffer = (quelle || '').match(/(await\s+)?buildStartPayload\s*\(/g) || [];
    const ohneAwait = treffer.filter(t => !t.startsWith('await'));
    pruefe(treffer.length > 0 && ohneAwait.length === 0,
        `${path.basename(rel)} wartet auf buildStartPayload`,
        ohneAwait.length ? `${ohneAwait.length} Aufruf(e) ohne await` : `${treffer.length} Aufruf(e)`);
}

// ── Daemon: liest das Feld und reicht es weiter ─────────────────────────────
const client = lies(path.join(DAEMON, 'internal/websocket/client.go'));
const ablage = lies(path.join(DAEMON, 'internal/gameserver/auftrag_ablage.go'));

if (client === null || ablage === null) {
    console.log(`  · Daemon-Quelltext nicht gefunden (${DAEMON}) — die zwei Pruefungen`);
    console.log('    dazu entfallen. Das ist kein gruenes Ergebnis, sondern eine Luecke.');
    fehler++;
} else {
    pruefe(new RegExp(`payload\\["${FELD}"\\]`).test(client),
        'Der Daemon liest genau dieses Feld',
        'internal/websocket/client.go');
    pruefe(/LaderAktiv:\s*laderAktiv/.test(ablage),
        'Und reicht es an den Auftragsbau weiter',
        'internal/gameserver/auftrag_ablage.go');
}

console.log(fehler === 0
    ? '\n✅ Der Schalter kommt an — beide Seiten sprechen denselben Namen\n'
    : `\n❌ ${fehler} Abweichung(en) — der Server startet dann still ohne seine Mods\n`);
process.exit(fehler === 0 ? 0 : 1);
