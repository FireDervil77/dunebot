#!/usr/bin/env node
'use strict';

/**
 * Laesst sich jede Datei ueberhaupt laden?
 *
 * ## Warum es dieses Skript gibt
 *
 * Am 2026-09-05 stand das Streaming-Plugin **28 Minuten lang still**, ohne dass
 * es jemand merkte. Eine einzige Zeile war schuld:
 *
 *     -- `{discord}`, und welche gilt, entschiede die Sortierung.
 *
 * Ein Backtick in einem SQL-Kommentar schliesst das umgebende
 * JS-Template-Literal. Die Datei liess sich nicht mehr laden, und weil der
 * Plugin-Lader jeden Fehler auffaengt und weiterlaeuft, stand im Protokoll nur:
 *
 *     Fehler beim Laden des Plugin-Moduls streaming:: missing ) after argument list
 *
 * Kein Absturz, keine Fehlerseite - das Plugin war einfach weg. Die Migration
 * lief nicht, die neuen Seiten gab es nicht, und die Ursache stand in einer
 * Zeile Protokoll zwischen tausend anderen.
 *
 * **Es war der zweite Fall desselben Fehlers am selben Tag.** Der erste traf
 * `20260905_100000_befehle.js` und wurde beim Schreiben bemerkt; der zweite
 * nicht, weil danach nur die Waechter liefen - und die laden Migrationen nicht.
 *
 * ## Was geprueft wird
 *
 *   1. Jede JS-Datei unter `plugins/`, `apps/` und `packages/` ist syntaktisch
 *      gueltig (`node --check`).
 *   2. Jede Migration laesst sich laden und hat ein `up()`. Mehr verlangt der
 *      `MigrationRunner` nicht — nachgesehen, nicht angenommen: Der Schluessel
 *      ist der Dateiname, `down` ist freiwillig, `name` wird nie gelesen.
 *
 *     node scripts/check-migrationen.js
 */

const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const WURZEL = path.resolve(__dirname, '..');

let faelle = 0, abweichungen = 0;
function pruefe(gut, text, zusatz = '') {
    faelle++;
    if (!gut) abweichungen++;
    if (!gut || process.env.LAUT) {
        console.log(`  ${gut ? '✓' : '✗'} ${text}${zusatz ? '  — ' + zusatz : ''}`);
    }
}

/**
 * Alle JS-Dateien unter einem Verzeichnis, ohne Fremdcode.
 *
 * `node_modules` und `vendor` bleiben draussen: Sie sind nicht unsere, und ein
 * Monaco-Editor mit 3000 Dateien macht aus einer Sekunde eine Minute.
 *
 * @param {string} start Verzeichnis
 * @returns {Array<string>} Pfade
 */
function jsDateien(start) {
    const gefunden = [];
    const gehen = (ordner) => {
        let eintraege;
        try {
            eintraege = fs.readdirSync(ordner, { withFileTypes: true });
        } catch {
            return;
        }
        for (const e of eintraege) {
            const voll = path.join(ordner, e.name);
            if (e.isDirectory()) {
                if (e.name === 'node_modules' || e.name === 'vendor' || e.name === '.git') continue;
                gehen(voll);
            } else if (e.name.endsWith('.js')) {
                gefunden.push(voll);
            }
        }
    };
    gehen(start);
    return gefunden;
}

console.log('\nJede Datei laesst sich laden');
{
    const dateien = [
        ...jsDateien(path.join(WURZEL, 'plugins')),
        ...jsDateien(path.join(WURZEL, 'apps')),
        ...jsDateien(path.join(WURZEL, 'packages')),
        ...jsDateien(path.join(WURZEL, 'migrations'))
    ];

    const kaputt = [];
    for (const datei of dateien) {
        try {
            // `node --check` liest die Datei, ohne sie auszufuehren - genau das,
            // was der Plugin-Lader tut, bevor er scheitert.
            execFileSync(process.execPath, ['--check', datei], { stdio: 'pipe' });
        } catch (fehler) {
            const meldung = String(fehler.stderr || '').split('\n')
                .find(z => /Error/.test(z)) || 'unbekannt';
            kaputt.push(`${path.relative(WURZEL, datei)}: ${meldung.trim()}`);
        }
    }

    pruefe(kaputt.length === 0,
        `${dateien.length} Dateien sind syntaktisch gueltig`,
        kaputt.join(' | '));

    if (kaputt.length === 0) {
        console.log(`  ✓ ${dateien.length} Dateien geprueft, alle ladbar`);
    }
}

console.log('\nJede Migration ist eine Migration');
{
    // **Der Vertrag steht in `MigrationRunner`, nicht in meiner Erinnerung.**
    // Beim ersten Anlauf verlangte dieses Skript `name` und `down` von jeder
    // Migration und meldete prompt 103 Abweichungen — an einem Bestand, der
    // seit Monaten laeuft. Nachgesehen (`_loadMigrationFiles`, Zeile 355 ff.):
    //
    //   * Der Schluessel ist der DATEINAME, nicht ein `name`-Feld. `name` wird
    //     nirgends gelesen; es steht in neueren Dateien als Kommentar-Ersatz.
    //   * `down` ist freiwillig: Fehlt es, ueberspringt der Rollback die Datei
    //     mit einer Warnung (Zeile 150).
    //   * Verlangt wird genau eines: `up` muss eine Funktion sein.
    //
    // Ein Waechter, der mehr fordert als der Ausfuehrer, misst die Meinung
    // seines Autors.
    const ordner = [
        path.join(WURZEL, 'migrations', 'kern'),
        ...fs.readdirSync(path.join(WURZEL, 'plugins'), { withFileTypes: true })
            .filter(e => e.isDirectory())
            .map(e => path.join(WURZEL, 'plugins', e.name, 'migrations'))
    ].filter(o => fs.existsSync(o));

    let geprueft = 0;
    const maengel = [];

    for (const o of ordner) {
        for (const datei of fs.readdirSync(o).filter(f => f.endsWith('.js'))) {
            const voll = path.join(o, datei);
            const kurz = path.relative(WURZEL, voll);
            geprueft++;

            let mig;
            try {
                mig = require(voll);
            } catch (fehler) {
                // Der Fall, um den es geht: Die Datei ist syntaktisch gueltig,
                // laesst sich aber nicht laden (fehlendes Modul, Fehler beim
                // Auswerten). Der Plugin-Lader faengt so etwas und laeuft
                // weiter — das Plugin ist dann still weg.
                maengel.push(`${kurz}: laedt nicht (${fehler.message})`);
                continue;
            }

            if (typeof mig?.up !== 'function') maengel.push(`${kurz}: kein up()`);
        }
    }

    pruefe(maengel.length === 0, `${geprueft} Migrationen lassen sich laden und haben up()`,
        maengel.join(' | '));
    if (maengel.length === 0) {
        console.log(`  ✓ ${geprueft} Migrationen geprueft`);
    }
}

console.log(abweichungen === 0
    ? `\nErgebnis: ${faelle} Pruefungen, 0 Abweichungen.\n`
    : `\nErgebnis: ${faelle} Pruefungen, ${abweichungen} Abweichung(en).\n`);
process.exit(abweichungen === 0 ? 0 : 1);
