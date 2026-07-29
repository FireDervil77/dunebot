#!/usr/bin/env node
/**
 * Einmaliges Patch-Script: Rust-Addons von RCON-Protokoll "srcds" auf "webrcon" setzen.
 *
 * Rust startet laut Startup-Command mit `+rcon.web 1` und spricht damit
 * WebSocket-RCON, nicht Valve Source RCON über TCP. Die Angabe "srcds" führte
 * dazu, dass RCON in der Oberfläche als verfügbar galt und jeder Befehl in einen
 * Verbindungsfehler lief.
 *
 * Nach dem Patch meldet die Oberfläche ehrlich "Protokoll wird noch nicht
 * unterstützt" – der webrcon-Treiber kommt in einer späteren Etappe.
 *
 * Aufruf: node scripts/patch-rust-webrcon.js [--dry]
 */

require('dotenv').config({ path: require('path').join(__dirname, '../apps/dashboard/.env') });
const mysql = require('mysql2/promise');

const DRY_RUN = process.argv.includes('--dry');

async function main() {
    const conn = await mysql.createConnection({
        host:     process.env.MYSQL_HOST || 'localhost',
        user:     process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE,
    });

    try {
        const [addons] = await conn.execute(
            "SELECT id, name, slug, game_data FROM addon_marketplace WHERE slug LIKE '%rust%'"
        );

        if (addons.length === 0) {
            console.log('Keine Rust-Addons gefunden.');
            return;
        }

        for (const addon of addons) {
            const gd = typeof addon.game_data === 'string' ? JSON.parse(addon.game_data) : addon.game_data;
            const rcon = gd?.config?.rcon;

            if (!rcon) {
                console.log(`- ${addon.name} (#${addon.id}): kein config.rcon – übersprungen`);
                continue;
            }
            if (rcon.protocol === 'webrcon') {
                console.log(`- ${addon.name} (#${addon.id}): bereits webrcon`);
                continue;
            }

            console.log(`- ${addon.name} (#${addon.id}): ${rcon.protocol || '(leer)'} → webrcon${DRY_RUN ? ' [dry-run]' : ''}`);
            if (DRY_RUN) continue;

            rcon.protocol = 'webrcon';
            await conn.execute('UPDATE addon_marketplace SET game_data = ? WHERE id = ?', [JSON.stringify(gd), addon.id]);
        }

        // Eingefrorene Kopien der bereits installierten Server mitziehen
        const [servers] = await conn.execute(`
            SELECT gs.id, gs.frozen_game_data
            FROM gameservers gs
            JOIN addon_marketplace am ON gs.addon_marketplace_id = am.id
            WHERE am.slug LIKE '%rust%'
        `);

        for (const server of servers) {
            const fd = typeof server.frozen_game_data === 'string'
                ? JSON.parse(server.frozen_game_data) : server.frozen_game_data;
            if (!fd?.config?.rcon || fd.config.rcon.protocol === 'webrcon') continue;

            console.log(`- Server #${server.id}: frozen_game_data → webrcon${DRY_RUN ? ' [dry-run]' : ''}`);
            if (DRY_RUN) continue;

            fd.config.rcon.protocol = 'webrcon';
            await conn.execute('UPDATE gameservers SET frozen_game_data = ? WHERE id = ?', [JSON.stringify(fd), server.id]);
        }

        console.log('Fertig.');
    } finally {
        await conn.end();
    }
}

main().catch(err => {
    console.error('Patch fehlgeschlagen:', err.message);
    process.exit(1);
});
