#!/usr/bin/env node
/**
 * Prueft die **Referenzzaehlung**: ein Kanal, viele Guilds, ein Satz Abos.
 *
 * Das ist der Kern der Bauform "Abo global, Ziel pro Guild". Er hat zwei
 * Seiten, und beide versagen lautlos:
 *
 *   Loch  — ein Ziel ohne vollstaendige Abos. Twitch klopft nie an, die
 *           Ankuendigung bleibt aus, und die Oberflaeche sieht heil aus.
 *   Leck  — ein Abo ohne Ziel. Kostet Kontingent fuer niemanden. Faellt erst
 *           auf, wenn das Kontingent voll ist und der naechste Eintrag
 *           scheitert.
 *
 * Und die Falle dazwischen, die Abnahmefall 7 meint: Traegt eine **zweite**
 * Guild denselben Kanal ein, darf **kein zweites Abo** entstehen. Passiert es
 * doch, faellt es nirgends auf - beide Guilds bekommen ihre Ankuendigung, es
 * kostet nur doppelt. Deshalb wird hier je Streamer und Ereignis gezaehlt,
 * nicht nur "hat Abos".
 *
 * Nebenwirkungsfrei: liest nur, ruft Twitch nicht an, aendert nichts.
 *
 *   node scripts/check-streaming-referenz.js
 *
 * Exitcode 1 bei jeder Abweichung.
 */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../apps/dashboard/.env'), quiet: true });
const mysql = require('mysql2/promise');

// Aus dem Adapter, nicht von Hand: Die Liste gehoert der Plattform. Stuende
// sie hier noch einmal, pruefte das Skript irgendwann etwas anderes als das
// Plugin tut.
const { EREIGNISSE } = require('../plugins/streaming/dashboard/plattformen/twitch');

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
    const c = await mysql.createConnection({
        host: process.env.MYSQL_HOST, port: process.env.MYSQL_PORT || 3306,
        user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE
    });
    const q = async (sql, w = []) => (await c.query(sql, w))[0];

    const streamer = await q('SELECT id, plattform, login FROM streaming_streamers ORDER BY login');
    const ziele = await q('SELECT streamer_id, guild_id, aktiv, mitglied_id FROM streaming_targets');
    const abos = await q('SELECT streamer_id, ereignis, anbieter_abo_id, zustand FROM streaming_subscriptions');

    console.log('\nBestand');
    console.log(`  ${streamer.length} Kanal/Kanaele, ${ziele.length} Ziel(e), ${abos.length} Abo(s)`);

    // --- Je Streamer: Ziele gegen Abos ---
    console.log('\nEin Kanal, ein Satz Abos');
    for (const s of streamer) {
        const meine    = ziele.filter(z => z.streamer_id === s.id);
        const aktive   = meine.filter(z => Number(z.aktiv) === 1);
        const guilds   = new Set(aktive.map(z => String(z.guild_id)));
        const meineAbos = abos.filter(a => a.streamer_id === s.id);
        const wo = `${aktive.length} aktive(s) Ziel(e) in ${guilds.size} Guild(s)`;

        if (aktive.length === 0) {
            // Leck: niemand liest mehr mit, das Abo laeuft weiter.
            pruefe(`${s.login}: ohne Ziel auch ohne Abo`, meineAbos.length === 0,
                `${wo}, ${meineAbos.length} Abo(s)`);
            continue;
        }

        // Loch und Doppelung in einem Durchgang: je Pflichtereignis genau eins.
        const soll = s.plattform === 'twitch' ? EREIGNISSE : [];
        for (const e of soll) {
            const n = meineAbos.filter(a => a.ereignis === e).length;
            pruefe(`${s.login}: genau ein Abo fuer ${e}`, n === 1, `${n} gefunden, ${wo}`);
        }

        // Ein Abo ohne Anbieter-ID ist kein Abo, sondern eine Karteileiche:
        // abbestellen kann es niemand mehr, der Abgleich findet es nie wieder.
        const ohneId = meineAbos.filter(a => !a.anbieter_abo_id).length;
        pruefe(`${s.login}: jedes Abo kennt seine Anbieter-ID`, ohneId === 0, `${ohneId} ohne`);
    }

    // --- Abos ohne Streamer ---
    console.log('\nKeine Waisen');
    const bekannt = new Set(streamer.map(s => s.id));
    const waisen = abos.filter(a => !bekannt.has(a.streamer_id));
    pruefe('kein Abo ohne Kanal', waisen.length === 0, `${waisen.length} gefunden`);
    const zielWaisen = ziele.filter(z => !bekannt.has(z.streamer_id));
    pruefe('kein Ziel ohne Kanal', zielWaisen.length === 0, `${zielWaisen.length} gefunden`);

    // --- Was geteilt wird: der Fall, um den es geht ---
    console.log('\nGeteilte Kanaele (Abnahmefall 7)');
    let geteilt = 0;
    for (const s of streamer) {
        const guilds = new Set(ziele.filter(z => z.streamer_id === s.id && Number(z.aktiv) === 1)
            .map(z => String(z.guild_id)));
        if (guilds.size < 2) continue;
        geteilt++;
        const n = abos.filter(a => a.streamer_id === s.id).length;
        console.log(`  · ${s.login}: ${guilds.size} Guilds teilen sich ${n} Abo(s)`);
        for (const g of guilds) console.log(`      Guild ${g}`);
    }
    if (geteilt === 0) {
        console.log('  (keiner — Fall 7 ist damit nicht widerlegt, sondern ungeprueft)');
    }

    // --- Hinweis, kein Fehler: stille Nicht-Vergabe der Live-Rolle ---
    //
    // `mitglied_id` leer heisst laut `kern/takt.js`: Wir wissen nicht, wem der
    // Kanal gehoert, also passiert nichts. Das ist so gewollt und deshalb
    // keine Abweichung. Es steht hier trotzdem, weil "nichts passiert" in der
    // Oberflaeche genauso aussieht wie "hat geklappt".
    const ohneMitglied = ziele.filter(z => Number(z.aktiv) === 1 && !z.mitglied_id);
    if (ohneMitglied.length) {
        console.log('\nHinweis: Ziele ohne zugeordnetes Mitglied — dort wird die Live-Rolle');
        console.log('         still nicht vergeben (so gewollt, siehe kern/takt.js):');
        for (const z of ohneMitglied) {
            const s = streamer.find(x => x.id === z.streamer_id);
            console.log(`  · ${s ? s.login : '?'} in Guild ${z.guild_id}`);
        }
    }

    await c.end();
    console.log(abweichungen === 0
        ? `\nErgebnis: ${faelle} Pruefungen, 0 Abweichungen.\n`
        : `\nErgebnis: ${faelle} Pruefungen, ${abweichungen} Abweichung(en).\n`);
    process.exit(abweichungen === 0 ? 0 : 1);
})().catch(e => { console.log('\nAbgebrochen:', e.message, '\n'); process.exit(1); });
