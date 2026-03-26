/**
 * Patch: Satisfactory Addon + Server – QUERY_PORT & BEACON_PORT als Docker-Port-Bindings
 * 
 * Problem: QUERY_PORT (15777) und BEACON_PORT (15000) existieren nur als env_variables,
 * aber haben kein Docker-Port-Mapping → Clients können sich nicht verbinden (ConnectionTimeout).
 * 
 * Dieser Patch:
 * 1. Setzt daemon_auto_assign=true für QUERY_PORT & BEACON_PORT im Addon
 * 2. Fügt query + beacon Ports in gameservers.ports für bestehende Satisfactory-Server hinzu
 */
const mysql = require('mysql2/promise');
require('dotenv').config({ path: require('path').join(__dirname, '../apps/dashboard/.env') });

const DB_NAME = process.env.MYSQL_DATABASE || 'dunebot_dev';

(async () => {
    const pool = mysql.createPool({
        host: process.env.MYSQL_HOST || 'localhost',
        user: process.env.MYSQL_USER || 'firedervil',
        password: process.env.MYSQL_PASSWORD,
        database: DB_NAME,
    });
    console.log(`📦 Datenbank: ${DB_NAME}`);

    try {
        // 1. Addon patchen: daemon_auto_assign auf true setzen
        const [addons] = await pool.query("SELECT id, name, game_data FROM addon_marketplace WHERE name LIKE '%atisfact%'");
        for (const addon of addons) {
            const gd = JSON.parse(addon.game_data);
            let changed = false;

            if (Array.isArray(gd.variables)) {
                for (const v of gd.variables) {
                    if ((v.env_variable === 'QUERY_PORT' || v.env_variable === 'BEACON_PORT') && !v.daemon_auto_assign) {
                        v.daemon_auto_assign = true;
                        changed = true;
                        console.log(`  ✅ ${v.env_variable}: daemon_auto_assign → true`);
                    }
                }
            }

            if (changed) {
                await pool.query('UPDATE addon_marketplace SET game_data = ? WHERE id = ?', [JSON.stringify(gd), addon.id]);
                console.log(`✅ Addon "${addon.name}" (ID ${addon.id}) gepatcht`);
            } else {
                console.log(`ℹ️  Addon "${addon.name}" (ID ${addon.id}) — daemon_auto_assign bereits korrekt`);
            }
        }

        // 2. Bestehende Server patchen: query + beacon Ports in ports-Spalte ergänzen
        const [servers] = await pool.query(
            "SELECT id, name, ports, env_variables FROM gameservers WHERE addon_marketplace_id IN (SELECT id FROM addon_marketplace WHERE name LIKE '%atisfact%')"
        );
        for (const server of servers) {
            const ports = JSON.parse(server.ports || '{}');
            const envVars = JSON.parse(server.env_variables || '{}');
            let changed = false;

            // QUERY_PORT → ports.query (braucht eigenes Docker-Port-Mapping!)
            if (!ports.query && envVars.QUERY_PORT) {
                const queryPort = parseInt(envVars.QUERY_PORT, 10);
                if (queryPort > 0) {
                    ports.query = { internal: queryPort, external: queryPort, protocol: 'udp' };
                    changed = true;
                    console.log(`  ✅ Server ${server.id}: ports.query → ${queryPort}`);
                }
            }

            // BEACON_PORT → ports.beacon
            if (!ports.beacon && envVars.BEACON_PORT) {
                const beaconPort = parseInt(envVars.BEACON_PORT, 10);
                if (beaconPort > 0) {
                    ports.beacon = { internal: beaconPort, external: beaconPort, protocol: 'udp' };
                    changed = true;
                    console.log(`  ✅ Server ${server.id}: ports.beacon → ${beaconPort}`);
                }
            }

            if (changed) {
                await pool.query('UPDATE gameservers SET ports = ? WHERE id = ?', [JSON.stringify(ports), server.id]);
                console.log(`✅ Server "${server.name}" (ID ${server.id}) ports gepatcht: ${JSON.stringify(ports)}`);
            } else {
                console.log(`ℹ️  Server "${server.name}" (ID ${server.id}) — ports bereits korrekt`);
            }
        }

        if (servers.length === 0) {
            console.log('ℹ️  Keine Satisfactory-Server gefunden');
        }

        console.log('\n🎮 Fertig! Server muss neu gestartet werden damit die neuen Port-Bindings wirken.');
    } finally {
        await pool.end();
    }
})();
