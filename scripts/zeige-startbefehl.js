#!/usr/bin/env node
/**
 * Zeigt, welche Kommandozeile ein Gameserver beim Start wirklich bekommt.
 *
 * Nur lesend. Baut dasselbe Payload wie der echte Startweg (`StartPayload.js`)
 * und legt es offen — samt der Frage, die man sonst erst im Containerlog
 * beantwortet bekommt: **Ist jeder Platzhalter ersetzt worden?**
 *
 * Ein nicht ersetzter Platzhalter geht still durch. Er landet woertlich auf der
 * Kommandozeile (`-port={{SERVER_PORT}}`), der Prozess startet trotzdem, und
 * das Spiel oeffnet dann eben keinen oder den falschen Port. Genau so ist es
 * ueber `/server start` schon einmal passiert, weil der IPC-Pfad eine eigene
 * Kopie der Ersetzung hatte — siehe `scripts/check-startpayload.js`, das die
 * Ersetzung ohne Datenbank prueft. Dieses Skript hier macht die Gegenprobe am
 * echten Datensatz.
 *
 *   node scripts/zeige-startbefehl.js 160
 */

'use strict';

require('dotenv').config({ path: __dirname + '/../apps/dashboard/.env' });
const mysql = require('mysql2/promise');
const { ServiceManager } = require('dunebot-core');

if (!ServiceManager.has('Logger')) {
    const still = () => {};
    ServiceManager.register('Logger', {
        debug: still, info: still, warn: still, error: still, success: still,
    });
}

const { buildStartPayload, loadServerForStart } =
    require('../plugins/gameserver/dashboard/helpers/StartPayload');

const serverId = parseInt(process.argv[2], 10);
if (!serverId) {
    console.error('Aufruf: node scripts/zeige-startbefehl.js <server-id>');
    process.exit(1);
}

(async () => {
    const c = await mysql.createConnection({
        host: process.env.MYSQL_HOST,
        port: process.env.MYSQL_PORT,
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE,
    });
    const dbService = { query: async (sql, p) => (await c.query(sql, p))[0] };

    const server = await loadServerForStart(dbService, serverId);
    if (!server) {
        console.error(`Server ${serverId} nicht gefunden`);
        await c.end();
        process.exit(1);
    }

    const Logger = ServiceManager.get('Logger');
    const { payload, error, startupCommand, ports, envVariables } =
        buildStartPayload(server, server.guild_id, Logger);

    if (error) {
        console.log('✗ Payload liesse sich nicht bauen:', error);
        await c.end();
        process.exit(1);
    }

    const cmd = payload.startup_command || startupCommand || '';

    console.log(`=== Server ${serverId} — ${server.name} ===\n`);
    console.log('Startbefehl:');
    console.log(cmd + '\n');

    const offen = cmd.match(/\{\{[^}]+\}\}/g);
    console.log('Unersetzte Platzhalter:', offen ? '✗ ' + [...new Set(offen)].join(', ') : '✓ keine');

    console.log('\nPorts:');
    for (const [name, p] of Object.entries(ports || {})) {
        console.log(`   ${name.padEnd(14)} ${p.internal}  ${p.protocol || ''}`);
    }
    const nummern = Object.values(ports || {}).map(p => p.internal);
    console.log('   Kollision:', nummern.length !== new Set(nummern).size ? '✗ JA' : '✓ keine');

    console.log('\nPortrelevante Umgebung:');
    const umgebung = envVariables || payload.environment || {};
    for (const k of Object.keys(umgebung).filter(k => /PORT/i.test(k)).sort()) {
        console.log(`   ${k.padEnd(14)} ${umgebung[k]}`);
    }

    await c.end();
})().catch(err => { console.error('FEHLER:', err.message); process.exit(1); });
