#!/usr/bin/env node
/**
 * Findet Dateien im Medienordner, zu denen keine Zeile in `guild_media` gehoert.
 *
 * Solche Waisen entstanden, wenn ein Upload nach dem Schreiben abbrach — etwa
 * weil mehr Dateien geschickt wurden, als der Server nimmt. Multer schreibt,
 * bevor es abbricht; aufgeraeumt wurde bis zum 2026-09-16 nur im 500er-Zweig.
 * Der Fehler ist behoben, die Altlast bleibt.
 *
 *   node scripts/medien-verwaiste.js            # nur zeigen
 *   node scripts/medien-verwaiste.js --loeschen # wirklich loeschen
 *
 * Ohne `--loeschen` wird **nichts** angefasst.
 */
'use strict';

const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', 'apps/dashboard/.env'), quiet: true });
const mysql = require('mysql2/promise');

const WURZEL = path.join(__dirname, '..');
const MEDIEN = path.join(WURZEL, 'apps/dashboard/uploads/media');
const LOESCHEN = process.argv.includes('--loeschen');

(async () => {
    if (!fs.existsSync(MEDIEN)) {
        console.log(`Kein Medienordner unter ${MEDIEN} — nichts zu tun.`);
        return;
    }

    const v = await mysql.createConnection({
        host: process.env.MYSQL_HOST, port: process.env.MYSQL_PORT,
        user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE,
    });

    const [zeilen] = await v.query('SELECT guild_id, stored_name FROM guild_media');
    await v.end();

    // Je Guild eine Menge — ein Name aus Guild A darf keine Datei in Guild B
    // retten. Die Ordner heissen nach der Guild.
    const bekannt = new Map();
    for (const z of zeilen) {
        if (!bekannt.has(z.guild_id)) bekannt.set(z.guild_id, new Set());
        bekannt.get(z.guild_id).add(z.stored_name);
    }

    let gefunden = 0, bytes = 0, geloescht = 0;

    for (const guildOrdner of fs.readdirSync(MEDIEN, { withFileTypes: true })) {
        if (!guildOrdner.isDirectory()) continue;
        const guildId = guildOrdner.name;
        const voll = path.join(MEDIEN, guildId);
        const menge = bekannt.get(guildId) || new Set();

        // **Sicherung:** Eine Guild ohne jede Zeile in `guild_media` wird
        // uebersprungen. Sonst raeumte ein Fehler in der Abfrage — oder eine
        // noch nicht migrierte Guild — den ganzen Ordner leer.
        if (menge.size === 0) {
            console.log(`  – ${guildId}: keine einzige Zeile in guild_media, uebersprungen`);
            continue;
        }

        for (const datei of fs.readdirSync(voll)) {
            if (menge.has(datei)) continue;
            const pfad = path.join(voll, datei);
            const groesse = fs.statSync(pfad).size;
            gefunden++; bytes += groesse;
            console.log(`  ${LOESCHEN ? '✗' : '·'} ${guildId}/${datei}  ${Math.round(groesse / 1024)} KB`);
            if (LOESCHEN) { fs.unlinkSync(pfad); geloescht++; }
        }
    }

    const mb = Math.round(bytes / 1024 / 1024 * 10) / 10;
    console.log(`\n${gefunden} verwaiste Datei(en), ${mb} MB.`);
    if (LOESCHEN) console.log(`${geloescht} geloescht.`);
    else if (gefunden > 0) console.log('Nichts angefasst. Zum Loeschen: --loeschen');
})().catch((e) => { console.error('FEHLER:', e.message); process.exit(1); });
