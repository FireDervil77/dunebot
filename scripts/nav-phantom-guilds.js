#!/usr/bin/env node
/**
 * Findet Navigationseinträge, die zu keiner echten Guild gehören.
 *
 * Hintergrund: Die Basis-Middleware hat jedes Segment hinter /guild/ als Guild-ID
 * genommen. Ein relativ aufgelöster Monaco-Sourcemap-Pfad
 * (/guild/min-maps/vs/base/common/worker/simpleWorker.nls.js.map) erzeugte so die
 * Phantom-Guild "min-maps", für die sich die selbstheilende Navigation prompt
 * 21 Einträge anlegte. Die Ursache ist in base.middleware.js behoben
 * (istGueltigeGuildId), dieses Skript räumt Altlasten weg und prüft nach.
 *
 * Trockenlauf ist Standard, --apply löscht.
 *
 *   node scripts/nav-phantom-guilds.js
 *   node scripts/nav-phantom-guilds.js --apply
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', 'apps', 'dashboard', '.env') });
const mysql = require('mysql2/promise');

const SCHREIBEN = process.argv.includes('--apply');
const SNOWFLAKE = /^\d{17,20}$/;

(async () => {
    const db = await mysql.createConnection({
        host: process.env.MYSQL_HOST,
        port: process.env.MYSQL_PORT,
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE
    });

    const [guilds] = await db.query('SELECT _id FROM guilds');
    const bekannt = new Set(guilds.map(g => String(g._id)));

    const [nav] = await db.query(
        'SELECT guildId, COUNT(*) AS anzahl, MIN(createdAt) AS erst FROM guild_nav_items GROUP BY guildId'
    );

    const phantome = nav.filter(z => !SNOWFLAKE.test(String(z.guildId)) || !bekannt.has(String(z.guildId)));

    if (phantome.length === 0) {
        console.log('Keine Phantom-Guilds in guild_nav_items — alle Einträge gehören zu bekannten Guilds.');
        await db.end();
        return;
    }

    console.log(`${phantome.length} Phantom-Guild(s) gefunden:\n`);
    for (const p of phantome) {
        const grund = SNOWFLAKE.test(String(p.guildId))
            ? 'keine Guild mit dieser ID in der guilds-Tabelle'
            : 'keine gültige Discord-ID (Snowflake mit 17–20 Ziffern)';
        console.log(`  "${p.guildId}" — ${p.anzahl} Einträge, angelegt ${new Date(p.erst).toISOString().slice(0, 19)}`);
        console.log(`     Grund: ${grund}`);

        const [beispiele] = await db.query(
            'SELECT title, url FROM guild_nav_items WHERE guildId = ? LIMIT 3',
            [p.guildId]
        );
        for (const b of beispiele) console.log(`     z. B. ${b.title} -> ${b.url}`);
        console.log('');
    }

    const gesamt = phantome.reduce((s, p) => s + p.anzahl, 0);

    if (!SCHREIBEN) {
        console.log(`Trockenlauf — es wurde nichts geändert. ${gesamt} Zeilen würden gelöscht.`);
        console.log('Mit --apply ausführen, um sie zu entfernen.');
        await db.end();
        return;
    }

    const [res] = await db.query(
        `DELETE FROM guild_nav_items WHERE guildId IN (${phantome.map(() => '?').join(',')})`,
        phantome.map(p => p.guildId)
    );
    console.log(`${res.affectedRows} Zeilen gelöscht.`);

    const [rest] = await db.query('SELECT DISTINCT guildId FROM guild_nav_items');
    const uebrig = rest.filter(z => !SNOWFLAKE.test(String(z.guildId)) || !bekannt.has(String(z.guildId)));
    console.log(uebrig.length === 0
        ? 'Nachkontrolle: keine Phantom-Guilds mehr vorhanden.'
        : `Nachkontrolle: es sind noch ${uebrig.length} übrig — bitte prüfen.`);

    await db.end();
})().catch(err => {
    console.error('Fehler:', err.message);
    process.exit(1);
});
