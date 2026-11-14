'use strict';

/**
 * Tabellen, die eine noch nicht gelaufene Migration löscht (`DROP TABLE` im
 * `up`-Teil), für Wächter, die Erklärungen gegen die Datenbank prüfen
 * (check-mitglied-inhalte, check-guild-inhalte). Gegenstück zu „kommt mit
 * offener Migration“: Eine Tabelle, deren Erklärung schon entfernt ist und die
 * mit dem nächsten Neustart geht, ist kein Befund (G-07: streaming_role_grants).
 *
 * Nur `up`: Jede Migration, die eine Tabelle anlegt, löscht sie in `down`.
 *
 * @param {string} wurzel Projektwurzel
 * @param {Set<string>} gelaufen `quelle:datei` der gelaufenen Migrationen
 * @param {string[]} plugins Plugin-Ordner
 * @returns {Map<string, string>} Tabelle → `quelle:datei`
 */
const fs = require('fs');
const path = require('path');
const { ohneKommentare } = require('./quelltext');

/** Der Rumpf von `async up(…)`: bis zur nächsten Methode `async name(` oder zum Ende. */
function rumpfVonUp(q) {
    const start = q.search(/async\s+up\s*\(/);
    if (start < 0) return '';
    const rest = q.slice(start + 1);
    const ende = rest.search(/async\s+\w+\s*\(/);
    return ende < 0 ? rest : rest.slice(0, ende);
}

function gehtMitOffenerMigration(wurzel, gelaufen, plugins) {
    const aus = new Map();
    const orte = [['kern', 'migrations/kern'], ...plugins.map((p) => [p, `plugins/${p}/migrations`])];
    for (const [quelle, ordner] of orte) {
        const voll = path.join(wurzel, ordner);
        if (!fs.existsSync(voll)) continue;
        for (const datei of fs.readdirSync(voll).filter((d) => d.endsWith('.js'))) {
            if (gelaufen.has(`${quelle}:${datei}`)) continue;
            const q = ohneKommentare(fs.readFileSync(path.join(voll, datei), 'utf8'));
            const up = rumpfVonUp(q);
            for (const m of up.matchAll(/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?`?(\w+)`?/gi)) aus.set(m[1], `${quelle}:${datei}`);
        }
    }
    return aus;
}

module.exports = { gehtMitOffenerMigration, rumpfVonUp };
