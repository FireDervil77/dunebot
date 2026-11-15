#!/usr/bin/env node
'use strict';

/**
 * Auswertung der Messprobe Nachrichtenmenge (G-18, K382, 2026-11-15).
 *
 * Liest `messprobe_nachrichten` (nur lesend) und zeigt je Guild den Schnitt
 * je Tag, die Spitzenstunde und eine Hochrechnung auf ein Jahr. Daraus folgen
 * Indizes, Fristen-Vorgaben und die Speicherrechnung für Logging und Leveling
 * (`docs/plugins/gemeinsam/baustellen.md` G-18).
 *
 *   node scripts/messprobe-auswerten.js
 *   node scripts/messprobe-auswerten.js --stunden    dazu jede Stunde je Guild
 *
 * Gezählt wird ab der ersten Zeile; die erste und die laufende Stunde sind
 * angebrochen. Der Schnitt teilt durch die volle Spanne, auch für Guilds, in
 * denen nichts geschrieben wurde.
 */
const path = require('path');
const WURZEL = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(WURZEL, 'apps/dashboard/.env'), quiet: true });

const SPALTEN = ['menschen', 'bots', 'inhalt_bytes', 'anhaenge', 'mitglied_minuten', 'bearbeitet', 'geloescht'];

function zahl(x, stellen = 0) {
    return Number(x).toLocaleString('de-DE', { minimumFractionDigits: stellen, maximumFractionDigits: stellen });
}

async function main() {
    const mysql = require('mysql2/promise');
    const c = await mysql.createConnection({ host: process.env.MYSQL_HOST, port: process.env.MYSQL_PORT,
        user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE,
        dateStrings: true, supportBigNumbers: true, bigNumberStrings: true });
    try {
        const [[spanne]] = await c.query(`SELECT MIN(stunde) AS ab, MAX(stunde) AS bis,
            TIMESTAMPDIFF(HOUR, MIN(stunde), MAX(stunde)) + 1 AS stunden FROM messprobe_nachrichten`);
        if (!spanne.ab) { console.log('Messprobe G-18: noch keine Zeile in messprobe_nachrichten.'); return; }
        const stunden = Number(spanne.stunden);
        const tage = stunden / 24;

        const [zeilen] = await c.query(`SELECT guild_id, ${SPALTEN.map((s) => `SUM(${s}) AS ${s}`).join(', ')},
            MAX(menschen + bots) AS spitze, COUNT(*) AS stunden_mit
            FROM messprobe_nachrichten GROUP BY guild_id`);
        // Namen getrennt: `guilds` hat eine andere Kollation (Gedächtnis „Kollationsgrenze“).
        const [namen] = await c.query('SELECT _id, guild_name FROM guilds');
        const name = new Map(namen.map((n) => [String(n._id), n.guild_name]));

        console.log(`Messprobe G-18 — ${spanne.ab} bis ${spanne.bis} UTC, ${stunden} Stunden (${zahl(tage, 1)} Tage), ${zeilen.length} Guilds\n`);
        const kopf = ['Guild', 'Nachr./Tag', 'Bots/Tag', 'Spitze/h', 'Mitgl.-Min./Tag', 'KB Text/Tag', 'Anh./Tag', 'Bearb./Tag', 'Gel./Tag'];
        const reihen = [];
        const summe = Object.fromEntries(SPALTEN.map((s) => [s, 0]));
        let spitze = 0;
        for (const z of zeilen) {
            for (const s of SPALTEN) summe[s] += Number(z[s]);
            spitze = Math.max(spitze, Number(z.spitze));
            reihen.push([`${(name.get(String(z.guild_id)) || '?').slice(0, 28)} (${z.guild_id})`,
                (Number(z.menschen) + Number(z.bots)) / tage, Number(z.bots) / tage, Number(z.spitze),
                Number(z.mitglied_minuten) / tage, Number(z.inhalt_bytes) / 1024 / tage,
                Number(z.anhaenge) / tage, Number(z.bearbeitet) / tage, Number(z.geloescht) / tage]);
        }
        reihen.sort((a, b) => b[1] - a[1]);
        reihen.push(['Summe', (summe.menschen + summe.bots) / tage, summe.bots / tage, spitze,
            summe.mitglied_minuten / tage, summe.inhalt_bytes / 1024 / tage,
            summe.anhaenge / tage, summe.bearbeitet / tage, summe.geloescht / tage]);
        const text = reihen.map((r) => r.map((x, i) => (i === 0 ? x : zahl(x, i === 5 ? 1 : 0))));
        const breite = kopf.map((k, i) => Math.max(k.length, ...text.map((r) => r[i].length)));
        const zeile = (r) => r.map((x, i) => (i === 0 ? x.padEnd(breite[i]) : x.padStart(breite[i]))).join('  ');
        console.log(zeile(kopf));
        text.forEach((r, i) => { if (i === text.length - 1) console.log('-'.repeat(breite.reduce((a, b) => a + b + 2, -2))); console.log(zeile(r)); });

        const jahr = 365 / tage;
        console.log('\nHochrechnung auf ein Jahr (alle Guilds, Schnitt dieser Spanne):');
        console.log(`  Logging, eine Zeile je Nachricht, Bearbeitung, Löschung: ${zahl((summe.menschen + summe.bots + summe.bearbeitet + summe.geloescht) * jahr)}`);
        console.log(`  davon nur Menschen-Nachrichten:                          ${zahl(summe.menschen * jahr)}`);
        console.log(`  Text der Nachrichten:                                    ${zahl(summe.inhalt_bytes * jahr / 1024 / 1024, 1)} MB (ohne Zeilenkopf und Indizes)`);
        console.log(`  Leveling, eine Buchung je Mitglied und Minute:           ${zahl(summe.mitglied_minuten * jahr)}`);
        console.log(`  Spitze: ${zahl(spitze)} Nachrichten in einer Stunde in einer Guild`);

        if (process.argv.includes('--stunden')) {
            const [alle] = await c.query('SELECT * FROM messprobe_nachrichten ORDER BY guild_id, stunde');
            console.log('\nguild_id\tstunde\t' + SPALTEN.join('\t'));
            for (const z of alle) console.log([z.guild_id, z.stunde, ...SPALTEN.map((s) => z[s])].join('\t'));
        }
    } finally {
        await c.end();
    }
}

main().catch((e) => {
    if (e.code === 'ER_NO_SUCH_TABLE') console.error('Messprobe G-18: Tabelle messprobe_nachrichten fehlt. Die Kern-Migration läuft beim nächsten Neustart von Bot oder Dashboard.');
    else console.error(e.message);
    process.exit(1);
});
