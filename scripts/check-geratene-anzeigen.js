#!/usr/bin/env node
'use strict';

/**
 * Wächter: keine geratenen Werte in der Anzeige (Baustellen 143 und 144).
 *
 * ── Der Befund, aus dem er entstand ──────────────────────────────────────────
 *
 * Zwei Stellen taten am 2026-09-21 dasselbe, beide gut gemeint:
 *
 *   base_directory || '/opt/firebot-daemon'      (Rootserver-Seite)
 *   rootserver_sftp_port || 2022                 (Serverseite)
 *
 * Beide ersetzten ein „wir wissen es nicht" durch eine plausible Angabe. Und
 * beide waren als Verbesserung gedacht: Vorher stand der Wert **fest** im Code,
 * der Rückfall war der Schritt weg davon.
 *
 * Der Schaden ist ungleich verteilt:
 *
 *   · `2022` verspricht eine Verbindung, die nicht zustande kommt — gemessen:
 *     auf BEIDEN Rootservern ist `sftp_port` NULL, dort läuft keiner.
 *   · `/opt/firebot-daemon` ist schlimmer, weil der Pfad **existiert**. Er ist
 *     nur das falsche Ding: dort liegt der Daemon, nicht das Verzeichnis der
 *     Kundendaten. Ein nicht existierender Pfad fällt beim ersten `ls` auf. Ein
 *     existierender mit anderer Bedeutung führt jemanden bis in ein `rm` hinein.
 *
 * ── Die Regel, die er durchsetzt ─────────────────────────────────────────────
 *
 * **Ein Wert, den nur die Maschine kennt, wird gemeldet oder er fehlt.** Ein
 * Rückfall darauf, was wahrscheinlich stimmt, ist eine Messung, die niemand
 * gemacht hat. „Nicht gemeldet" ist eine vollständige Auskunft; eine erfundene
 * Zahl ist keine.
 *
 * Das gilt für Werte, die **von der Maschine kommen** — nicht für Vorgaben, die
 * wir selbst setzen. `max="4096"` an einem Eingabefeld ist eine Vorgabe, keine
 * Messung, und bleibt erlaubt.
 *
 * Aufruf:  node scripts/check-geratene-anzeigen.js
 * Rückgabe: 0 = niemand rät, 1 = mindestens eine Stelle rät.
 */

const fs = require('fs');
const path = require('path');
const { ohneKommentare, ohneKommentareEjs } = require('./lib/quelltext');

const WURZEL = path.join(__dirname, '..');

/**
 * Was gemeldet wird und deshalb nicht geraten werden darf.
 *
 * Je Eintrag: das Feld, wo es herkommt, und was ein Rückfall dort anrichten
 * würde. Der Grund gehört dazu — ein Wächter ohne Begründung wird beim ersten
 * Umbau weggeräumt.
 */
const GEMELDETE_WERTE = [
    {
        feld: 'base_directory',
        quelle: 'Daemon, bei jeder Anmeldung (ab 1.0.75)',
        schaden: 'Ein Rückfall zeigt einen Pfad, den es gibt, der aber das falsche Ding ist.',
        dateien: [
            'plugins/masterserver/dashboard/views/guild/masterserver-rootserver-detail.ejs',
            'plugins/masterserver/dashboard/models/RootServer.js',
        ],
    },
    {
        feld: 'rootserver_sftp_port',
        quelle: 'Daemon, aus dem laufenden Listener',
        schaden: 'Ein Rückfall verspricht eine Verbindung, die nicht zustande kommt.',
        dateien: ['plugins/gameserver/dashboard/routes/servers.js'],
    },
    {
        feld: 'sftp_fingerprint',
        quelle: 'Daemon, bei jeder Anmeldung',
        schaden: 'Ein erfundener Fingerabdruck macht aus einer Prüfung ein Ritual.',
        dateien: [
            'plugins/gameserver/dashboard/routes/servers.js',
            'plugins/masterserver/dashboard/views/guild/masterserver-rootserver-detail.ejs',
        ],
    },
    {
        feld: 'abruf_port',
        quelle: 'Daemon, aus dem laufenden Zuhörer (B106)',
        schaden: 'Ein Knopf auf eine tote Adresse ist schlimmer als kein Knopf.',
        dateien: ['plugins/masterserver/dashboard/models/RootServer.js'],
    },
];

let geprueft = 0, fehler = 0;
const pruefe = (ok, was, zusatz = '') => {
    geprueft++;
    if (!ok) fehler++;
    console.log(`  ${ok ? '✅' : '❌'} ${was}${!ok && zusatz ? '\n       ' + zusatz : ''}`);
};

/**
 * Findet `feld || <etwas>` und `feld ?? <etwas>` — außer wenn das Etwas `null`
 * oder `undefined` ist. `|| null` ist genau die richtige Form: Es sagt „ich weiß
 * es nicht", statt es zu erfinden.
 */
function ratestellen(inhalt, feld) {
    const treffer = [];
    const re = new RegExp(`${feld}\\s*(?:\\|\\||\\?\\?)\\s*([^;,)\\n%]+)`, 'g');
    let m;
    while ((m = re.exec(inhalt)) !== null) {
        const wert = m[1].trim().replace(/[)\s]+$/, '');
        if (/^(null|undefined)$/.test(wert)) continue;
        treffer.push(wert);
    }
    return treffer;
}

console.log('\n▸ Gemeldete Werte werden nicht geraten\n');

for (const eintrag of GEMELDETE_WERTE) {
    for (const rel of eintrag.dateien) {
        const voll = path.join(WURZEL, rel);
        if (!fs.existsSync(voll)) {
            pruefe(false, `${rel} liegt da`);
            continue;
        }
        const roh = fs.readFileSync(voll, 'utf8');
        const inhalt = rel.endsWith('.ejs') ? ohneKommentareEjs(roh) : ohneKommentare(roh);
        const geraten = ratestellen(inhalt, eintrag.feld);
        pruefe(geraten.length === 0,
            `${eintrag.feld} in ${path.basename(rel)}`,
            `rät: ${geraten.join(' · ')}  —  ${eintrag.schaden} `
          + `Der Wert kommt vom ${eintrag.quelle}; fehlt er, gehört „nicht gemeldet" dorthin.`);
    }
}

// ── Die Gegenrichtung: sagt die Seite es auch? ───────────────────────────────
//
// Ein Feld ohne Rückfall ist erst dann eine Auskunft, wenn die Seite den leeren
// Fall AUSSPRICHT. Sonst steht dort nichts, und „nichts" liest jeder als „0"
// oder „egal".
console.log('\nDer leere Fall wird ausgesprochen');
const rsSeite = ohneKommentareEjs(
    fs.readFileSync(path.join(WURZEL,
        'plugins/masterserver/dashboard/views/guild/masterserver-rootserver-detail.ejs'), 'utf8'));
pruefe(/nicht gemeldet/.test(rsSeite),
    'die Rootserver-Seite sagt „nicht gemeldet", wo nichts gemeldet wurde',
    'Ein leeres Feld ist keine Auskunft.');

console.log(`\n${fehler === 0 ? '✅' : '❌'} ${geprueft - fehler} von ${geprueft} Prüfungen bestanden`);
if (fehler === 0) {
    console.log('   Was nur die Maschine weiß, wird gemeldet oder fehlt — nicht geraten.\n');
} else {
    console.log('');
}
process.exit(fehler === 0 ? 0 : 1);
