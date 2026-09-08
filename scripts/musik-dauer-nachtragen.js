#!/usr/bin/env node
/**
 * Traegt die Dauer bei Tondateien nach, die vor dem 2026-09-08 hochgeladen wurden.
 *
 * `music_files.dauer_sek` wurde an drei Stellen gelesen und an keiner
 * geschrieben (Befund des Betreibers: „die gesamte restspielzeit der box wird
 * ebenfalls nicht angegeben"). Seit dem 2026-09-08 misst der Upload selbst —
 * dieses Skript holt nach, was schon liegt.
 *
 * ── Warum ein Skript und keine Migration ────────────────────────────────────
 *
 * Eine Migration laeuft beim Start des Dashboards. Sie wuerde fuer jede Datei
 * ffmpeg starten und damit den Start um so viel verzoegern, wie die Ablage
 * gross ist — bei sechs Dateien unbemerkt, bei tausend eine Minute Stillstand
 * ohne Erklaerung. Das Nachtragen ist einmalig; einmalige Arbeit gehoert nicht
 * in einen Weg, der bei jedem Neustart entlangfaehrt.
 *
 *   node scripts/musik-dauer-nachtragen.js --trocken   nur zeigen
 *   node scripts/musik-dauer-nachtragen.js             schreiben
 *
 * Ruecknahme (die betroffenen Kennungen nennt der Lauf):
 *   UPDATE music_files SET dauer_sek = NULL WHERE id IN (...);
 */
'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../apps/dashboard/.env') });

const path = require('path');
const fs = require('fs');
const mysql = require('mysql2/promise');
const { dauerLesen } = require('../plugins/music/shared/dauer');

const trocken = process.argv.includes('--trocken');

(async () => {
    const c = await mysql.createConnection({
        host: process.env.MYSQL_HOST, port: process.env.MYSQL_PORT,
        user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE,
    });

    const [zeilen] = await c.query(
        `SELECT id, guild_id, dateiname, originalname
           FROM music_files
          WHERE dauer_sek IS NULL
          ORDER BY id`);

    console.log(`\n▸ ${zeilen.length} Datei(en) ohne Dauer${trocken ? ' — Trockenlauf' : ''}\n`);

    const basis = path.join(__dirname, '..', 'apps', 'dashboard', 'uploads', 'musik');
    const gesetzt = [];
    let fehlend = 0, unlesbar = 0;

    for (const z of zeilen) {
        const pfad = path.join(basis, String(z.guild_id), z.dateiname);

        if (!fs.existsSync(pfad)) {
            // Eine Zeile ohne Datei ist ein eigener Befund — sie taucht in der
            // Ablage auf, laesst sich aber nicht abspielen. Nur melden, nicht
            // aufraeumen: Loeschen waere eine Entscheidung, die niemand traf.
            console.log(`  ⚠ ${z.id}  Datei fehlt auf der Platte: ${z.dateiname}`);
            fehlend++;
            continue;
        }

        const sek = await dauerLesen(pfad);
        if (sek === null) {
            console.log(`  ⚠ ${z.id}  Dauer nicht lesbar: ${z.originalname}`);
            unlesbar++;
            continue;
        }

        const min = Math.floor(sek / 60), rest = String(sek % 60).padStart(2, '0');
        console.log(`  ${trocken ? '·' : '✓'} ${z.id}  ${min}:${rest}  ${z.originalname}`);

        if (!trocken) {
            await c.query('UPDATE music_files SET dauer_sek = ? WHERE id = ?', [sek, z.id]);
        }
        gesetzt.push(z.id);
    }

    console.log(`\n${trocken ? 'Wuerde setzen' : 'Gesetzt'}: ${gesetzt.length}`
        + (fehlend ? ` · Datei fehlt: ${fehlend}` : '')
        + (unlesbar ? ` · nicht lesbar: ${unlesbar}` : ''));
    if (gesetzt.length && !trocken) {
        console.log(`Ruecknahme: UPDATE music_files SET dauer_sek = NULL WHERE id IN (${gesetzt.join(', ')});`);
    }
    console.log('');

    await c.end();
})().catch((e) => { console.error('FEHLER:', e.message); process.exit(1); });
