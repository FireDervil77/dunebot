#!/usr/bin/env node
/**
 * Setzt die Query-Konfiguration eines Addons (game_data.query).
 *
 * Ohne diesen Block gibt es für ein Spiel überhaupt keine Live-Abfrage – die
 * Detailseite zeigt dann dauerhaft "–", ohne dass ein Fehler erkennbar wäre.
 * Genau das war bei Valheim und Windrose der Fall.
 *
 * Patcht das Addon im Marketplace UND die eingefrorenen Kopien der bereits
 * installierten Server (frozen_game_data), damit bestehende Server es sofort
 * sehen – ohne Neuinstallation. Schwestersktipt zu set-addon-rcon.js.
 *
 * Konvention für port_var:
 *   Kleinbuchstaben        → Schlüssel in der ports-Spalte     (z.B. "query")
 *   "<name>_plus_<n>"      → ports[name] + n                   (z.B. "game_plus_1")
 *   GROSSBUCHSTABEN        → Name einer ENV-Variable           (z.B. "QUERY_PORT")
 *
 * Beispiele:
 *   node scripts/set-addon-query.js --addon valheim --type valheim --port-var game_plus_1 --dry
 *   node scripts/set-addon-query.js --addon 203 --type protocol-valve --port-var query
 */

require('dotenv').config({ path: require('path').join(__dirname, '../apps/dashboard/.env') });
const mysql = require('mysql2/promise');

function parseArgs(argv) {
    const args = { dry: false };
    for (let i = 2; i < argv.length; i++) {
        switch (argv[i]) {
            case '--addon':    args.addon   = argv[++i]; break;
            case '--type':     args.type    = argv[++i]; break;
            case '--port-var': args.portVar = argv[++i]; break;
            case '--dry':      args.dry     = true;      break;
            default:
                console.error(`Unbekanntes Argument: ${argv[i]}`);
                process.exit(1);
        }
    }
    if (!args.addon || !args.type) {
        console.error('Benötigt: --addon <id|slug> --type <gamedig_type> [--port-var <var>] [--dry]');
        process.exit(1);
    }
    args.portVar = args.portVar || 'game';
    return args;
}

function parse(value) {
    if (value == null) return {};
    if (typeof value !== 'string') return value;
    try { return JSON.parse(value); } catch (_) { return {}; }
}

/** Löst einen port_var gegen die ports-/env-Spalten eines Servers auf. */
function resolvePort(portVar, ports, env) {
    if (portVar !== portVar.toLowerCase()) {
        return parseInt(env[portVar], 10) || null;
    }

    const direct = ports[portVar];
    if (direct) return direct.external ?? direct.internal ?? null;

    // "_plus_N"-Notation wie im QueryService
    const plus = portVar.match(/^(.+)_plus_(\d+)$/);
    if (plus) {
        const base = ports[plus[1]];
        const basePort = base?.external ?? base?.internal ?? null;
        if (basePort) return basePort + parseInt(plus[2], 10);
    }
    return null;
}

async function main() {
    const args = parseArgs(process.argv);
    const queryConfig = { gamedig_type: args.type, port_var: args.portVar };

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

            const before = gd.query ? JSON.stringify(gd.query) : '(keine)';
            gd.query = queryConfig;

            console.log(`  query: ${before} → ${JSON.stringify(queryConfig)}${args.dry ? ' [dry-run]' : ''}`);
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
                fd.query = queryConfig;

                // Direkt prüfen, ob der genannte Port am Server auflösbar ist –
                // sonst bleibt die Abfrage stumm und niemand weiß warum.
                const port = resolvePort(args.portVar, parse(server.ports), parse(server.env_variables));
                const status = port
                    ? `✓ Query-Port ${port}`
                    : `⚠️  Port (${args.portVar}) nicht auflösbar`;
                console.log(`  Server #${server.id} ${server.name}: ${status}${args.dry ? ' [dry-run]' : ''}`);

                if (!args.dry) {
                    await conn.execute('UPDATE gameservers SET frozen_game_data = ? WHERE id = ?',
                        [JSON.stringify(fd), server.id]);
                }
            }
        }

        console.log(args.dry
            ? '\nDry-Run – nichts geändert.'
            : '\nFertig. Der Status-Poller nutzt die Abfrage ab dem nächsten Durchgang.');
    } finally {
        await conn.end();
    }
}

main().catch(err => {
    console.error('Fehlgeschlagen:', err.message);
    process.exit(1);
});
