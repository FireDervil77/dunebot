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

/**
 * Die Menuepunkt-Objekte einer Quelle herausschneiden.
 *
 * **Warum nicht per Regex ueber `parent: null`.** Die erste Fassung suchte
 * `order: … parent: null` im Umkreis von 400 Zeichen und liess alles andere
 * mit `continue` fallen — als "Plugin ohne eigene Hauptnavigation". Das war
 * eine ANNAHME, keine Messung: `dunemap` schreibt `path:` statt `url:` und
 * laesst `parent` ganz weg. Sein Wurzelpunkt stand auf `order: null`, landete
 * in zwei Guilds auf 1000 — dem Platz des Kern-Dashboards — und der Waechter
 * meldete trotzdem alles gruen, weil er ihn nie gesehen hat.
 *
 * Deshalb jetzt geklammert statt gefenstert: Jedes `{ … }`, das `title:` und
 * eine Adresse traegt, ist ein Menuepunkt. Wurzel ist, was kein `parent` nennt
 * oder `parent: null` sagt.
 *
 * @param {string} quelle Quelltext ohne Kommentare
 * @returns {Array<{text: string, order: string|null, wurzel: boolean}>} Punkte
 */
function menuepunkte(quelle) {
    const gefunden = [];
    const stapel = [];
    for (let i = 0; i < quelle.length; i++) {
        if (quelle[i] === '{') stapel.push(i);
        else if (quelle[i] === '}' && stapel.length) {
            const von = stapel.pop();
            const text = quelle.slice(von, i + 1);
            // Nur die innersten: ein Punkt enthaelt keinen zweiten.
            if (/\btitle\s*:/.test(text) && /\b(url|path)\s*:/.test(text)
                && !/\btitle\s*:[\s\S]*\btitle\s*:/.test(text)) {
                const o = /\border\s*:\s*([0-9]+|null)/.exec(text);
                gefunden.push({
                    text,
                    order: o ? o[1] : null,
                    wurzel: !/\bparent\s*:/.test(text) || /\bparent\s*:\s*null/.test(text)
                });
            }
        }
    }
    return gefunden;
}

/**
 * Plugins, die absichtlich keinen eigenen Hauptmenuepunkt anlegen.
 *
 * Steht als Liste MIT Begruendung da, damit "kein Punkt gefunden" nie wieder
 * stillschweigend als "hat keinen" durchgeht — genau der Fehler, an dem
 * `dunemap` vorbeigekommen ist.
 */
const OHNE_HAUPTNAVIGATION = {
    information: 'ruft `registerNavigation` gar nicht auf',
    // **core legt seine Punkte nicht in dieser Datei an — und zurzeit nirgends.**
    //
    // Gemessen am 2026-09-04: `plugins/core/dashboard/index.js` ruft an zwei
    // Stellen `await this._registerNavigation(guildId)` auf. Die Methode
    // existiert nicht — weder in der Klasse noch in `DashboardPlugin`:
    //
    //     node -e "console.log(typeof require('./plugins/core/dashboard/index.js')
    //              .prototype._registerNavigation)"   ->  undefined
    //
    // Beide Aufrufe stehen in einem `try`, dessen `catch` nur protokolliert
    // ("Nicht abbrechen, Update ist trotzdem erfolgreich"). Der `TypeError`
    // wird also seit jeher verschluckt, und die Zeilen von `core` stehen
    // unveraendert seit dem 18. Maerz 2026 in der Tabelle.
    //
    // Das ist ein eigener Befund und steht in `docs/Baustellen.md`. Fuer DIESEN
    // Waechter ist core aussen vor: Seine Plaetze (1000-3000) liegen fest und
    // unterhalb aller Plugin-Raenge.
    core: 'legt seine Punkte nicht hier an; `_registerNavigation` fehlt (siehe Baustellen)'
};

const plaetze = new Map();   // Plugin -> Wert (erste Wurzel)
const alleWurzeln = [];      // {plugin, wert} fuer die Kollisionspruefung

for (const name of plugins) {
    const quelle = ohneKommentare(
        fs.readFileSync(path.join(WURZEL, 'plugins', name, 'dashboard/index.js'), 'utf8'));

    const wurzeln = menuepunkte(quelle).filter(p => p.wurzel);

    if (wurzeln.length === 0) {
        pruefe(`${name} — ohne eigenen Hauptmenuepunkt`,
            Object.prototype.hasOwnProperty.call(OHNE_HAUPTNAVIGATION, name),
            'Kein Wurzelpunkt gefunden. Entweder hat das Plugin keinen — dann '
            + 'gehoert es mit Begruendung in OHNE_HAUPTNAVIGATION — oder der '
            + 'Punkt ist anders geschrieben, als dieser Waechter ihn erkennt.');
        continue;
    }

    // Zwei Schreibweisen bedeuten dasselbe: kein `order`-Schluessel (dann steht
    // hier JS-`null`) und `order: null` (dann die Zeichenkette 'null'). Beim
    // ersten Anlauf nur auf JS-`null` geprueft — die Gegenprobe meldete daraufhin
    // "fester Platz NaN" statt der eigentlichen Ursache.
    const ohneNummer = wurzeln.filter(w => w.order === null || w.order === 'null');
    if (ohneNummer.length) {
        pruefe(`${name} — fester Platz`, false,
            `${ohneNummer.length} Wurzelpunkt(e) auf \`order: null\` — die Nummer `
            + 'kommt dann aus der Schlange und haengt an der Reihenfolge der '
            + 'Registrierung, nicht am Plugin.');
        continue;
    }

    wurzeln.forEach(w => alleWurzeln.push({ plugin: name, wert: Number(w.order) }));
    const wert = Number(wurzeln[0].order);
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

console.log('\nBestehende Punkte werden nachgezogen');

// **"Ueberspringen" hiess einfrieren.** `registerNavigation` liess Punkte, die
// es schon gab, unangetastet — damit war alles, was das Plugin an ihnen
// erklaert, nach dem ersten Anlegen unveraenderlich. Gemessen am 2026-09-04:
// Zehn Plugins bekamen feste Plaetze, und in der Tabelle stand `gameserver`
// trotzdem weiter auf 5000 (Zeile vom 20. August) statt auf 4500.
const navMgr = ohneKommentare(
    fs.readFileSync(path.join(WURZEL, 'packages/dunebot-sdk/lib/NavigationManager.js'), 'utf8'));

pruefe('Bestehende Punkte bekommen ein UPDATE',
    /UPDATE guild_nav_items SET/.test(navMgr),
    'Ohne das bleibt ein einmal angelegter Punkt fuer immer so, wie er war.');

pruefe('`sort_order` wird nur nachgezogen, wenn das Plugin ihn nennt',
    /Number\.isFinite\(erklaert\)\s*&&\s*erklaert\s*>=\s*1000/.test(navMgr),
    'Wer `order: null` schreibt, bekommt die Nummer beim Anlegen zugeteilt. '
    + 'Sie bei jedem Start neu zu berechnen hiesse, den Punkt bei jedem Start '
    + 'woanders hinzustellen.');

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
