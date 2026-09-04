#!/usr/bin/env node
'use strict';

/**
 * Steht jeder Menuepunkt an einem festen Platz?
 *
 * ## Der Befund vom 2026-09-04
 *
 * Alle zehn Plugins registrierten ihre Wurzel mit `order: null`. Der
 * NavigationManager vergab dann die naechste freie 1000er-Stufe — also die,
 * die sich aus der Reihenfolge der REGISTRIERUNG ergibt und nicht aus dem
 * Plugin. Wer sich zuerst eintrug, stand oben.
 *
 * Schlimmer: `_getNextMainNavRange` blendet alles ab 9000 aus (reserviert).
 * Sobald das Maximum bei 8000 stand, ergab `Math.ceil(8001/1000)*1000` jedes
 * Mal wieder 9000 — und ab dem achten Plugin bekam JEDES die 9000. Gemessen
 * an der laufenden Anlage: fuenf Hauptmenuepunkte auf demselben Wert.
 *
 *     greeting · moderation · music · streaming · ticket   alle sort_order 9000
 *
 * Welcher davon oben stand, entschied das `ORDER BY … , title` — also der
 * Uebersetzungsschluessel.
 *
 *     node scripts/check-navigationsordnung.js
 */

const fs = require('fs');
const path = require('path');

const WURZEL = path.resolve(__dirname, '..');
require(path.join(WURZEL, 'node_modules/dotenv')).config({
    path: path.join(WURZEL, 'apps/dashboard/.env')
});
const mysql = require(path.join(WURZEL, 'node_modules/mysql2/promise'));

let abweichungen = 0;
function pruefe(was, bedingung, hinweis) {
    if (bedingung) { console.log(`  ✓ ${was}`); return; }
    abweichungen++;
    console.log(`  ✗ ${was}`);
    if (hinweis) console.log(`      ${hinweis}`);
}

/** Kommentare heraus, sonst misst der Waechter Prosa. */
const ohneKommentare = (q) => q
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

// =====================================================
// 1. Jedes Plugin nennt seinen Platz selbst
// =====================================================

console.log('\nJedes Plugin nennt seinen Platz selbst');

const plugins = fs.readdirSync(path.join(WURZEL, 'plugins'), { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.name.startsWith('.') && !e.name.startsWith('_'))
    .map(e => e.name)
    .filter(n => fs.existsSync(path.join(WURZEL, 'plugins', n, 'dashboard/index.js')));

const plaetze = new Map();   // Plugin -> Wert

for (const name of plugins) {
    const quelle = ohneKommentare(
        fs.readFileSync(path.join(WURZEL, 'plugins', name, 'dashboard/index.js'), 'utf8'));

    // Der Wurzeleintrag ist der mit `parent: null`. Nur der zieht eine Range.
    const eintrag = /order:\s*([0-9]+|null)\s*,[\s\S]{0,400}?parent:\s*null/.exec(quelle);
    if (!eintrag) continue;   // Plugin ohne eigene Hauptnavigation

    if (eintrag[1] === 'null') {
        pruefe(`${name} — fester Platz`, false,
            'Steht auf `order: null` und zieht damit eine Nummer aus der Schlange. '
            + 'Die haengt an der Reihenfolge der Registrierung, nicht am Plugin.');
        continue;
    }
    const wert = Number(eintrag[1]);
    plaetze.set(name, wert);
    pruefe(`${name} — fester Platz ${wert}`, wert >= 1000 && wert < 9000,
        wert >= 9000
            ? 'Ab 9000 ist fuer den Systembereich reserviert.'
            : 'Unter 1000 wird der Wert als Offset in einer Range gelesen, nicht als Platz.');
}

const doppelt = [...plaetze.entries()]
    .reduce((sammlung, [name, wert]) => {
        (sammlung[wert] ||= []).push(name);
        return sammlung;
    }, {});
const kollisionen = Object.entries(doppelt).filter(([, v]) => v.length > 1);
pruefe('Kein Platz ist doppelt vergeben',
    kollisionen.length === 0,
    kollisionen.map(([w, v]) => `${w}: ${v.join(', ')}`).join(' · '));

// =====================================================
// 2. Die Seitenleiste entscheidet Gleichstaende sichtbar
// =====================================================

console.log('\nDie Seitenleiste sortiert nachvollziehbar');

const sidebar = ohneKommentare(fs.readFileSync(
    path.join(WURZEL, 'apps/dashboard/themes/default/partials/guild/sidebar.ejs'), 'utf8'));

pruefe('Der Vergleich hat ein Zweitkriterium',
    /localeCompare/.test(sidebar),
    'Ohne das gibt er bei gleichem Wert 0 zurueck und ueberlaesst die '
    + 'Reihenfolge der Datenbank.');

// =====================================================
// 3. Und was steht wirklich in der Datenbank?
// =====================================================
//
// Der Quelltext sagt, was gemeint ist. Ob es angekommen ist, sagt nur die
// Tabelle — die Plaetze wandern erst mit dem naechsten Neustart hinein.

(async () => {
    console.log('\nDie Plaetze stehen wirklich in der Datenbank');

    let verbindung;
    try {
        verbindung = await mysql.createConnection({
            host: process.env.MYSQL_HOST, user: process.env.MYSQL_USER,
            password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE,
            port: process.env.MYSQL_PORT || 3306
        });
    } catch (err) {
        // Kein stiller Rueckfall auf "in Ordnung": Wer nicht messen konnte, weiss nichts.
        console.log(`  ? Datenbank nicht erreichbar: ${err.message}`);
        console.log('\nErgebnis: ausgefallen — nicht gemessen.\n');
        process.exit(2);
    }

    const [zeilen] = await verbindung.query(
        `SELECT guildId, plugin, sort_order, COUNT(*) AS n
           FROM guild_nav_items
          WHERE type = 'main' AND (parent IS NULL OR parent = '') AND visible = 1
          GROUP BY guildId, sort_order
         HAVING n > 1`);

    pruefe('Kein Hauptmenuepunkt teilt sich seinen Platz',
        zeilen.length === 0,
        zeilen.length
            ? zeilen.slice(0, 5).map(z => `Guild ${z.guildId}: ${z.n} Punkte auf ${z.sort_order}`).join(' · ')
              + ' — die Plaetze kommen erst mit dem naechsten Neustart in die Tabelle.'
            : null);

    await verbindung.end();
    console.log(`\nErgebnis: ${abweichungen} Abweichungen.\n`);
    process.exit(abweichungen ? 1 : 0);
})();
