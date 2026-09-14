#!/usr/bin/env node
/**
 * Halten Dashboard und Daemon dieselbe Herkunftsliste?
 *
 * ── Warum zwei Listen kein Doppel sind (E6/B.12, 2026-09-09) ────────────────
 *
 * Der Daemon laedt eine Adresse, die ihm jemand nennt (`gameserver.content.fetch`).
 * Ohne eine zweite Pruefung waere das ein Befehl, mit dem sich beliebige Dateien
 * auf die Maschine holen liessen. Deshalb stellt das Dashboard nur Adressen auf
 * erlaubten Hosts aus — und der Daemon glaubt ihm nicht, sondern prueft selbst.
 *
 * Dieselbe Bauform wie beim Sicherungsabruf, wo die Unterschrift auch auf
 * beiden Seiten geprueft wird.
 *
 * **Die Gefahr ist das Auseinanderdriften.** Wer im Dashboard eine Quelle
 * ergaenzt und den Daemon vergisst, bekommt eine Suche, die Treffer zeigt, und
 * eine Installation, die jedes Mal abgewiesen wird — ohne dass irgendwo steht,
 * warum. Umgekehrt waere schlimmer: eine Erlaubnis im Daemon, die niemand mehr
 * benutzt und die keiner prueft.
 *
 *   node scripts/check-herkunftsliste.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const WURZEL = path.join(__dirname, '..');
const DAEMON = '/home/firedervil/firebot_daemon';
const DAEMON_DATEI = 'internal/gameserver/inhalte_holen.go';

let fehler = 0;
const pruefe = (ok, was, zusatz = '') => {
    console.log(`  ${ok ? '✅' : '❌'} ${was}${zusatz ? '\n       ' + zusatz : ''}`);
    if (!ok) fehler++;
};

console.log('\n▸ Die Herkunftsliste auf beiden Seiten');

// ── Dashboard ───────────────────────────────────────────────────────────────
//
// Gefragt wird die WEICHE, nicht ein einzelner Anbieter: Seit dem 2026-09-14
// gibt es mehrere, und ein Waechter, der nur den ersten kennt, meldet gruen,
// waehrend der zweite abgewiesen wird.
const Quellen = require(path.join(WURZEL, 'plugins/gameserver/dashboard/helpers/Quellen.js'));
const HERKUNFT = Quellen.HERKUNFT;

pruefe(Array.isArray(HERKUNFT) && HERKUNFT.length > 0,
    'Das Dashboard nennt seine erlaubten Herkuenfte',
    `Quellen.js: ${HERKUNFT.join(', ')}`);

// Jeder Anbieter prueft selbst — eine gemeinsame Liste ohne Pruefung waere nur
// Zierde. Geprueft wird deshalb je Anbieter, dass SEINE Hosts durchkommen und
// die des anderen nicht.
for (const [name, anbieter] of Object.entries(Quellen.ANBIETER)) {
    const eigene = anbieter.HERKUNFT;
    const fremde = HERKUNFT.filter(h => !eigene.includes(h));
    pruefe(eigene.every(h => anbieter.istErlaubt(`https://${h}/x`)),
        `${anbieter.TITEL} laesst seine eigenen Hosts durch`, `${name}: ${eigene.join(', ')}`);
    pruefe(fremde.every(h => anbieter.istErlaubt(`https://${h}/x`) === false),
        `${anbieter.TITEL} laesst NUR seine eigenen durch`,
        fremde.length ? `fremd: ${fremde.join(', ')}` : 'kein anderer Anbieter zum Vergleich');
}

// ── Daemon ──────────────────────────────────────────────────────────────────
//
// Gelesen wird die Kartenliteral-Form `"host": true`. Ein Eintrag, der anders
// geschrieben ist, faellt hier durch — und das ist gewollt: Der Waechter darf
// nicht raten, was der Daemon meint.
const pfad = path.join(DAEMON, DAEMON_DATEI);
if (!fs.existsSync(pfad)) {
    console.log(`  · Daemon-Quelltext nicht gefunden (${pfad}) — die Pruefung entfaellt.`);
    console.log('    Das ist kein gruenes Ergebnis, sondern eine Luecke.');
    fehler++;
} else {
    const quelle = fs.readFileSync(pfad, 'utf8');
    const block = quelle.match(/var erlaubteHerkunft = map\[string\]bool\{([\s\S]*?)\n\}/);

    if (!block) {
        pruefe(false, 'Der Daemon hat eine Liste `erlaubteHerkunft`',
            `${DAEMON_DATEI}: nicht gefunden — heisst sie noch so?`);
    } else {
        const imDaemon = [...block[1].matchAll(/"([^"]+)"\s*:\s*true/g)].map(m => m[1]);
        pruefe(imDaemon.length > 0, 'Der Daemon nennt seine erlaubten Herkuenfte',
            `${DAEMON_DATEI}: ${imDaemon.join(', ')}`);

        const nurDashboard = HERKUNFT.filter(h => !imDaemon.includes(h));
        const nurDaemon = imDaemon.filter(h => !HERKUNFT.includes(h));

        pruefe(nurDashboard.length === 0,
            'Alles, was das Dashboard ausstellt, nimmt der Daemon auch an',
            nurDashboard.length
                ? `Nur im Dashboard: ${nurDashboard.join(', ')} — die Installation wird abgewiesen`
                : '');
        pruefe(nurDaemon.length === 0,
            'Der Daemon erlaubt nichts, was das Dashboard nicht ausstellt',
            nurDaemon.length
                ? `Nur im Daemon: ${nurDaemon.join(', ')} — eine Erlaubnis, die niemand prueft`
                : '');
    }
}

// ── Und die Pruefung selbst greift ──────────────────────────────────────────
//
// Eine Liste, die niemand befragt, waere dieselbe Luecke wie keine Liste.
const ts = Quellen.fuer('thunderstore');
pruefe(ts.istErlaubt('https://thunderstore.io/package/download/x/y/1.0.0/') === true,
    'Eine erlaubte Adresse kommt durch');
pruefe(ts.istErlaubt('https://boese-thunderstore.io/x.zip') === false,
    'Ein angehaengter Name kommt NICHT durch',
    'Exakter Namensvergleich, kein endsWith');
pruefe(ts.istErlaubt('http://thunderstore.io/x.zip') === false,
    'Ohne https kommt nichts durch');

const mr = Quellen.fuer('modrinth');
pruefe(mr.istErlaubt('https://cdn.modrinth.com/data/AABBCC/versions/x/mod.jar') === true,
    'Auch die Modrinth-Auslieferung kommt durch');
pruefe(mr.istErlaubt('https://boese-cdn.modrinth.com/x.jar') === false,
    'Und auch dort kein endsWith');

console.log(fehler === 0
    ? '\n✅ Beide Seiten sprechen von denselben Adressen\n'
    : `\n❌ ${fehler} Abweichung(en) — Suche und Installation gehen dann auseinander\n`);
process.exit(fehler === 0 ? 0 : 1);
