#!/usr/bin/env node
/**
 * Wer `gameserver.files.read` ruft, muss die Antwort dekodieren.
 *
 * ── Der Befund (Baustelle 135, 2026-09-17) ──────────────────────────────────
 *
 * Der Daemon gibt Dateiinhalte IMMER base64-kodiert zurueck —
 * `HandleFileRead` in `internal/gameserver/files.go` endet mit
 * `base64.StdEncoding.EncodeToString(content)`. Zwei Aufrufer wussten das,
 * einer nicht: Die Ladestand-Route gab den rohen Wert an den BepInEx-Parser.
 *
 * Der findet in Base64 nichts — keine `[Message: BepInEx]`-Zeile, kein
 * `Chainloader startup complete`. Also meldete die Modseite bei JEDEM Server
 * und JEDEM Start „das Laden wurde nicht abgeschlossen" und jede Modzeile
 * „kommt im Log des letzten Starts nicht vor".
 *
 * **Das ist die gefaehrliche Sorte Fehler:** Er sieht aus wie eine Messung.
 * Der Betreiber hat ihr geglaubt und nach einem Mod-Fehler gesucht.
 *
 * Geprueft wird: Jede Stelle, die `gameserver.files.read` schickt, holt sich
 * `.content` und reicht es NICHT weiter, ohne vorher zu dekodieren.
 *
 *   node scripts/check-daemon-base64.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { ohneKommentare } = require('./lib/quelltext');

const WURZEL = path.join(__dirname, '..');
const SUCHE = [
    'plugins/gameserver/dashboard/routes',
    'plugins/gameserver/dashboard/helpers',
    'plugins/masterserver/dashboard',
];

let fehler = 0;
const pruefe = (ok, was, zusatz = '') => {
    console.log(`  ${ok ? '✅' : '❌'} ${was}${zusatz ? '\n       ' + zusatz : ''}`);
    if (!ok) fehler++;
};

function dateien(v, treffer = []) {
    if (!fs.existsSync(v)) return treffer;
    for (const e of fs.readdirSync(v, { withFileTypes: true })) {
        const voll = path.join(v, e.name);
        if (e.isDirectory()) dateien(voll, treffer);
        else if (e.name.endsWith('.js')) treffer.push(voll);
    }
    return treffer;
}

// Befehle, deren Antwort base64-kodiert ist. Kommt einer dazu, gehoert er hier
// hinein — und die Ausnahme darunter ist eine Liste, kein stilles Ueberspringen.
const KODIERT = ['gameserver.files.read'];

console.log('\n▸ Wer eine kodierte Daemon-Antwort liest, dekodiert sie auch');

let gefunden = 0;
for (const ordner of SUCHE) {
    for (const datei of dateien(path.join(WURZEL, ordner))) {
        const text = ohneKommentare(fs.readFileSync(datei, 'utf8'));
        const kurz = path.relative(WURZEL, datei);

        for (const befehl of KODIERT) {
            let von = 0;
            while (true) {
                const i = text.indexOf(`'${befehl}'`, von);
                if (i < 0) break;
                von = i + 1;
                gefunden++;

                // Der Abschnitt bis zum naechsten sendCommand oder 2500 Zeichen —
                // darin muss die Dekodierung stehen.
                const naechste = text.indexOf('sendCommand', i + befehl.length + 2);
                const bis = naechste > 0 ? Math.min(naechste, i + 2500) : i + 2500;
                const block = text.slice(i, bis);

                // Wird `.content` ueberhaupt angefasst?
                if (!/\.content\b/.test(block)) {
                    pruefe(true, `${kurz}: ${befehl} — liest kein .content`,
                        'nur abgeschickt, nichts ausgewertet');
                    continue;
                }
                const dekodiert = /Buffer\.from\([^)]*content[^)]*,\s*['"]base64['"]\)/.test(block)
                               || /Buffer\.from\(\s*String\([^)]*content[^)]*\)\s*,\s*['"]base64['"]\)/.test(block);
                pruefe(dekodiert, `${kurz}: ${befehl} → .content wird dekodiert`,
                    dekodiert ? '' :
                    'Der Daemon liefert Base64 (files.go: EncodeToString). Roh weitergereicht '
                    + 'findet ein Parser NICHTS und meldet das als Messergebnis.');
            }
        }
    }
}

pruefe(gefunden > 0, `${gefunden} Aufruf(e) geprueft`,
    gefunden > 0 ? '' : 'keiner gefunden — dann stimmt die Suchliste in diesem Skript nicht mehr');

console.log(fehler === 0
    ? '\n✅ Jede kodierte Antwort wird dekodiert\n'
    : `\n❌ ${fehler} Abweichung(en)\n`);
process.exit(fehler === 0 ? 0 : 1);
