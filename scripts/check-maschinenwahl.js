#!/usr/bin/env node
/**
 * Prüft die Maschinenwahl beim Anlegen gegen den ECHTEN Portvorrat.
 *
 * Baustelle 62a: Diese Auswahl lieferte monatelang eine leere Liste, aus zwei
 * unabhängigen Gründen — eine Abfrage auf eine Spalte, die es nicht gibt
 * (`port_allocations.guild_id`), und eine Rechnung über `port_range_start/end`,
 * zwei Spalten, die im ganzen Baum nur gelesen und nie geschrieben werden.
 *
 * Beides fiel nicht auf, weil der Fehler in einem try/catch landete und die
 * Seite dazu nichts sagte. Genau darum steht der Test hier und nicht nur im
 * Kopf: Eine leere Liste sieht aus wie ein Ergebnis.
 *
 *   node scripts/check-maschinenwahl.js
 */
'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../apps/dashboard/.env') });
const mysql = require('mysql2/promise');
const { baueMaschinenAuswahl } = require('../plugins/gameserver/dashboard/helpers/Serverseite');

let fehler = 0;
function pruefe(ok, was, zusatz = '') {
    console.log(`  ${ok ? '✅' : '❌'} ${was}${zusatz ? '\n       ' + zusatz : ''}`);
    if (!ok) fehler++;
}

(async () => {
    const c = await mysql.createConnection({
        host: process.env.MYSQL_HOST, port: process.env.MYSQL_PORT,
        user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE,
    });

    const [maschinen] = await c.query(
        `SELECT id, name, hostname, host, daemon_status, cpu_cores, ram_total_gb, disk_total_gb
           FROM rootserver WHERE install_status = 'completed'`);
    const [vorrat] = await c.query(
        'SELECT rootserver_id, port, server_id FROM port_allocations');
    const [pv] = await c.query('SELECT fbpkg FROM package_versions LIMIT 1');
    const paket = typeof pv[0].fbpkg === 'string' ? JSON.parse(pv[0].fbpkg) : pv[0].fbpkg;

    console.log(`\n▸ Echte Lage: ${maschinen.length} Maschinen, ${vorrat.length} Portzeilen, Paket ${paket.identity.slug}`);

    const aus = baueMaschinenAuswahl(maschinen, {}, vorrat, paket);

    console.log('\n▸ 1. Die Liste ist nicht mehr leer');
    pruefe(aus.length === maschinen.length,
        `Alle ${maschinen.length} Maschinen erscheinen`, `geliefert: ${aus.length}`);

    for (const m of aus) {
        console.log(`\n▸ Maschine #${m.id} ${m.name} — Vorrat ${m.vorrat.frei}/${m.vorrat.alle} frei`);
        if (m.vorrat.alle === 0) {
            pruefe(m.paar === null && /kein Portvorrat angelegt/.test(m.grund || ''),
                'Ohne Vorrat steht dort, was zu tun ist — nicht nur „nicht möglich"', m.grund);
            pruefe(m.waehlbar === false, 'Und sie ist nicht wählbar');
        } else {
            pruefe(m.paar !== null, 'Ein freies Portpaar wurde gefunden',
                m.paar ? `Spiel ${m.paar.spiel}, ${m.paar.weitere.map(w => w.zweck + ' ' + w.port).join(', ')}` : m.grund);
            if (m.paar) {
                pruefe(m.paar.weitere.every(w => w.port === m.paar.spiel + 1),
                    'Der Abfrageport ist Spielport+1, wie das Paket es verlangt');
            }
        }
    }

    // ── Die Fälle, die am echten Bestand nicht vorkommen ─────────────────────
    console.log('\n▸ 2. Der Nachbarport ist vergeben → Ablehnung mit Grund');
    const eine = [maschinen.find(m => vorrat.some(v => v.rootserver_id === m.id))].filter(Boolean);
    if (eine.length) {
        const id = eine[0].id;
        // Nur zwei Ports im Vorrat, der zweite vergeben.
        const eng = [
            { rootserver_id: id, port: 30000, server_id: null },
            { rootserver_id: id, port: 30001, server_id: 7 },
        ];
        const r = baueMaschinenAuswahl(eine, {}, eng, paket)[0];
        pruefe(r.paar === null, 'Kein Paar, obwohl 30000 frei wäre', r.grund);
        pruefe(/Spielport\+1/.test(r.grund || ''), 'Der Grund nennt die Kopplung');

        console.log('\n▸ 3. Der Nachbarport steht gar nicht im Vorrat → ebenfalls Ablehnung');
        const luecke = [{ rootserver_id: id, port: 30000, server_id: null }];
        const r2 = baueMaschinenAuswahl(eine, {}, luecke, paket)[0];
        pruefe(r2.paar === null,
            'Ein Port, den niemand eingetragen hat, ist keine Erlaubnis', r2.grund);

        console.log('\n▸ 4. Vorhersagbare Vergabe: der niedrigste freie Port gewinnt');
        const gemischt = [
            { rootserver_id: id, port: 30010, server_id: null },
            { rootserver_id: id, port: 30011, server_id: null },
            { rootserver_id: id, port: 30000, server_id: null },
            { rootserver_id: id, port: 30001, server_id: null },
        ];
        const r3 = baueMaschinenAuswahl(eine, {}, gemischt, paket)[0];
        pruefe(r3.paar && r3.paar.spiel === 30000,
            'Es wird 30000 gewählt, nicht die Reihenfolge der Datenbankzeilen',
            r3.paar ? `gewählt: ${r3.paar.spiel}` : r3.grund);
    }

    await c.end();
    console.log(fehler === 0 ? '\n✅ Maschinenwahl rechnet gegen den echten Vorrat\n'
                             : `\n❌ ${fehler} Abweichung(en)\n`);
    process.exit(fehler === 0 ? 0 : 1);
})().catch((e) => { console.error('FEHLER:', e.message); process.exit(1); });
