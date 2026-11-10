#!/usr/bin/env node
'use strict';

/**
 * Behandelt eine Migration die erste Zeile wie eine Liste?
 *
 * ## Warum es dieses Skript gibt (K110, 2026-11-10)
 *
 * `up(db)` bekommt den DBService. Dessen `query()` liefert die Zeilen direkt,
 * nicht `[rows, fields]` wie eine rohe mysql2-Verbindung. Also ist
 *
 *     const [x] = await db.query(…)
 *
 * die ERSTE ZEILE oder `undefined`. Das ist oft gewollt (`if (!x)`, `x.n`),
 * und dann richtig. Falsch wird es, wenn `x` danach als Liste gilt. Drei
 * Migrationen taten das, und keine fiel je auf, weil sie in der laufenden
 * Datenbank nur einmal liefen und dort zufällig passten:
 *
 *   - die Benachrichtigungen sahen nur die Spalte `id` und ließen auf einer
 *     frischen Datenbank `title NOT NULL` stehen — /admin hätte keine
 *     Benachrichtigung mehr anlegen können,
 *   - `.length` an `undefined` warf, sobald die Spalte schon fehlte,
 *   - `Number(Zeile)` ist NaN, `!NaN` wahr — die Spalte wäre doppelt angelegt
 *     worden.
 *
 * Belegt im echten Lauf an TEMPORARY-Kopien, alte Fassung gegen neue.
 *
 * Das Gedächtnis sprach bis heute von einer „eingefrorenen Liste“ in
 * `check-migrationen.js`. Die gab es dort nicht (mehr). Dieser Wächter ist
 * die Regel, die dort hätte stehen sollen.
 *
 * ## Was geprüft wird
 *
 * Jede Stelle `const [name] = await db.query(` (auch `dbService`, `this.db`)
 * in `migrations/kern/` und `plugins/<name>/migrations/`. Nach ihr darf `name`
 * nicht als Liste vorkommen: `.length`, `name[…]`, `.map`/`.forEach`/
 * `.filter`/`.some`/`.find`/`.includes`, `Array.isArray(name)`, `Number(name)`,
 * `for (… of name)`. Gesucht wird bis zur nächsten Deklaration desselben
 * Namens oder 40 Zeilen weit — eine Migration ist keine lange Funktion.
 *
 * Nicht gemeint ist die rohe Verbindung im Rückruf von `transaction()`; dort
 * ist `[rows]` richtig. Sie heißt im Haus `conn`/`connection` und wird hier
 * nicht erfasst.
 *
 *     node scripts/check-migration-zeilen.js [wurzel]
 *
 * `wurzel` nur für die Gegenprobe an einer getrennten Kopie.
 */

const path = require('path');
const fs = require('fs');
const { ohneKommentare } = require('./lib/quelltext');

const WURZEL = path.resolve(process.argv[2] || path.join(__dirname, '..'));

const LISTE = (n) => new RegExp(
    `\\b${n}\\s*\\.\\s*(length|map|forEach|filter|some|every|find|includes|reduce)\\b` +
    `|\\b${n}\\s*\\[` +
    `|Array\\.isArray\\(\\s*${n}\\s*\\)` +
    `|Number\\(\\s*${n}\\s*\\)` +
    `|\\bof\\s+${n}\\b`);

/**
 * `ohneKommentare`, aber mit erhaltenen Zeilennummern.
 *
 * `ohneKommentare` macht aus einem Blockkommentar ein Leerzeichen und
 * verschluckt dabei seine Zeilenumbrüche — die Zeilennummern der Funde lagen
 * beim ersten Lauf um die Länge des Dateikopfs daneben. Deshalb die
 * Blockkommentare vorher zeilentreu leeren (gleiche Vorbedingung wie dort);
 * für `ohneKommentare` bleiben dann nur die Zeilenkommentare.
 *
 * @param {string} quelltext roher Dateiinhalt
 * @returns {string}
 */
function zeilentreuOhneKommentare(quelltext) {
    return ohneKommentare(String(quelltext).replace(/(^|[\s(,;{=])\/\*[\s\S]*?\*\//g,
        (treffer, vor) => vor + treffer.slice(vor.length).replace(/[^\n]/g, ' ')));
}

function migrationsDateien() {
    const ordner = [path.join(WURZEL, 'migrations', 'kern')];
    const plugins = path.join(WURZEL, 'plugins');
    if (fs.existsSync(plugins)) {
        for (const e of fs.readdirSync(plugins, { withFileTypes: true })) {
            if (e.isDirectory()) ordner.push(path.join(plugins, e.name, 'migrations'));
        }
    }
    return ordner.filter(o => fs.existsSync(o))
        .flatMap(o => fs.readdirSync(o).filter(f => f.endsWith('.js')).map(f => path.join(o, f)));
}

let stellen = 0;
const funde = [];

for (const datei of migrationsDateien()) {
    const zeilen = zeilentreuOhneKommentare(fs.readFileSync(datei, 'utf8')).split('\n');
    zeilen.forEach((zeile, i) => {
        const m = zeile.match(/const\s*\[\s*([A-Za-z_$][\w$]*)\s*\]\s*=\s*await\s+(?:this\.)?(?:db|dbService)\s*\.\s*query\s*\(/);
        if (!m) return;
        stellen++;
        const name = m[1];
        const neuDeklariert = new RegExp(`\\b(const|let|var)\\s*(\\[\\s*)?${name}\\b`);
        const liste = LISTE(name);
        for (let j = i + 1; j < Math.min(zeilen.length, i + 41); j++) {
            if (neuDeklariert.test(zeilen[j])) break;
            if (liste.test(zeilen[j])) {
                funde.push(`${path.relative(WURZEL, datei)}:${i + 1} — \`[${name}]\` ist die erste Zeile, Zeile ${j + 1} behandelt sie als Liste: ${zeilen[j].trim().slice(0, 90)}`);
                break;
            }
        }
    });
}

console.log('\nMigrationen: erste Zeile nicht als Liste');
for (const f of funde) console.log(`  ✗ ${f}`);
if (stellen === 0) {
    // Ein Wächter, der nichts findet, prüft womöglich am falschen Ort.
    console.log('  ✗ keine einzige Stelle gefunden — falsche Wurzel?');
}
const gut = funde.length === 0 && stellen > 0;
if (gut) console.log(`  ✓ ${stellen} Stellen \`const [x] = await db.query\` geprüft, keine als Liste benutzt`);
console.log(`\nErgebnis: ${stellen} Stellen, ${funde.length} Abweichung(en).\n`);
process.exit(gut ? 0 : 1);
