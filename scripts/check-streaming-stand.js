#!/usr/bin/env node
/**
 * Prueft, was vom Streaming-Plugin in der Datenbank tatsaechlich angekommen ist.
 *
 * Hintergrund: Ein Plugin wird beim Dashboard-Start nur **gefunden**. Tabellen,
 * Rechte und Navigation entstehen erst, wenn es in einer Guild eingeschaltet
 * wird (`PluginManager.enablePlugin` -> `MigrationRunner.runPlugin`). Ob das
 * vollstaendig geschah, sieht man der Oberflaeche nicht an - fehlt ein Recht,
 * ist die Seite einfach leer.
 *
 * Nach jedem Aktivieren und nach jeder Aenderung an permissions.json:
 *   node scripts/check-streaming-stand.js
 *
 * Meldet mit Exitcode 1, wenn etwas fehlt.
 */
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../apps/dashboard/.env') });
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

const TABELLEN = [
    'streaming_streamers', 'streaming_subscriptions', 'streaming_state',
    'streaming_events', 'streaming_targets', 'streaming_messages', 'streaming_outbox'
];

let fehlend = 0;

/**
 * @param {boolean} gut Bedingung
 * @param {string} text Beschreibung
 * @param {string} [zusatz] Ergaenzung
 */
function pruefe(gut, text, zusatz = '') {
    console.log(`  ${gut ? '✓' : '✗'} ${text}${zusatz ? ' — ' + zusatz : ''}`);
    if (!gut) fehlend++;
}

(async () => {
    let c;
    try {
        c = await mysql.createConnection({
            host: process.env.MYSQL_HOST, port: process.env.MYSQL_PORT || 3306,
            user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
            database: process.env.MYSQL_DATABASE
        });

        // --- Tabellen ---
        console.log('\nTabellen');
        const [t] = await c.query("SHOW TABLES LIKE 'streaming\\_%'");
        const da = t.map(r => Object.values(r)[0]);
        for (const name of TABELLEN) pruefe(da.includes(name), name);

        // --- Laengen: der Fehler, der sonst erst beim Aktivieren auffaellt ---
        //
        // `permission_definitions.description_translation_key` ist
        // varchar(100). Ist ein Text laenger, scheitert genau dieses eine
        // Recht mit "Data too long" - die anderen gehen durch, das Plugin
        // wirkt eingerichtet, und die Seite bleibt leer, weil ausgerechnet
        // das VIEW-Recht fehlt. Genau so passiert am 2026-08-23.
        console.log('\nTextlaengen (Grenze: 100 Zeichen)');
        const dateiFrueh = JSON.parse(fs.readFileSync(
            path.join(__dirname, '../plugins/streaming/dashboard/permissions.json'), 'utf8'));
        for (const perm of dateiFrueh.permissions) {
            pruefe((perm.description || '').length <= 100, `${perm.key}`,
                `${(perm.description || '').length} Zeichen`);
            pruefe((perm.name || '').length <= 100, `${perm.key} (Name)`,
                `${(perm.name || '').length} Zeichen`);
        }

        // --- Rechte: Datei gegen Katalog ---
        console.log('\nRechte (permissions.json gegen permission_definitions)');
        const datei = JSON.parse(fs.readFileSync(
            path.join(__dirname, '../plugins/streaming/dashboard/permissions.json'), 'utf8'));
        const erwartet = datei.permissions.map(p => p.key);

        const [p] = await c.query(
            "SELECT permission_key FROM permission_definitions WHERE permission_key LIKE 'STREAMING.%'");
        const katalog = p.map(r => r.permission_key);

        for (const key of erwartet) {
            const eintrag = datei.permissions.find(x => x.key === key);
            pruefe(katalog.includes(key), key,
                `requires=${eintrag.requires || 'null'}, gefaehrlich=${eintrag.is_dangerous}`);
        }
        for (const key of katalog) {
            if (!erwartet.includes(key)) pruefe(false, `${key} steht im Katalog, aber nicht in der Datei`);
        }

        // --- Aktivierung und Navigation ---
        console.log('\nAktivierung');
        const [g] = await c.query(
            "SELECT guild_id, is_enabled FROM guild_plugins WHERE plugin_name = 'streaming'");
        pruefe(g.length > 0, `in ${g.length} Guild(s) eingetragen`,
            g.map(r => `${r.guild_id}=${r.is_enabled}`).join(', '));

        // Tabelle heisst guild_nav_items, nicht nav_items - nachgesehen,
        // nicht geraten.
        const [n] = await c.query(
            "SELECT title, url FROM guild_nav_items WHERE url LIKE '%plugins/streaming%'");
        pruefe(n.length > 0, `${n.length} Navigationseintraege`);
        n.forEach(r => console.log(`      ${r.title}  ->  ${r.url}`));

        console.log(fehlend === 0
            ? '\nErgebnis: 0 Abweichungen.\n'
            : `\nErgebnis: ${fehlend} Abweichung(en).\n`);
    } catch (e) {
        console.log('FEHLER:', e.code || e.message);
        fehlend++;
    } finally {
        if (c) await c.end().catch(() => {});
        process.exit(fehlend === 0 ? 0 : 1);
    }
})();
