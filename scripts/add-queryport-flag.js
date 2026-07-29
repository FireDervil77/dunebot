#!/usr/bin/env node
/**
 * Ergänzt einen fehlenden Query-Port-Parameter im Startup-Command eines Addons.
 *
 * Hintergrund: Der Query-Port wird zwar allokiert und von Docker veröffentlicht,
 * aber wenn der Startup-Command ihn dem Spiel nicht mitteilt, lauscht der Server
 * auf seinem Standardport (Palworld: 27015). Die Live-Abfrage geht dann an einen
 * Port, an dem niemand antwortet – GameDig meldet "Failed all N attempts".
 *
 * Patcht sowohl das Marketplace-Addon (neue Server) als auch launch_params der
 * bereits installierten Server (bestehende Server, wirkt beim nächsten Start).
 *
 * Beispiele:
 *   node scripts/add-queryport-flag.js --addon palworld --flag "-queryport={{QUERY_PORT}}" --dry
 *   node scripts/add-queryport-flag.js --addon 204 --flag "-queryport={{QUERY_PORT}}"
 */

require('dotenv').config({ path: require('path').join(__dirname, '../apps/dashboard/.env') });
const mysql = require('mysql2/promise');

function parseArgs(argv) {
    const args = { dry: false };
    for (let i = 2; i < argv.length; i++) {
        if (argv[i] === '--dry') { args.dry = true; continue; }
        const value = argv[++i];
        if (argv[i - 1] === '--addon') args.addon = value;
        else if (argv[i - 1] === '--flag') args.flag = value;
        else throw new Error(`Unbekannte Option: ${argv[i - 1]}`);
    }
    if (!args.addon || !args.flag) {
        throw new Error('Erforderlich: --addon <id|slug> --flag "-queryport={{QUERY_PORT}}"');
    }
    return args;
}

const parse = v => (typeof v === 'string' ? JSON.parse(v) : v) || {};

/** Hängt das Flag an den Spiel-Aufruf an – vor eventuellen Shell-Anhängseln. */
function withFlag(command, flag) {
    const marker = flag.split('=')[0];           // z.B. "-queryport"
    if (!command || command.includes(marker)) return null;   // schon vorhanden
    return `${command.trimEnd()} ${flag}`;
}

async function main() {
    const args = parseArgs(process.argv);
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
            const patched = withFlag(gd.startup?.command, args.flag);

            if (!patched) {
                console.log(`  Startup-Command: enthält "${args.flag.split('=')[0]}" bereits – unverändert`);
            } else {
                console.log(`  Startup-Command: + ${args.flag}${args.dry ? ' [dry-run]' : ''}`);
                if (!args.dry) {
                    gd.startup.command = patched;
                    await conn.execute('UPDATE addon_marketplace SET game_data = ? WHERE id = ?',
                        [JSON.stringify(gd), addon.id]);
                }
            }

            // Bestehende Server: launch_params und die eingefrorene Kopie mitziehen
            const [servers] = await conn.execute(
                'SELECT id, name, launch_params, frozen_game_data, ports FROM gameservers WHERE addon_marketplace_id = ?',
                [addon.id]
            );

            for (const server of servers) {
                const ports = parse(server.ports);
                const hasQueryPort = !!(ports.query?.external || ports.query?.internal);
                const newParams = withFlag(server.launch_params, args.flag);

                if (!newParams) {
                    console.log(`  Server #${server.id} ${server.name}: bereits gesetzt`);
                    continue;
                }
                if (!hasQueryPort) {
                    console.log(`  Server #${server.id} ${server.name}: ⚠️  kein query-Port allokiert – übersprungen`);
                    continue;
                }

                const fd = parse(server.frozen_game_data);
                const newFrozen = withFlag(fd.startup?.command, args.flag);

                console.log(`  Server #${server.id} ${server.name}: + ${args.flag} (Port ${ports.query.external || ports.query.internal})${args.dry ? ' [dry-run]' : ''}`);
                if (args.dry) continue;

                if (newFrozen) fd.startup.command = newFrozen;
                await conn.execute(
                    'UPDATE gameservers SET launch_params = ?, frozen_game_data = ? WHERE id = ?',
                    [newParams, JSON.stringify(fd), server.id]
                );
            }
        }

        console.log(args.dry
            ? '\nDry-Run – nichts geändert.'
            : '\nFertig. Wirkt beim nächsten Start des Servers.');
    } finally {
        await conn.end();
    }
}

main().catch(err => {
    console.error('Fehlgeschlagen:', err.message);
    process.exit(1);
});
