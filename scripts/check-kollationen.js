#!/usr/bin/env node
/**
 * Prueft, ob sich Guild-Kennungen ueberhaupt vergleichen lassen.
 *
 * ## Der Befund vom 2026-08-29
 *
 * Stufe 14 (die Heim-Guild) war gebaut, committet und gegen eine Attrappe
 * geprueft - **34 Pruefungen, 0 Abweichungen.** Gegen die echte Datenbank warf
 * dieselbe Abfrage:
 *
 *     Illegal mix of collations (utf8mb4_unicode_ci,IMPLICIT)
 *                           and (utf8mb4_general_ci,IMPLICIT)
 *                           for operation '='
 *
 * Der Kern (`guilds._id`, `guild_plugins.guild_id`) ist `utf8mb4_unicode_ci`,
 * einige Plugin-Tabellen sind `utf8mb4_general_ci`. Beide Spalten tragen
 * dieselbe Discord-Kennung aus Ziffern - MySQL vergleicht sie trotzdem nicht.
 * Die Heim-Guild-Auswahl im Profil konnte deshalb **nie** jemand benutzen.
 *
 * **Eine Attrappe kann das nicht finden.** Sie hat keine Kollationen; sie
 * antwortet auf ein Muster. Genau dafuer gibt es dieses Skript: Es fragt die
 * Datenbank selbst, lesend, ohne etwas zu aendern.
 *
 * ## Was es prueft
 *
 * Jede Spalte, die eine Discord-Guild-Kennung traegt, muss dieselbe Kollation
 * haben wie `guilds._id` - sonst laesst sie sich nicht mit ihr verbinden.
 *
 * **Es meldet nicht jede Abweichung als Fehler.** Elf Spalten stehen seit
 * jeher auf der anderen Seite; sie umzustellen ist eine eigene Entscheidung
 * (Baustelle, nicht Nebenwirkung). Rot wird dieses Skript, wenn eine
 * **zwoelfte** dazukommt - dann ist gerade jemand dabei, den Befund zu
 * vergroessern, statt ihn abzutragen.
 *
 *   node scripts/check-kollationen.js
 *
 * Exitcode 1 bei einer neuen Abweichung.
 */
'use strict';

const path = require('path');
const WURZEL = path.join(__dirname, '..');
require(path.join(WURZEL, 'node_modules/dotenv')).config({
    path: path.join(WURZEL, 'apps/dashboard/.env')
});
const mysql = require(path.join(WURZEL, 'node_modules/mysql2/promise'));

/**
 * Der Stand vom 2026-08-29 - **kein Ziel, ein Ausgangspunkt.**
 *
 * Diese Liste wird kuerzer, nie laenger. Wer eine Zeile entfernen kann, weil
 * die Spalte umgestellt wurde, entfernt sie. Wer eine hinzufuegen moechte,
 * baut gerade eine Spalte, die sich mit `guilds._id` nicht vergleichen laesst
 * - und sollte sie stattdessen gleich richtig anlegen.
 */
const BEKANNT = new Set([
    'automod_compound_rules.guild_id',
    'guild_command_state.guild_id',
    'music_history.guild_id',
    'music_playlists.guild_id',
    'music_queue.guild_id',
    'music_sessions.guild_id',
    'music_settings.guild_id',
    'streaming_outbox.guild_id',
    'streaming_role_grants.guild_id',
    'streaming_streamers.heim_guild_id',
    'streaming_targets.guild_id'
]);

(async () => {
    let verbindung;
    try {
        verbindung = await mysql.createConnection({
            host: process.env.MYSQL_HOST,
            user: process.env.MYSQL_USER,
            password: process.env.MYSQL_PASSWORD,
            database: process.env.MYSQL_DATABASE,
            port: process.env.MYSQL_PORT || 3306
        });
    } catch (err) {
        // **Kein stiller Rueckfall auf "in Ordnung".** Wer nicht messen konnte,
        // weiss nichts - und ein gruener Haken dafuer waere die halbe Auskunft,
        // gegen die dieses Haus geschrieben ist.
        console.error(`\nDie Datenbank ist nicht erreichbar: ${err.message}`);
        console.error('Dieses Skript misst am echten Bestand — ohne ihn misst es nichts.\n');
        process.exit(2);
    }

    const [massgeblich] = await verbindung.query(`
        SELECT COLLATION_NAME FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'guilds' AND COLUMN_NAME = '_id'`);
    const soll = massgeblich[0]?.COLLATION_NAME;

    if (!soll) {
        console.error('\n`guilds._id` gibt es nicht — dann ist hier nichts zu messen.\n');
        process.exit(2);
    }

    const [spalten] = await verbindung.query(`
        SELECT TABLE_NAME, COLUMN_NAME, COLLATION_NAME
          FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND COLLATION_NAME IS NOT NULL
           AND (COLUMN_NAME LIKE '%guild_id' OR (TABLE_NAME = 'guilds' AND COLUMN_NAME = '_id'))
         ORDER BY TABLE_NAME, COLUMN_NAME`);
    await verbindung.end();

    console.log(`\nMassgeblich ist \`guilds._id\` (${soll}).`);
    console.log(`${spalten.length} Spalten tragen eine Guild-Kennung.\n`);

    const abweichend = spalten
        .filter(s => s.COLLATION_NAME !== soll)
        .map(s => ({ name: `${s.TABLE_NAME}.${s.COLUMN_NAME}`, kollation: s.COLLATION_NAME }));

    const neu      = abweichend.filter(a => !BEKANNT.has(a.name));
    const geheilt  = [...BEKANNT].filter(b => !abweichend.some(a => a.name === b));
    const bekannt  = abweichend.filter(a => BEKANNT.has(a.name));

    if (bekannt.length) {
        console.log(`Bekannt und offen (${bekannt.length}) — Baustelle, kein Fehler:`);
        bekannt.forEach(a => console.log(`  · ${a.name} (${a.kollation})`));
        console.log('  → Ein Join dieser Spalten mit `guilds` WIRFT. Bis zur Umstellung');
        console.log('    gilt: Kennungen als Parameter uebergeben, nicht joinen.\n');
    }

    if (geheilt.length) {
        console.log(`Erledigt (${geheilt.length}) — bitte aus BEKANNT streichen:`);
        geheilt.forEach(g => console.log(`  ✓ ${g}`));
        console.log('');
    }

    if (neu.length) {
        console.log(`NEU (${neu.length}) — hier ist gerade etwas dazugekommen:`);
        neu.forEach(a => console.log(`  ✗ ${a.name} (${a.kollation})`));
        console.log(`  → Diese Spalte laesst sich mit \`guilds._id\` nicht vergleichen.`);
        console.log(`    Richtig waere \`VARCHAR(...) COLLATE ${soll}\`.\n`);
        process.exit(1);
    }

    console.log(`Ergebnis: keine neue Abweichung (${abweichend.length} bekannte offen).\n`);
})().catch(err => {
    console.error('\nAbbruch:', err.message, '\n');
    process.exit(2);
});
