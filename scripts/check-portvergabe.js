#!/usr/bin/env node
/**
 * Prüft die Portvergabe nach dem Paket gegen den echten Vorrat.
 *
 * Der Fehler, den das absichert (gemessen an Server 161 und 162): Gebucht
 * wurden `game 25000` UND `query 25002`, benutzt wurde aber `25001`. Das Buch
 * stimmte nicht mit der Wirklichkeit überein — und weil der Server trotzdem
 * startete, fiel es niemandem auf. Genau darum steht der Test hier.
 *
 *   node scripts/check-portvergabe.js
 */
'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../apps/dashboard/.env') });
const mysql = require('mysql2/promise');
const { vergibPortsAusPaket, lesePortzwecke } = require('../plugins/gameserver/dashboard/helpers/Portvergabe');

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
    const db = { query: async (sql, p) => { const [r] = await c.query(sql, p); return r; } };

    const [pv] = await c.query('SELECT fbpkg FROM package_versions LIMIT 1');
    const paket = typeof pv[0].fbpkg === 'string' ? JSON.parse(pv[0].fbpkg) : pv[0].fbpkg;
    const [rs] = await c.query(
        `SELECT r.id FROM rootserver r
          WHERE EXISTS (SELECT 1 FROM port_allocations p
                         WHERE p.rootserver_id = r.id AND p.server_id IS NULL) LIMIT 1`);
    if (!rs.length) { console.log('Keine Maschine mit freiem Vorrat — Prüfung nicht möglich.'); process.exit(1); }
    const maschine = rs[0].id;

    const { basis, gekoppelt } = lesePortzwecke(paket);
    console.log(`\n▸ Paket ${paket.identity.slug}: Basis "${basis.purpose}", gekoppelt: `
        + (gekoppelt.map(k => `${k.zweck}=+${k.abstand}`).join(', ') || '(keine)'));
    console.log(`▸ Maschine #${maschine}`);

    const zurueck = [];
    const buchungenLoesen = async () => {
        for (const id of zurueck) {
            await c.query('UPDATE port_allocations SET server_id = NULL, assigned_at = NULL WHERE id = ?', [id]);
        }
        zurueck.length = 0;
    };

    try {
        console.log('\n▸ 1. Automatische Vergabe');
        const a = await vergibPortsAusPaket(db, maschine, paket, null);
        Object.values(a.belegt).forEach(x => zurueck.push(x.allocId));

        const spiel = a.ports[basis.purpose].internal;
        console.log('   vergeben:', Object.entries(a.ports).map(([z, d]) => `${z} ${d.internal}`).join(', '));

        for (const k of gekoppelt) {
            pruefe(a.ports[k.zweck] && a.ports[k.zweck].internal === spiel + k.abstand,
                `${k.zweck} liegt bei ${basis.purpose}+${k.abstand}`,
                a.ports[k.zweck] ? `${k.zweck} = ${a.ports[k.zweck].internal}, erwartet ${spiel + k.abstand}` : 'fehlt ganz');
        }
        pruefe(!('game_plus_1' in a.ports), 'Kein Egg-Schlüssel game_plus_1 mehr in den Ports',
            Object.keys(a.ports).join(', '));
        pruefe(Object.keys(a.belegt).length === 1 + gekoppelt.length,
            `Genau ${1 + gekoppelt.length} Ports gebucht — jeder benutzte, keiner mehr`,
            `gebucht: ${Object.values(a.belegt).map(x => x.port).join(', ')}`);

        const [inDB] = await c.query(
            'SELECT port FROM port_allocations WHERE id IN (?) AND server_id = 0', [zurueck]);
        pruefe(inDB.length === zurueck.length, 'Die Buchung steht auch wirklich in der Datenbank');

        console.log('\n▸ 2. Der Nachbarport ist weg → Ablehnung mit Grund');
        // Den Nachbarn des naechsten freien Ports belegen.
        const [nf] = await c.query(
            `SELECT port FROM port_allocations WHERE rootserver_id = ? AND server_id IS NULL
              ORDER BY port ASC LIMIT 1`, [maschine]);
        const kandidat = Number(nf[0].port);
        const nachbar = kandidat + (gekoppelt[0] ? gekoppelt[0].abstand : 1);
        await c.query('UPDATE port_allocations SET server_id = 999 WHERE rootserver_id = ? AND port = ?',
            [maschine, nachbar]);
        try {
            await vergibPortsAusPaket(db, maschine, paket, kandidat);
            pruefe(false, `Wunschport ${kandidat} wurde vergeben, obwohl ${nachbar} belegt ist`);
        } catch (e) {
            pruefe(/nicht frei|Nachbarport/.test(e.message),
                `Wunschport ${kandidat} wird abgelehnt, weil ${nachbar} belegt ist`, e.message);
        }
        await c.query('UPDATE port_allocations SET server_id = NULL WHERE rootserver_id = ? AND port = ?',
            [maschine, nachbar]);

        console.log('\n▸ 3. Maschine ohne Vorrat → sprechender Fehler');
        const [ohne] = await c.query(
            `SELECT id FROM rootserver WHERE NOT EXISTS
             (SELECT 1 FROM port_allocations p WHERE p.rootserver_id = rootserver.id) LIMIT 1`);
        if (ohne.length) {
            try {
                await vergibPortsAusPaket(db, ohne[0].id, paket, null);
                pruefe(false, 'Ohne Vorrat wurde trotzdem etwas vergeben');
            } catch (e) {
                pruefe(/Vorrat/.test(e.message), 'Der Fehler nennt den Vorrat und den Weg dorthin', e.message);
            }
        } else {
            console.log('  (übersprungen — jede Maschine hat einen Vorrat)');
        }
    } finally {
        await buchungenLoesen();
        console.log('\n(Prüfbuchungen wieder freigegeben)');
    }

    const [rest] = await c.query('SELECT COUNT(*) n FROM port_allocations WHERE server_id IS NOT NULL AND server_id NOT IN (SELECT id FROM gameservers)');
    pruefe(Number(rest[0].n) === 0, 'Keine verwaisten Buchungen zurückgelassen', `gefunden: ${rest[0].n}`);

    await c.end();
    // ── Jeder Zweck des Pakets bekommt wirklich einen Port (2026-09-22) ─────────
//
// Befund des Betreibers: Der Minecraft-Server liess sich „wegen eines rcon port
// problems" nicht starten. Gemessen: `lesePortzwecke` nahm mit
// `ports.find(p => p.assign === 'pool')` GENAU EINEN Pool-Port; alles Weitere
// musste die Form `game+N` haben. Minecraft nennt zwei unabhaengige (`game`,
// `rcon`) — der zweite fiel auf den Boden, und der Daemon meldete beim Start
// „fuer diesen Server ist kein solcher Port belegt".
//
// Valheim und Astro Colony haben genau einen Pool-Port plus einen gekoppelten
// und fielen deshalb nie auf. Geprueft wird daher gegen JEDES Handpaket und am
// Ergebnis: Jeder in `ports` genannte Zweck muss nach der Vergabe eine Nummer
// haben.
console.log('\n▸ Jeder Portzweck des Pakets bekommt eine Nummer');
(async () => {
    const fs = require('fs');
    const path = require('path');
    const { portBedarf } = require('../plugins/gameserver/dashboard/helpers/Portvergabe');
    const { baueMaschinenAuswahl } = require('../plugins/gameserver/dashboard/helpers/Serverseite');

    const ordner = path.join(__dirname, '../packages/fbpkg/beispiele');
    const dateien = fs.existsSync(ordner)
        ? fs.readdirSync(ordner).filter(d => d.endsWith('.json')) : [];

    for (const datei of dateien) {
        const paket = JSON.parse(fs.readFileSync(path.join(ordner, datei), 'utf8'));
        const zwecke = (paket.ports || []).map(p => p.purpose);
        if (!zwecke.length) continue;

        // Ein Vorrat, der reicht: der Bedarf plus zwei, damit auch ein
        // gekoppelter Nachbar sicher dabei ist.
        const bedarf = portBedarf(paket);
        const freiePorts = Array.from({ length: bedarf + 2 }, (_, i) => 25000 + i);
        const db = { query: async (sql, p) => (/SELECT id, port FROM port_allocations/.test(sql)
            ? freiePorts.map((n, i) => ({ id: 900 + i, port: n })) : []) };

        let ports = null, fehlgeschlagen = null;
        try { ports = (await vergibPortsAusPaket(db, 54, paket, null)).ports; }
        catch (e) { fehlgeschlagen = e.message; }

        pruefe(ports !== null, `${datei}: die Vergabe gelingt mit ${bedarf + 2} freien Ports`,
            fehlgeschlagen || '');
        if (!ports) continue;

        // Ports mit `needed_by` (Baustelle 156, 2026-09-24) bucht NICHT das
        // Anlegen, sondern der Start, sobald ihre Datei da ist — geprueft in
        // check-zusatzports.js. Hier gilt fuer sie das GEGENTEIL: Bekaemen sie
        // beim Anlegen eine Nummer, haette jeder Minecraft-Server einen
        // Sprachchat-Port, auch ohne Sprachchat-Mod.
        for (const p of (paket.ports || []).filter(x => x.needed_by)) {
            pruefe(!ports[p.purpose], `${datei}: „${p.purpose}" (needed_by) wird beim Anlegen NICHT gebucht`,
                ports[p.purpose] ? `gebucht als ${JSON.stringify(ports[p.purpose])}` : '');
        }
        const nachBedarf = new Set((paket.ports || []).filter(x => x.needed_by).map(x => x.purpose));

        for (const zweck of zwecke.filter(z => !nachBedarf.has(z))) {
            const da = Boolean(ports[zweck] && ports[zweck].internal);
            pruefe(da, `${datei}: „${zweck}" bekommt eine Nummer`,
                da ? '' : 'Das Paket nennt den Zweck, die Vergabe bucht ihn nicht — der Daemon meldet '
                        + 'beim Start „für diesen Server ist kein solcher Port belegt", und in der '
                        + `Konfiguration bleibt {{port:${zweck}}} als Text stehen.`);
        }

        // Und die Maschinenwahl muss dieselbe Zahl verlangen: Eine Maschine mit
        // zu wenig Ports darf nicht als wählbar angeboten werden.
        const maschine = [{ id: 54, name: 'Probe', host: 'h', daemon_status: 'online',
                            cpu_cores: 4, ram_total_gb: 16, disk_total_gb: 200 }];
        const vorrat = (n) => Array.from({ length: n }, (_, i) => (
            { rootserver_id: 54, port: 25000 + i, server_id: null }));
        const knapp = baueMaschinenAuswahl(maschine, {}, vorrat(bedarf - 1), paket)[0];
        const knappOk = Boolean(knapp && knapp.waehlbar === false);
        pruefe(knappOk, `${datei}: mit ${bedarf - 1} freien Ports ist die Maschine NICHT wählbar`,
            knappOk ? '' : 'Die Auswahl böte eine Maschine an, an der das Anlegen scheitert — und '
                         + 'der Betreiber stünde vor einem Widerspruch ohne Erklärung.');
        const reicht = baueMaschinenAuswahl(maschine, {}, vorrat(bedarf + 2), paket)[0];
        pruefe(reicht && reicht.waehlbar === true,
            `${datei}: mit ${bedarf + 2} freien Ports schon`);
    }

    console.log(fehler === 0 ? '\n✅ Portvergabe folgt dem Paket\n' : `\n❌ ${fehler} Abweichung(en)\n`);
    process.exit(fehler === 0 ? 0 : 1);
})().catch((e) => { console.error('FEHLER:', e.message); process.exit(1); });
})();
