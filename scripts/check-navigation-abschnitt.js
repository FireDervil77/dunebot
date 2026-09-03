#!/usr/bin/env node
'use strict';

/**
 * Abschnittsbeschriftungen in der Seitenleiste (P1) — trägt die Kette?
 *
 * ## Was hier geprüft wird
 *
 * Ein Abschnittsname legt vier Stationen zurück, und jede kann ihn still
 * verlieren:
 *
 *     Plugin gibt `abschnitt` mit
 *       → NavigationManager schreibt ihn ins INSERT
 *         → SELECT * holt ihn zurück
 *           → sidebar.ejs gruppiert danach
 *
 * Ein verlorener Abschnitt stürzt nirgends ab. Die Seitenleiste rendert dann
 * einfach flach — genau wie vorher, und niemand sieht den Unterschied, außer
 * dem Plugin, das seine Gliederung erwartet hatte.
 *
 * ## Die Prüfung, auf die es ankommt
 *
 * Nicht ob die Spalte existiert, sondern **ob die Seitenleiste vier Fälle
 * richtig rendert** — darunter zwei, an denen die naheliegende Bauweise
 * scheitert:
 *
 *   - Eine Gruppe, die `sort_order` auseinanderreißt. Wer nur prüft
 *     „hat sich der Abschnitt geändert?", zeigt dieselbe Überschrift zweimal.
 *   - Ein Plugin ohne Abschnitte. Es muss flach bleiben, sonst wäre der
 *     Umbau nicht additiv und alle dreizehn Plugins müssten nachziehen.
 *
 *     node scripts/check-navigation-abschnitt.js
 *     node scripts/check-navigation-abschnitt.js --html   gerendertes Markup
 */

const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

const WURZEL = path.resolve(__dirname, '..');
const VORLAGE = 'apps/dashboard/themes/default/partials/guild/sidebar.ejs';
const MANAGER = 'packages/dunebot-sdk/lib/NavigationManager.js';
const MIGRATION = 'migrations/kern/20260903_120000_navigation_abschnitt.js';
const CSS = 'apps/dashboard/themes/default/assets/css/guild.css';

const ZEIG_HTML = process.argv.includes('--html');

let geprueft = 0;
let abweichungen = 0;

function lies(datei) {
    return fs.readFileSync(path.join(WURZEL, datei), 'utf8');
}

/** Kommentare heraus, bevor gemessen wird — sonst misst der Wächter Prosa. */
function ohneKommentare(quelle) {
    return quelle
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
        .replace(/<%#[\s\S]*?%>/g, '');
}

function pruefe(was, bedingung, hinweis) {
    geprueft++;
    if (bedingung) {
        console.log(`  ✓ ${was}`);
    } else {
        abweichungen++;
        console.log(`  ✗ ${was}`);
        if (hinweis) console.log(`      ${hinweis}`);
    }
}

// =====================================================
// 1. Die Kette im Code
// =====================================================

console.log('\nDie vier Stationen sind verdrahtet');

const manager = ohneKommentare(lies(MANAGER));

pruefe('NavigationManager nimmt `abschnitt` ins Item-Objekt',
    /abschnitt:\s*item\.abschnitt/.test(manager),
    'Ohne diese Zeile kommt der Wert nie beim INSERT an.');

pruefe('`abschnitt` steht in der Spaltenliste des INSERT',
    /INSERT INTO guild_nav_items[\s\S]{0,400}?abschnitt/.test(manager),
    'Die Spalte fehlt im INSERT — der Wert wird still verworfen.');

pruefe('`navItem.abschnitt` steht in der Werteliste',
    /navItem\.abschnitt/.test(manager),
    'Spaltenliste und Werteliste muessen beide den Abschnitt tragen.');

// Platzhalterzahl gegen Spaltenzahl — der Fehler, den ein Test sonst erst
// zur Laufzeit findet, und dann als "Column count doesn't match".
const insert = manager.match(/INSERT INTO guild_nav_items\s*\(([\s\S]*?)\)\s*VALUES\s*\(([^)]*)\)/);
if (insert) {
    const spalten = insert[1].split(',').filter(s => s.trim()).length;
    const platzhalter = insert[2].split(',').filter(s => s.trim() === '?').length;
    pruefe(`Spalten und Platzhalter stimmen ueberein (${spalten} zu ${platzhalter})`,
        spalten === platzhalter,
        'Eine Spalte ohne Platzhalter wirft "Column count doesn\'t match value count".');
} else {
    pruefe('INSERT-Anweisung gefunden', false, 'Das INSERT liess sich nicht lesen.');
}

pruefe('Die Migration legt die Spalte an',
    /ADD COLUMN abschnitt/.test(lies(MIGRATION)),
    'Ohne Spalte wirft jedes INSERT.');

pruefe('Die Migration zerlegt die Antwort von `db.query` nicht',
    !/const\s*\[\s*\w+\s*\]\s*=\s*await\s+db\.query/.test(ohneKommentare(lies(MIGRATION))),
    '`const [x] = await db.query()` griffe die erste ZEILE — die Waechterabfrage liefe ins Leere.');

// **Erst die Kommentare heraus.** Beim ersten Lauf schlug diese Pruefung fehl,
// obwohl die Regel stimmte: Zwischen Selektor und Farbwert stand ein
// Kommentar, der den gemessenen Abstand ueber die Grenze trieb. Der Waechter
// mass seine eigene Prosa (Baustelle 89, dasselbe Muster).
pruefe('Die Beschriftung nimmt ihre Farbe aus einer Theme-Rolle',
    /\.nav-abschnitt\s*\{[^}]*var\(--fb-/.test(ohneKommentare(lies(CSS))),
    'Ein fester Farbwert dreht beim Themewechsel nicht mit.');

// =====================================================
// 2. Der echte Render — vier Faelle
// =====================================================

console.log('\nDie Seitenleiste rendert die vier Faelle richtig');

const vorlage = lies(VORLAGE);

const grund = {
    guildId: '1',
    activeMenu: '/s/k',
    user: { isOwner: false },
    tr: (s) => String(s),
    locals: {}
};

const p = (title, url, abschnitt, sort_order) =>
    ({ title, url, abschnitt, sort_order, icon: 'fa-solid fa-circle' });

const gruppe = (subItems) => ([{
    title: 'Plugin', url: '/s', sort_order: 2000, icon: 'fa-solid fa-circle', subItems
}]);

function render(guildNav) {
    const html = ejs.render(vorlage, { ...grund, guildNav }, { filename: VORLAGE });
    if (ZEIG_HTML) console.log(html.replace(/\n\s*\n/g, '\n'));
    return {
        kopf: [...html.matchAll(/dropdown-header nav-abschnitt">([^<]+)</g)].map(m => m[1].trim()),
        punkte: [...html.matchAll(/dropdown-item[^"]*"\s+href="(\/s\/\w+)"/g)].map(m => m[1])
    };
}

// A — ohne Abschnitte: muss flach bleiben. Das ist die Zusage an die zwoelf
//     anderen Plugins.
const a = render(gruppe([p('Filter', '/s/f', null, 10), p('Regeln', '/s/r', null, 20)]));
pruefe('A · ohne Abschnitte bleibt die Liste flach',
    a.kopf.length === 0 && a.punkte.length === 2,
    `Ueberschriften: ${a.kopf.length}, erwartet 0 — der Umbau waere nicht additiv.`);

// B — mit Abschnitten, sauber sortiert.
const b = render(gruppe([
    p('Uebersicht', '/s/u', null, 5),
    p('Kanaele', '/s/k', 'Verfolgung', 10),
    p('Ereignisse', '/s/e', 'Verfolgung', 20),
    p('MeinKanal', '/s/m', 'Chatbot', 30)
]));
pruefe('B · Abschnitte erscheinen in der richtigen Reihenfolge',
    b.kopf.join('|') === 'Verfolgung|Chatbot',
    `bekommen: ${b.kopf.join('|') || '(keine)'}`);
pruefe('B · ein Punkt ohne Abschnitt steht ueber der ersten Ueberschrift',
    b.punkte[0] === '/s/u',
    `erster Punkt: ${b.punkte[0]} — erwartet /s/u`);

// C — dieselbe Gruppe, von `sort_order` auseinandergerissen. Hier scheitert
//     die naheliegende Bauweise ("hat sich der Abschnitt geaendert?").
const c = render(gruppe([
    p('Kanaele', '/s/k', 'Verfolgung', 10),
    p('MeinKanal', '/s/m', 'Chatbot', 20),
    p('Ereignisse', '/s/e', 'Verfolgung', 30)
]));
pruefe('C · eine auseinandergerissene Gruppe bekommt EINE Ueberschrift',
    c.kopf.length === new Set(c.kopf).size,
    `bekommen: ${c.kopf.join('|')} — eine Ueberschrift steht doppelt.`);
pruefe('C · die Punkte einer Gruppe stehen wieder beisammen',
    c.punkte.join(' ') === '/s/k /s/e /s/m',
    `bekommen: ${c.punkte.join(' ')}`);

// D — was die Rechtefilterung uebriglaesst. Sie laeuft vorher, also darf hier
//     keine Ueberschrift ohne Punkte entstehen.
const d = render(gruppe([p('Kanaele', '/s/k', 'Verfolgung', 10)]));
pruefe('D · keine Ueberschrift ohne Punkte darunter',
    d.kopf.length === 1 && d.punkte.length === 1,
    `Ueberschriften: ${d.kopf.length}, Punkte: ${d.punkte.length}`);

// =====================================================

console.log(`\nErgebnis: ${geprueft} Pruefungen, ${abweichungen} Abweichungen.`);
process.exit(abweichungen ? 1 : 0);
