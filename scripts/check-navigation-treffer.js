#!/usr/bin/env node
/**
 * Zeigt `activeMenu` auf einen Punkt, den es in der Seitenleiste gibt?
 *
 * ── Der Befund, der dazu fuehrte (2026-09-08) ───────────────────────────────
 *
 * Der Betreiber: „Wenn ich die dashboard route aufrufe schliesst sich die
 * navigation wieder. bei allen anderen plugins bleibt sie offen."
 *
 * `sidebar.ejs:70` vergleicht Zeichen fuer Zeichen:
 *
 *     _aktiv === eintrag.url || kinder.some(k => _aktiv === k.url)
 *
 * Kein Treffer heisst: kein Abschnitt offen. Das gameserver-Dashboard setzte
 * `activeMenu` auf `/plugins/gameserver/dashboard` — einen Punkt, den es seit
 * dem 2026-08-18 nicht mehr gibt (die Wurzel leitet nur dorthin um). Dasselbe
 * bei `addons/my-addons`, entfallen mit E4.
 *
 * **Ein Tippfehler faellt hier nie auf**, weil nichts kaputtgeht: Die Seite
 * laedt, nur die Leiste klappt zu. Genau dafuer ist dieses Skript da.
 *
 * ── Was es NICHT kann ───────────────────────────────────────────────────────
 *
 * Es liest Quelltext, keinen laufenden Zustand. Adressen, die zur Laufzeit
 * zusammengesetzt werden (aus Variablen statt aus einer Zeichenkette), kann es
 * nicht aufloesen — die stehen als „nicht pruefbar" in der Liste, mit Datei
 * und Zeile. Ein Wächter, der Unverstandenes still ueberspringt, meldet gruen.
 *
 *   node scripts/check-navigation-treffer.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const WURZEL = path.join(__dirname, '..');
const PLUGINS = path.join(WURZEL, 'plugins');

let fehler = 0;
const nichtPruefbar = [];
const ohneVerwendung = [];

/** Kommentare weg — sonst zaehlt eine Begruendung als Anmeldung. */
function ohneKommentare(text) {
    return text
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n').map(z => z.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');
}

// Die Guild-Kennung ist beliebig: aus `/guild/${guildId}/plugins/x` wird
// `/guild/<stern>/plugins/x`. Als Zeilenkommentar, weil das Sternchen mit
// einem Schraegstrich dahinter einen Blockkommentar beenden wuerde - genau
// daran ist die erste Fassung dieses Skripts gescheitert.
//
// **Erst die Konstanten einsetzen, dann vereinheitlichen.** Das discord-Plugin
// schreibt `${basis}/roles` mit `const basis = ...` darueber. Wer das nicht
// aufloest, macht daraus `*/roles` und meldet einen Fehler, den es nicht gibt -
// genau der falsche Alarm, den dieses Skript verhindern soll. Gemessen: zwei
// falsche Meldungen im ersten Lauf.
function vereinheitlichen(adresse, konstanten = {}) {
    let text = String(adresse);

    // Drei Durchgaenge reichen: `${a}` in `a`, das selbst `${b}` enthaelt.
    // Mehr Verschachtelung gibt es hier nicht, und eine Schleife ohne Grenze
    // haette bei einer Selbstbezueglichkeit kein Ende.
    for (let i = 0; i < 3; i++) {
        const vorher = text;
        text = text.replace(/\$\{(\w+)\}/g, (ganz, name) =>
            Object.prototype.hasOwnProperty.call(konstanten, name) ? konstanten[name] : ganz);
        if (text === vorher) break;
    }

    return text.replace(/\$\{[^}]+\}/g, '*').replace(/\/+$/, '');
}

/**
 * Die Zeichenketten-Konstanten einer Datei: `const x = \`...\`` oder '...'.
 *
 * Nur einfache Zuweisungen — was aus einer Funktion kommt, steht hier nicht
 * und bleibt ein Sternchen.
 *
 * @param {string} quelle Dateiinhalt ohne Kommentare
 * @returns {Object} Name → Wert
 */
function konstantenLesen(quelle) {
    const karte = {};
    for (const t of quelle.matchAll(/\bconst\s+(\w+)\s*=\s*`([^`]*)`/g)) karte[t[1]] = t[2];
    for (const t of quelle.matchAll(/\bconst\s+(\w+)\s*=\s*'([^']*)'/g)) karte[t[1]] = t[2];
    return karte;
}

/** Alle Dateien eines Verzeichnisses, rekursiv. */
function dateien(verzeichnis, treffer = []) {
    for (const eintrag of fs.readdirSync(verzeichnis, { withFileTypes: true })) {
        const voll = path.join(verzeichnis, eintrag.name);
        if (eintrag.isDirectory()) {
            if (eintrag.name === 'node_modules') continue;
            dateien(voll, treffer);
        } else if (eintrag.name.endsWith('.js')) {
            treffer.push(voll);
        }
    }
    return treffer;
}

console.log('\n▸ Zeigt jedes activeMenu auf einen angemeldeten Punkt?\n');

for (const plugin of fs.readdirSync(PLUGINS)) {
    const dashboardVerzeichnis = path.join(PLUGINS, plugin, 'dashboard');
    if (!fs.existsSync(dashboardVerzeichnis)) continue;

    const alleDateien = dateien(dashboardVerzeichnis);

    // 1. Was ist angemeldet? `url:` und `path:` in den Navigationseintraegen.
    const angemeldet = new Set();
    for (const datei of alleDateien) {
        const quelle = ohneKommentare(fs.readFileSync(datei, 'utf8'));
        const konstanten = konstantenLesen(quelle);
        for (const t of quelle.matchAll(/\b(?:url|path):\s*`([^`]+)`/g)) {
            const adresse = vereinheitlichen(t[1], konstanten);
            if (adresse.startsWith('/')) angemeldet.add(adresse);
        }
        for (const t of quelle.matchAll(/\b(?:url|path):\s*'([^']+)'/g)) {
            const adresse = vereinheitlichen(t[1], konstanten);
            if (adresse.startsWith('/')) angemeldet.add(adresse);
        }
    }

    // 2. Was wird gesetzt?
    const verwendet = [];
    for (const datei of alleDateien) {
        const quelle = ohneKommentare(fs.readFileSync(datei, 'utf8'));
        const konstanten = konstantenLesen(quelle);
        const zeilen = quelle.split('\n');
        zeilen.forEach((zeile, i) => {
            const mitZeichenkette = /activeMenu:\s*[`'"]([^`'"]+)[`'"]/.exec(zeile);
            if (mitZeichenkette) {
                verwendet.push({ datei, zeile: i + 1,
                    adresse: vereinheitlichen(mitZeichenkette[1], konstanten) });
                return;
            }
            // Gesetzt, aber nicht als Zeichenkette — das kann dieses Skript
            // nicht aufloesen und meldet es als solches.
            if (/activeMenu:/.test(zeile)) {
                nichtPruefbar.push({ plugin, datei, zeile: i + 1, text: zeile.trim().slice(0, 80) });
            }
        });
    }

    if (!verwendet.length) {
        // **Kein stilles Weiter.** Ein Plugin ohne `activeMenu` ist entweder in
        // Ordnung (es hat keine eigene Seite) oder es fehlt dort ueberall - der
        // Unterschied gehoert in die Liste, nicht in ein `continue`.
        ohneVerwendung.push(plugin);
        continue;
    }

    const offen = verwendet.filter(v => !angemeldet.has(v.adresse));
    const kurz = (d) => path.relative(WURZEL, d);

    if (!offen.length) {
        console.log(`  ✅ ${plugin.padEnd(14)} ${verwendet.length} Verwendung(en), alle angemeldet`);
        continue;
    }

    fehler += offen.length;
    console.log(`  ❌ ${plugin.padEnd(14)} ${offen.length} von ${verwendet.length} zeigen ins Leere:`);
    for (const o of offen) {
        console.log(`       ${o.adresse}\n         ${kurz(o.datei)}:${o.zeile}`);
    }
    console.log(`       angemeldet sind: ${[...angemeldet]
        .filter(a => a.includes('/plugins/' + plugin)).join(', ') || '(keine)'}`);
}

if (ohneVerwendung.length) {
    console.log(`\n▸ Ohne eigenes activeMenu, also nicht geprueft: ${ohneVerwendung.join(', ')}`);
}

if (nichtPruefbar.length) {
    console.log('\n▸ Nicht pruefbar — zur Laufzeit zusammengesetzt, hier steht keine Adresse');
    for (const n of nichtPruefbar) {
        console.log(`  · ${path.relative(WURZEL, n.datei)}:${n.zeile}  ${n.text}`);
    }
}

console.log(fehler === 0
    ? '\n✅ Jedes activeMenu trifft einen angemeldeten Punkt\n'
    : `\n❌ ${fehler} Abweichung(en) — die Seitenleiste klappt dort zu\n`);
process.exit(fehler === 0 ? 0 : 1);
