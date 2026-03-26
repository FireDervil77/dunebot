#!/usr/bin/env node
/**
 * Einmaliges Patch-Script: RCON-Config für Palworld (ID 171) in game_data einfügen.
 * 
 * Nutzt Valve Source RCON Protokoll (srcds) mit:
 *   - port_var: RCON_PORT (ENV-Variable, nicht Port-Allokation)
 *   - password_var: ADMIN_PASSWORD (Palworld nutzt AdminPassword als RCON-Passwort)
 */

require('dotenv').config({ path: require('path').join(__dirname, '../apps/dashboard/.env') });
const mysql = require('mysql2/promise');

const PALWORLD_ADDON_ID = 171;

const RCON_CONFIG = {
    protocol: 'srcds',
    port_var: 'RCON_PORT',
    password_var: 'ADMIN_PASSWORD'
};

async function main() {
    const conn = await mysql.createConnection({
        host: process.env.MYSQL_HOST || 'localhost',
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE
    });

    try {
        // 1. addon_marketplace.game_data patchen
        const [rows] = await conn.execute(
            'SELECT game_data FROM addon_marketplace WHERE id = ?',
            [PALWORLD_ADDON_ID]
        );

        if (rows.length === 0) {
            console.error('❌ Palworld Addon (ID ' + PALWORLD_ADDON_ID + ') nicht gefunden');
            return;
        }

        const gd = typeof rows[0].game_data === 'string'
            ? JSON.parse(rows[0].game_data)
            : rows[0].game_data;

        // config bereinigen (kann als String gespeichert sein)
        if (!gd.config || typeof gd.config === 'string') {
            gd.config = {};
        }
        if (typeof gd.config.files === 'string') {
            gd.config.files = JSON.parse(gd.config.files || '{}');
        }
        if (typeof gd.config.logs === 'string') {
            gd.config.logs = JSON.parse(gd.config.logs || '{}');
        }

        gd.config.rcon = RCON_CONFIG;

        await conn.execute(
            'UPDATE addon_marketplace SET game_data = ? WHERE id = ?',
            [JSON.stringify(gd), PALWORLD_ADDON_ID]
        );
        console.log('✅ addon_marketplace.game_data für Palworld (ID ' + PALWORLD_ADDON_ID + ') gepatcht');
        console.log('   config.rcon:', JSON.stringify(RCON_CONFIG));

        // 2. frozen_game_data aller Palworld-Server patchen
        const [servers] = await conn.execute(
            'SELECT id, frozen_game_data FROM gameservers WHERE addon_marketplace_id = ?',
            [PALWORLD_ADDON_ID]
        );

        for (const srv of servers) {
            if (!srv.frozen_game_data) continue;

            const fd = typeof srv.frozen_game_data === 'string'
                ? JSON.parse(srv.frozen_game_data)
                : srv.frozen_game_data;

            if (!fd.config || typeof fd.config === 'string') {
                fd.config = {};
            }
            if (typeof fd.config.files === 'string') {
                fd.config.files = JSON.parse(fd.config.files || '{}');
            }
            if (typeof fd.config.logs === 'string') {
                fd.config.logs = JSON.parse(fd.config.logs || '{}');
            }

            fd.config.rcon = RCON_CONFIG;

            await conn.execute(
                'UPDATE gameservers SET frozen_game_data = ? WHERE id = ?',
                [JSON.stringify(fd), srv.id]
            );
            console.log('✅ frozen_game_data für Server ' + srv.id + ' gepatcht');
        }

        if (servers.length === 0) {
            console.log('ℹ️  Keine Palworld-Server-Instanzen gefunden (nur Addon gepatcht)');
        }

        console.log('\n🎮 RCON-Tab sollte jetzt im Dashboard für Palworld sichtbar sein.');
        console.log('   Palworld RCON nutzt: Port=${RCON_PORT}, Passwort=${ADMIN_PASSWORD}');

    } finally {
        await conn.end();
    }
}

main().catch(e => {
    console.error('❌ Fehler:', e.message);
    process.exit(1);
});
