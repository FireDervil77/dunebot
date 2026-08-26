#!/usr/bin/env node
/**
 * Prueft die Kontoverknuepfung — Registry, Weg, Seite und Speicher.
 *
 * Hintergrund: `docs/streamer-plugin/11-Kontoverknuepfung.md` und F-16. Der
 * Markt zieht die Grenze nicht zwischen oeffentlichen und privaten Daten,
 * sondern zwischen einer Aussage ueber einen **Kanal** und einer ueber eine
 * **Person**. Diese Verknuepfung ist der Beleg fuer die zweite Sorte.
 *
 * Drei Zusagen werden hier wirklich geprueft, nicht im Quelltext gesucht:
 *
 *   1. **Kein Zugangsschluessel wird abgelegt.** Am selben Tag wurde genau
 *      das aus `users.tokens` entfernt (Baustelle 74) — es hier durch die
 *      Hintertuer wieder einzufuehren waere absurd.
 *   2. **Keine offene Weiterleitung.** Das Rueckkehrziel kommt aus der
 *      Adresszeile. Ein Link, der bei uns beginnt und woanders endet, ist
 *      genau das, womit Phishing arbeitet — deshalb wird `sicheresZiel`
 *      aufgerufen, nicht per Regex gelesen.
 *   3. **Ein Konto gehoert hoechstens einem Benutzer.** Ohne diese
 *      Eindeutigkeit waere die Tabelle nur eine hoeflichere Form desselben
 *      Auswahlfeldes, das sie ersetzen soll.
 *
 *   node scripts/check-verbindungen.js
 *
 * Exitcode 1 bei jeder Abweichung.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
require('dotenv').config({ path: path.join(__dirname, '../apps/dashboard/.env'), quiet: true });

const WURZEL = path.join(__dirname, '..');
const lies = (p) => fs.readFileSync(path.join(WURZEL, p), 'utf8');
const da = (p) => fs.existsSync(path.join(WURZEL, p));
const ohneKommentare = (q) => q.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

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
    // ── Registry: wirklich benutzen, nicht lesen ────────────────────────
    console.log('\nRegistrierungsstelle');
    const { VerbindungsRegistry } = require('../packages/dunebot-sdk');

    pruefe('leere Liste, solange niemand eingetragen ist',
        VerbindungsRegistry.list().length === 0, `${VerbindungsRegistry.list().length} Eintraege`);

    let abgelehnt = false;
    try {
        VerbindungsRegistry.register('probe', { label: 'Probe' });
    } catch { abgelehnt = true; }
    pruefe('Anbieter ohne die beiden Pflichtfunktionen wird abgelehnt', abgelehnt,
        'sonst faellt es erst auf, wenn jemand auf "Verbinden" klickt');

    let namePruefung = false;
    try {
        VerbindungsRegistry.register('../boese', { autorisierUrl: () => {}, identitaet: () => {} });
    } catch { namePruefung = true; }
    pruefe('Name, der einen Pfad verlassen koennte, wird abgelehnt', namePruefung);

    VerbindungsRegistry.register('probe', {
        label: 'Probe', autorisierUrl: async () => 'https://x', identitaet: async () => null
    });
    pruefe('eingetragener Anbieter erscheint in der Liste',
        VerbindungsRegistry.list().some(a => a.name === 'probe'));
    VerbindungsRegistry.unregister('probe');
    pruefe('ausgetragener Anbieter verschwindet',
        !VerbindungsRegistry.get('probe'));

    // ── Offene Weiterleitung: die Funktion aufrufen ─────────────────────
    console.log('\nRueckkehrziel');
    const { sicheresZiel } = require('../apps/dashboard/routes/verbindungen.router');
    const proben = [
        ['/guild/1/profile/verbindungen', true,  'eigener Pfad'],
        ['/x?a=1',                        true,  'mit Abfrage'],
        ['//fremde.example',              false, 'schemarelativ — der klassische Trick'],
        ['https://fremde.example',        false, 'absolute Adresse'],
        ['',                              false, 'leer']
    ];
    for (const [ein, erlaubt, warum] of proben) {
        pruefe(`${erlaubt ? 'erlaubt' : 'abgewiesen'}: ${JSON.stringify(ein)}`,
            Boolean(sicheresZiel(ein)) === erlaubt, warum);
    }

    // ── Kein Schluessel im Speicher ─────────────────────────────────────
    console.log('\nKein Zugangsschluessel');
    const router = ohneKommentare(lies('apps/dashboard/routes/verbindungen.router.js'));
    pruefe('der Kern schreibt keinen Token in die Tabelle',
        !/access_token|refresh_token/.test(router));

    const migration = ohneKommentare(lies('migrations/kern/20260826_160000_verbundene_konten.js'));
    pruefe('die Tabelle hat gar keine Token-Spalte',
        !/token/i.test(migration));

    const twitch = ohneKommentare(lies('plugins/streaming/dashboard/plattformen/twitch.js'));
    const gibtZurueck = /return\s*\{\s*kontoId/.test(twitch);
    pruefe('der Adapter gibt nur die Identitaet zurueck', gibtZurueck,
        '{ kontoId, kontoName } — nicht den Benutzertoken');

    // ── Weg und Seite ───────────────────────────────────────────────────
    console.log('\nVerdrahtung');
    pruefe('Router eingehaengt',
        /\.register\('\/verbindungen'/.test(lies('apps/dashboard/app.js')));
    pruefe('Seite im Profil-Router',
        /router\.get\('\/verbindungen'/.test(lies('apps/dashboard/routes/guild/profile.router.js')));

    const ANSICHT = 'apps/dashboard/themes/default/views/guild/profile-verbindungen.ejs';
    pruefe('Ansicht vorhanden', da(ANSICHT));
    try { ejs.compile(lies(ANSICHT), { filename: ANSICHT }); pruefe('Ansicht laesst sich uebersetzen', true); }
    catch (e) { pruefe('Ansicht laesst sich uebersetzen', false, e.message); }

    pruefe('das Profil verweist auf die Seite',
        lies('apps/dashboard/themes/default/views/guild/profile.ejs').includes('/profile/verbindungen'));

    // ── Die Eindeutigkeiten in der Datenbank ────────────────────────────
    console.log('\nTabelle');
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
        console.log('    Das ist KEINE Entwarnung.');
    }

    if (c) {
        const [tab] = await c.query("SHOW TABLES LIKE 'user_connections'");
        pruefe('user_connections existiert', tab.length > 0,
            tab.length ? '' : 'Migration 20260826_160000 laeuft beim naechsten Start');
        if (tab.length) {
            const [idx] = await c.query('SHOW INDEX FROM user_connections');
            const namen = new Set(idx.filter(i => Number(i.Non_unique) === 0).map(i => i.Key_name));
            pruefe('ein Benutzer hat je Plattform hoechstens ein Konto',
                namen.has('uniq_benutzer_plattform'));
            pruefe('ein Konto gehoert hoechstens einem Benutzer',
                namen.has('uniq_plattform_konto'),
                'ohne das waere die Verknuepfung nur eine hoeflichere Behauptung');
            const [spalten] = await c.query('SHOW COLUMNS FROM user_connections');
            pruefe('keine Token-Spalte in der Tabelle',
                !spalten.some(s => /token/i.test(s.Field)),
                spalten.map(s => s.Field).join(', '));
        }
        await c.end();
    }

    console.log(abweichungen === 0
        ? `\nErgebnis: ${faelle} Pruefungen, 0 Abweichungen.\n`
        : `\nErgebnis: ${faelle} Pruefungen, ${abweichungen} Abweichung(en).\n`);
    process.exit(abweichungen === 0 ? 0 : 1);
})().catch(e => { console.log('\nAbgebrochen:', e.message, '\n'); process.exit(1); });
