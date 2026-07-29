#!/usr/bin/env node
/**
 * Setzt die RCON-Konfiguration eines Addons (game_data.config.rcon).
 *
 * Ohne diesen Block weiß das System nicht, welche Variablen Port und Passwort
 * für RCON sind – die Oberfläche meldet dann "RCON-Port: nicht konfiguriert",
 * auch wenn beide Variablen längst gesetzt sind.
 *
 * Patcht das Addon im Marketplace UND die eingefrorenen Kopien der bereits
 * installierten Server (frozen_game_data), damit bestehende Server es sofort
 * sehen – ohne Neuinstallation.
 *
 * Konvention für die *_var-Angaben:
 *   Kleinbuchstaben → Schlüssel in der ports-Spalte  (z.B. "rcon")
 *   GROSSBUCHSTABEN → Name einer ENV-Variable        (z.B. "RCON_PORT")
 *
 * Beispiele:
 *   node scripts/set-addon-rcon.js --addon 204 --port-var RCON_PORT --password-var ADMIN_PASSWORD --dry
 *   node scripts/set-addon-rcon.js --addon palworld --port-var RCON_PORT --password-var ADMIN_PASSWORD
 *   node scripts/set-addon-rcon.js --addon 42 --port-var rcon --password-var RCON_PASSWORD --protocol srcds
 */

require('dotenv').config({ path: require('path').join(__dirname, '../apps/dashboard/.env') });
const mysql = require('mysql2/promise');

/** Vom Daemon unterstützte Protokolle (srcds = Valve Source RCON) */
const KNOWN_PROTOCOLS = ['srcds', 'webrcon', 'telnet'];

function parseArgs(argv) {
    const args = { protocol: 'srcds', dry: false };
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--dry') { args.dry = true; continue; }
        const value = argv[++i];
        switch (a) {
            case '--addon':        args.addon = value; break;
            case '--port-var':     args.portVar = value; break;
            case '--password-var': args.passwordVar = value; break;
            case '--protocol':     args.protocol = value; break;
            default:
                throw new Error(`Unbekannte Option: ${a}`);
        }
    }
    if (!args.addon || !args.portVar || !args.passwordVar) {
        throw new Error('Erforderlich: --addon <id|slug> --port-var <VAR|key> --password-var <VAR>');
    }
    if (!KNOWN_PROTOCOLS.includes(args.protocol)) {
        throw new Error(`--protocol muss eines von ${KNOWN_PROTOCOLS.join(', ')} sein`);
    }
    return args;
}

const parse = v => (typeof v === 'string' ? JSON.parse(v) : v) || {};

async function main() {
    const args = parseArgs(process.argv);
    const rconConfig = {
        protocol:     args.protocol,
        port_var:     args.portVar,
        password_var: args.passwordVar,
    };

    const conn = await mysql.createConnection({
        host:     process.env.MYSQL_HOST || 'localhost',
        user:     process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE,
    });

    try {
        const isNumeric = /^\d+$/.test(args.addon);
        const [addons] = await conn.execute(
            `SELECT id, name, slug, game_data FROM addon_marketplace WHERE ${isNumeric ? 'id = ?' : 'slug = ?'}`,
            [args.addon]
        );

        if (addons.length === 0) {
            console.error(`❌ Addon "${args.addon}" nicht gefunden`);
            process.exitCode = 1;
            return;
        }

        for (const addon of addons) {
            console.log(`\nAddon #${addon.id} — ${addon.name} (${addon.slug})`);
            const gd = parse(addon.game_data);

            // config kann als String oder gar nicht vorhanden sein
            if (!gd.config || typeof gd.config === 'string') gd.config = {};
            const before = gd.config.rcon ? JSON.stringify(gd.config.rcon) : '(keine)';
            gd.config.rcon = rconConfig;

            console.log(`  config.rcon: ${before} → ${JSON.stringify(rconConfig)}${args.dry ? ' [dry-run]' : ''}`);
            if (!args.dry) {
                await conn.execute('UPDATE addon_marketplace SET game_data = ? WHERE id = ?',
                    [JSON.stringify(gd), addon.id]);
            }

            // Eingefrorene Kopien der installierten Server mitziehen
            const [servers] = await conn.execute(
                'SELECT id, name, frozen_game_data, env_variables, ports FROM gameservers WHERE addon_marketplace_id = ?',
                [addon.id]
            );

            for (const server of servers) {
                const fd = parse(server.frozen_game_data);
                if (!fd.config || typeof fd.config === 'string') fd.config = {};
                fd.config.rcon = rconConfig;

                // Direkt prüfen, ob die genannten Variablen am Server auch existieren
                const env   = parse(server.env_variables);
                const ports = parse(server.ports);
                const port = args.portVar === args.portVar.toLowerCase()
                    ? (ports[args.portVar]?.external ?? ports[args.portVar]?.internal ?? null)
                    : (parseInt(env[args.portVar], 10) || null);
                const hasPw = !!(env[args.passwordVar] || '').toString().trim();

                const status = port && hasPw
                    ? `✓ Port ${port}, Passwort gesetzt`
                    : `⚠️  ${!port ? `Port (${args.portVar}) fehlt` : ''}${!port && !hasPw ? ', ' : ''}${!hasPw ? `Passwort (${args.passwordVar}) fehlt` : ''}`;
                console.log(`  Server #${server.id} ${server.name}: ${status}${args.dry ? ' [dry-run]' : ''}`);

                if (!args.dry) {
                    await conn.execute('UPDATE gameservers SET frozen_game_data = ? WHERE id = ?',
                        [JSON.stringify(fd), server.id]);
                }
            }
        }

        console.log(args.dry ? '\nDry-Run – nichts geändert.' : '\nFertig. Die Detailseite zeigt RCON nach dem Neuladen.');
    } finally {
        await conn.end();
    }
}

main().catch(err => {
    console.error('Fehlgeschlagen:', err.message);
    process.exit(1);
});
