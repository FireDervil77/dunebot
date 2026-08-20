#!/usr/bin/env node
/**
 * Prüft die Kette Absicht → Messung → Fähigkeit an der echten Datenbank.
 *
 * Warum ein Skript und kein Test: Die Kette läuft über vier Stellen, die je für
 * sich unauffällig aussehen — Formular, Modell, Maschinenbefund, Adressfunktion.
 * Ein Fehler darin stürzt nicht ab, er zeigt still das Falsche. Genau die Sorte
 * Fehler, die uns am 2026-08-19 eine Adresse auf den Webhost hat ausgeben
 * lassen.
 *
 * Das Skript legt einen Prüf-RootServer an, fährt den Befund darüber und räumt
 * ihn wieder weg. Es verändert nichts an vorhandenen Zeilen.
 *
 *   node scripts/check-maschinenidentitaet.js
 */
'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../apps/dashboard/.env') });
const mysql = require('mysql2/promise');
const ServiceManager = require('../packages/dunebot-core/lib/ServiceManager');

const PRUEF_GUILD = '000000000000000000';

let fehler = 0;
function pruefe(bedingung, was, zusatz = '') {
    const zeichen = bedingung ? '✅' : '❌';
    if (!bedingung) fehler++;
    console.log(`  ${zeichen} ${was}${zusatz ? '\n       ' + zusatz : ''}`);
}

(async () => {
    const conn = await mysql.createConnection({
        host: process.env.MYSQL_HOST, port: process.env.MYSQL_PORT,
        user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE,
    });

    // dbService so, wie das Dashboard ihn anbietet: query() liefert die Zeilen
    // direkt, nicht das [rows, fields]-Paar von mysql2.
    ServiceManager.register('dbService', {
        query: async (sql, params) => { const [r] = await conn.query(sql, params); return r; },
        tableExists: async (name) => {
            const [r] = await conn.query('SHOW TABLES LIKE ?', [name]);
            return r.length > 0;
        },
    });
    ServiceManager.register('Logger', {
        info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, success: () => {},
    });

    const RootServer = require('../plugins/masterserver/dashboard/models/RootServer');
    const Serverseite = require('../plugins/gameserver/dashboard/helpers/Serverseite');

    let angelegt = null;
    try {
        console.log('\n▸ 1. Anlegen speichert nur ABSICHT, keine Hardware');
        angelegt = await RootServer.create({
            guildId: PRUEF_GUILD,
            ownerUserId: '000000000000000001',
            name: 'PRUEF-Maschinenidentitaet',
            host: '203.0.113.7',                 // TEST-NET-3, gehört niemandem
            fqdn: 'node1.firenetworks.de',       // löst auf — aber woandershin
            fastdlEnabled: true,
            dbGewuenscht: true,
            dbJeServer: 2,
            cpuCores: null, ramTotalGb: null, diskTotalGb: null,
        });

        const [zeile] = await conn.query(
            `SELECT fqdn, fastdl_enabled, db_gewuenscht, db_je_server,
                    cpu_cores, ram_total_gb, disk_total_gb,
                    fqdn_gilt, fastdl_moeglich, db_moeglich
               FROM rootserver WHERE id = ?`, [angelegt.id]);
        const r = zeile[0];

        pruefe(r.fqdn === 'node1.firenetworks.de', 'Der Wunschname ist gespeichert');
        pruefe(r.fastdl_enabled === 1 && r.db_gewuenscht === 1, 'Beide Wünsche sind gespeichert');
        pruefe(r.db_je_server === 2, 'Die Grenze „Datenbanken je Gameserver" ist gespeichert');
        pruefe(r.cpu_cores === null && r.ram_total_gb === null && r.disk_total_gb === null,
            'Hardware bleibt leer — sie wird gemessen, nicht getippt');
        pruefe(r.fqdn_gilt === 0 && r.fastdl_moeglich === 0 && r.db_moeglich === 0,
            'Kein Häkchen schaltet beim Anlegen etwas frei');

        console.log('\n▸ 2. Der Befund einer Maschine ohne alles');
        await RootServer.uebernimmMaschinenbefund(angelegt.daemonId, {
            virtualisierung: 'kvm',
            webserver: { art: 'keiner', installiert: false, laeuft: false, grund: 'Kein Webserver installiert, Port 80 ist frei.' },
            datenbank: { vorhanden: false, laeuft: false, bekannt: false, grund: 'Kein MySQL/MariaDB auf dieser Maschine.' },
        }, '203.0.113.7');

        const [n1] = await conn.query(
            'SELECT fqdn_gilt, fqdn_grund, fqdn_zeigt_auf, fastdl_moeglich, fastdl_grund, db_moeglich, db_grund, virtualisierung FROM rootserver WHERE id = ?',
            [angelegt.id]);
        const b1 = n1[0];

        pruefe(b1.fqdn_gilt === 0,
            'Der Name gilt NICHT — er zeigt woandershin',
            b1.fqdn_grund);
        pruefe(String(b1.fqdn_zeigt_auf || '') !== '',
            'Wohin er stattdessen zeigt, steht daneben',
            `zeigt auf: ${b1.fqdn_zeigt_auf}`);
        pruefe(b1.fastdl_moeglich === 0, 'FastDL ist nicht möglich', b1.fastdl_grund);
        pruefe(b1.db_moeglich === 0, 'Datenbanken sind nicht möglich', b1.db_grund);
        pruefe(b1.virtualisierung === 'kvm', 'Die Virtualisierung ist festgehalten');

        console.log('\n▸ 3. Dieselbe Maschine, aber mit nginx und laufendem MySQL');
        await RootServer.uebernimmMaschinenbefund(angelegt.daemonId, {
            virtualisierung: 'lxc',
            webserver: { art: 'nginx', installiert: true, laeuft: true, port80_belegt: true, grund: 'nginx läuft' },
            datenbank: { vorhanden: true, laeuft: true, bekannt: false, grund: 'MySQL läuft' },
        }, '203.0.113.7');

        const [n2] = await conn.query(
            'SELECT fastdl_moeglich, fastdl_grund, db_moeglich, db_grund FROM rootserver WHERE id = ?',
            [angelegt.id]);
        pruefe(n2[0].fastdl_moeglich === 1, 'Jetzt ist FastDL möglich', n2[0].fastdl_grund);
        pruefe(n2[0].db_moeglich === 1, 'Jetzt sind Datenbanken möglich', n2[0].db_grund);

        console.log('\n▸ 4. Die Adresse zeigt nie einen ungeprüften Namen (M-1)');
        const ports = JSON.stringify({ game: { external: 25002 } });
        const faelle = [
            ['ungeprüfter Name', { fqdn: 'node1.firenetworks.de', fqdn_gilt: 0, server_ip: '203.0.113.7' }, '203.0.113.7:25002'],
            ['geprüfter Name',   { fqdn: 'node1.firenetworks.de', fqdn_gilt: 1, server_ip: '203.0.113.7' }, 'node1.firenetworks.de:25002'],
            ['bind_ip schlägt alles', { bind_ip: '203.0.113.9', fqdn: 'node1.firenetworks.de', fqdn_gilt: 1, server_ip: '203.0.113.7' }, '203.0.113.9:25002'],
            ['gar kein Name',    { fqdn: null, fqdn_gilt: 0, server_ip: '203.0.113.7' }, '203.0.113.7:25002'],
        ];
        for (const [was, felder, erwartet] of faelle) {
            const liste = Serverseite.baueServerListe(
                [{ id: 1, name: 'x', status: 'online', ports, ...felder }], {});
            const ist = liste.liste[0].adresse ? liste.liste[0].adresse.text : '(keine)';
            pruefe(ist === erwartet, `${was} → ${ist}`, ist === erwartet ? '' : `erwartet war ${erwartet}`);
        }
    } finally {
        if (angelegt) {
            await conn.query('DELETE FROM rootserver_quotas WHERE rootserver_id = ?', [angelegt.id]).catch(() => {});
            await conn.query('DELETE FROM rootserver WHERE id = ?', [angelegt.id]);
            console.log(`\n(Prüfzeile ${angelegt.id} wieder entfernt)`);
        }
        await conn.end();
    }

    console.log(fehler === 0
        ? '\n✅ Kette vollständig: Absicht → Messung → Fähigkeit → Adresse\n'
        : `\n❌ ${fehler} Abweichung(en)\n`);
    process.exit(fehler === 0 ? 0 : 1);
})().catch((e) => { console.error('FEHLER:', e.message); process.exit(1); });
