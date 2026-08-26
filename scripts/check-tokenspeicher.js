#!/usr/bin/env node
/**
 * Prueft, dass keine fremden Zugangsschluessel im Klartext liegen.
 *
 * Hintergrund (Baustelle 74): Bis zum 2026-08-26 schrieb der Anmeldepfad
 * `access_token` und `refresh_token` des Benutzers als blankes JSON in
 * `users.tokens` — und keiner der beiden hatte im ganzen Projekt einen Leser.
 * Zwei Geheimnisse ohne Verwender aufzubewahren ist kein Abwaegungsfall,
 * sondern Risiko ohne Gegenleistung.
 *
 * Das Skript prueft **beide Seiten**, denn eine allein genuegt nicht:
 *
 *   - **Code:** schreibt der Anmeldepfad sie wieder? Ein Rueckfall waere eine
 *     Zeile und faellt sonst niemandem auf.
 *   - **Daten:** liegen sie noch irgendwo? Den Schreiber zu reparieren reinigt
 *     nur die Zukunft; die vorhandenen Zeilen behalten ihre Schluessel, bis
 *     die Migration gelaufen ist.
 *
 * Der Datenteil braucht die Datenbank. Ist sie nicht erreichbar, wird der
 * Teil uebersprungen und das ausdruecklich gesagt — eine stille Entwarnung
 * waere schlimmer als keine Pruefung.
 *
 *   node scripts/check-tokenspeicher.js
 *
 * Exitcode 1 bei jeder Abweichung.
 */
'use strict';

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../apps/dashboard/.env'), quiet: true });

const WURZEL = path.join(__dirname, '..');
const lies = (p) => fs.readFileSync(path.join(WURZEL, p), 'utf8');

/**
 * Kommentare wegschneiden.
 *
 * Ohne das prueft man Prosa: Der Anmeldepfad **erklaert** ausfuehrlich, warum
 * dort kein `access_token` mehr steht — und genau dieses Wort stuende dann im
 * Text. Beim Schwesterskript `check-profil.js` ist mir das passiert.
 *
 * @param {string} quelltext Datei
 * @returns {string} Quelltext ohne Kommentare
 */
function ohneKommentare(quelltext) {
    return quelltext
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
}

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

(async () => {
    // ── Code ────────────────────────────────────────────────────────────
    console.log('\nAnmeldepfad');

    const auth = ohneKommentare(lies('apps/dashboard/controllers/auth.controller.js'));

    // Die beiden Aufrufe an Discord waehrend des Rueckrufs sind richtig und
    // muessen bleiben — sie benutzen den Schluessel, ohne ihn abzulegen.
    // Geprueft wird deshalb das ABLEGEN, nicht das Vorkommen.
    pruefe('access_token wird nicht gespeichert',
        !/access_token\s*:/.test(auth), 'Zuweisung in ein Objekt');
    pruefe('refresh_token wird nicht gespeichert',
        !/refresh_token\s*:/.test(auth));
    pruefe('access_token liegt nicht in der Sitzung',
        !/token:\s*tokens\.access_token/.test(auth));

    const benutzt = (auth.match(/tokens\.access_token/g) || []).length;
    pruefe('Schluessel wird nur waehrend des Rueckrufs benutzt', benutzt === 2,
        `${benutzt} Verwendung(en), erwartet 2 (Benutzerdaten + Guildliste)`);

    console.log('\nupsertUser schreibt nur, was es bekommt');
    const dbs = ohneKommentare(lies('packages/dunebot-db-client/lib/DBService.js'));
    const upsert = dbs.slice(dbs.indexOf('async upsertUser'), dbs.indexOf('async getNews'));
    pruefe('locale wird nicht mehr blind vorbelegt',
        !/data\.locale\s*\|\|\s*['"]de-DE['"]/.test(upsert),
        'sonst loescht jede Abmeldung die persoenliche Sprachwahl');
    pruefe('locale wird nur bei Angabe geschrieben',
        /data\.locale\s*!==\s*undefined/.test(upsert));

    // ── Daten ───────────────────────────────────────────────────────────
    console.log('\nBestand in der Datenbank');
    let c = null;
    try {
        const mysql = require('mysql2/promise');
        c = await mysql.createConnection({
            host: process.env.MYSQL_HOST, port: process.env.MYSQL_PORT || 3306,
            user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
            database: process.env.MYSQL_DATABASE
        });
    } catch (err) {
        console.log(`  … uebersprungen: keine Datenbank erreichbar (${err.message})`);
        console.log('    Das ist KEINE Entwarnung — der Bestand wurde nicht geprueft.');
    }

    if (c) {
        const [[zahl]] = await c.query(`
            SELECT COUNT(*) AS nutzer,
                   SUM(tokens LIKE '%access_token%')  AS mit_access,
                   SUM(tokens LIKE '%refresh_token%') AS mit_refresh
              FROM users`);
        pruefe('keine Zeile traegt einen access_token', Number(zahl.mit_access) === 0,
            `${zahl.mit_access} von ${zahl.nutzer}`);
        pruefe('keine Zeile traegt einen refresh_token', Number(zahl.mit_refresh) === 0,
            `${zahl.mit_refresh} von ${zahl.nutzer}`);
        if (Number(zahl.mit_access) > 0) {
            console.log('    → Die Migration 20260826_150000 ist noch nicht gelaufen.');
            console.log('      Sie laeuft beim naechsten Start des Dashboards mit.');
        }
        await c.end();
    }

    console.log(abweichungen === 0
        ? `\nErgebnis: ${faelle} Pruefungen, 0 Abweichungen.\n`
        : `\nErgebnis: ${faelle} Pruefungen, ${abweichungen} Abweichung(en).\n`);
    process.exit(abweichungen === 0 ? 0 : 1);
})().catch(e => { console.log('\nAbgebrochen:', e.message, '\n'); process.exit(1); });
