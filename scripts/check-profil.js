#!/usr/bin/env node
/**
 * Prueft, dass der Profilbereich **verbunden** ist — nicht, dass es ihn gibt.
 *
 * Der Unterschied ist der ganze Grund fuer dieses Skript. Vor dem 2026-08-26
 * existierten alle Teile des Profilbereichs einzeln (Baustelle 73):
 *
 *   - ein Menuepunkt auf `/guild/<id>/profile`  → aber keine Route
 *   - eine Ansicht `guild/profile/tokens.ejs`   → aber kein Verweis darauf
 *   - die Uebersetzungen MEMBER_SINCE, DAYS, LAST_LOGIN in beiden Sprachen
 *                                               → aber an null Stellen benutzt
 *
 * Jedes Teil sah beim Lesen des Codes vorhanden aus. Zusammen ergaben sie
 * einen 404. Ein Skript, das nur "Datei da?" fragt, waere damals ebenfalls
 * gruen gewesen — deshalb prueft dieses die **Verbindungen**.
 *
 *   node scripts/check-profil.js
 *
 * Exitcode 1 bei jeder Abweichung.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

const WURZEL = path.join(__dirname, '..');
const lies = (p) => fs.readFileSync(path.join(WURZEL, p), 'utf8');
const da = (p) => fs.existsSync(path.join(WURZEL, p));

let faelle = 0;
let abweichungen = 0;

/**
 * @param {string} was Beschreibung
 * @param {boolean} gut Ergebnis
 * @param {string} [zusatz] Messwert
 */
function pruefe(was, gut, zusatz = '') {
    faelle++;
    if (!gut) abweichungen++;
    console.log(`  ${gut ? '✓' : '✗'} ${was}${zusatz ? `  — ${zusatz}` : ''}`);
}

const ROUTER   = 'apps/dashboard/routes/guild/profile.router.js';
const ANSICHT  = 'apps/dashboard/themes/default/views/guild/profile.ejs';
const TOPBAR   = 'apps/dashboard/themes/default/partials/guild/topbar.ejs';
const GUILD    = 'apps/dashboard/routes/guild.router.js';
const CONTROLL = 'apps/dashboard/controllers/auth.controller.js';

console.log('\nDie drei Teile');
pruefe('Router-Datei vorhanden', da(ROUTER));
pruefe('Ansicht vorhanden', da(ANSICHT));
pruefe('alte Zwillingsansicht entfernt',
    !da('apps/dashboard/themes/default/views/guild/profile/tokens.ejs'));

console.log('\nDie Verbindungen — hier lag der Fehler');

// 1. Verweis im Menue → Einhaengepunkt im Router
const topbar = lies(TOPBAR);
const verweis = /href="\/guild\/<%=\s*_guildId\s*%>\/profile"/.test(topbar);
pruefe('Nutzermenue verweist auf /guild/<id>/profile', verweis);

const guildRouter = lies(GUILD);
const eingehaengt = /router\.use\(\s*["']\/:guildId\/profile["']/.test(guildRouter);
pruefe('genau dieser Pfad ist eingehaengt', eingehaengt,
    eingehaengt ? 'guild.router.js' : 'kein router.use fuer /:guildId/profile');

// 2. Die Ansicht muss der Router auch rendern — und zwar diese
const routerText = lies(ROUTER);
pruefe("Router rendert 'guild/profile'",
    /renderView\(\s*res,\s*['"]guild\/profile['"]/.test(routerText));

// 3. Kein zweites Recht davor. Das Profil gehoert dem Angemeldeten.
//
// **Kommentare vorher wegschneiden.** Der erste Wurf pruefte den rohen
// Dateitext und schlug fehl, weil im Router *erklaert* wird, warum dort kein
// `requirePermission` steht. Ein Waechter, der Prosa fuer Code haelt, meldet
// entweder falschen Alarm (hier) oder gibt Entwarnung fuer auskommentierten
// Code (schon einmal passiert). Beides macht ihn wertlos.
const ohneKommentare = routerText
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
pruefe('kein requirePermission im Profil-Router',
    !/requirePermission/.test(ohneKommentare),
    'sonst waere das eigene Profil an eine Serverrolle gebunden');

// 4. Die Ansicht muss uebersetzbar sein — ein Syntaxfehler faellt sonst erst
//    beim Aufruf auf, und zwar als weisse Seite.
let uebersetzt = false;
try { ejs.compile(lies(ANSICHT), { filename: ANSICHT }); uebersetzt = true; }
catch (e) { pruefe('Ansicht laesst sich uebersetzen', false, e.message); }
if (uebersetzt) pruefe('Ansicht laesst sich uebersetzen', true);

// 5. /auth/tokens darf keine zweite Kopie mehr rendern
const controller = lies(CONTROLL);
const getTokens = controller.slice(controller.indexOf('exports.getTokens'));
const bisEnde = getTokens.slice(0, getTokens.indexOf('\n};') + 3);
pruefe('/auth/tokens rendert keine eigene Ansicht mehr',
    !/renderView/.test(bisEnde));
pruefe('/auth/tokens leitet ins Profil', /\/profile/.test(bisEnde));

console.log('\nUebersetzungen, die niemand benutzte');
const ansicht = lies(ANSICHT);
for (const schluessel of ['MEMBER_SINCE', 'DAYS', 'LAST_LOGIN']) {
    pruefe(`${schluessel} wird verwendet`, ansicht.includes(schluessel));
    for (const sprache of ['de-DE', 'en-GB']) {
        const datei = JSON.parse(lies(`apps/dashboard/locales/${sprache}.json`));
        pruefe(`${schluessel} in ${sprache}`,
            Boolean(datei.DASHBOARD_COMMON && datei.DASHBOARD_COMMON[schluessel]));
    }
}

console.log(abweichungen === 0
    ? `\nErgebnis: ${faelle} Pruefungen, 0 Abweichungen.\n`
    : `\nErgebnis: ${faelle} Pruefungen, ${abweichungen} Abweichung(en).\n`);
process.exit(abweichungen === 0 ? 0 : 1);
