#!/usr/bin/env node
/**
 * Trägt Ports nach, die ein Addon deklariert, die dem Server aber fehlen.
 *
 * Hintergrund: Bei der Anlage werden nur die Port-Typen allokiert, die das Addon
 * zu diesem Zeitpunkt deklariert hat. Wurde der Block später ergänzt – oder
 * fehlte er ganz, wie lange bei Valheim –, hat der Server dauerhaft zu wenige
 * Ports. Das Ports-Modal bietet nur an, was bereits allokiert ist, kann die
 * Lücke also nicht schließen.
 *
 * Folge in der Praxis: Der Daemon mappt ausschließlich Ports aus der
 * ports-Spalte (docker/container.go → BuildPortMap). Ein Query-Socket, den das
 * Spiel intern längst geöffnet hat, bleibt von außen unerreichbar.
 *
 * Interner und externer Port werden getrennt behandelt: Valheim legt seinen
 * A2S-Socket im Container fest auf Game-Port + 1. Ist diese Nummer auf dem
 * Rootserver schon vergeben, wird außen ein freier Port aus dem Pool
 * davorgehängt – das Mapping übersetzt.
 *
 * Beispiele:
 *   node scripts/allocate-missing-ports.js --server 108 --dry
 *   node scripts/allocate-missing-ports.js --server 108
 */

require('dotenv').config({ path: require('path').join(__dirname, '../apps/dashboard/.env') });
const mysql = require('mysql2/promise');

function parseArgs(argv) {
    const args = { dry: false, server: null };
    for (let i = 2; i < argv.length; i++) {
        switch (argv[i]) {
            case '--dry':    args.dry = true;         break;
            case '--server': args.server = argv[++i]; break;
            default:
                console.error(`Unbekanntes Argument: ${argv[i]}`);
                process.exit(1);
        }
    }
    if (!args.server) {
        console.error('Benötigt: --server <id> [--dry]');
        process.exit(1);
    }
    return args;
}

function parse(value) {
    if (value == null) return {};
    if (typeof value !== 'string') return value;
    try { return JSON.parse(value); } catch (_) { return {}; }
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
        const [[server]] = await conn.query(`
            SELECT gs.id, gs.name, gs.status, gs.rootserver_id, gs.ports,
                   COALESCE(am.game_data, gs.frozen_game_data) AS game_data
            FROM gameservers gs
            LEFT JOIN addon_marketplace am ON gs.addon_marketplace_id = am.id
            WHERE gs.id = ?
        `, [args.server]);

        if (!server) {
            console.error(`Server ${args.server} nicht gefunden`);
            process.exitCode = 1;
            return;
        }

        const ports    = parse(server.ports);
        const declared = parse(server.game_data).ports || {};

        console.log(`Server #${server.id} — ${server.name} (Status: ${server.status})`);
        console.log(`  Deklariert: ${Object.keys(declared).join(', ') || '(nichts)'}`);
        console.log(`  Vorhanden : ${Object.keys(ports).join(', ') || '(nichts)'}`);

        const missing = Object.keys(declared).filter(name => !ports[name]);
        if (!missing.length) {
            console.log('\nNichts nachzutragen.');
            return;
        }

        let added = 0;

        for (const name of missing) {
            // Internen Port bestimmen: "<basis>_plus_<n>" ist an den Basis-Port
            // gebunden, weil das Spiel ihn selbst so berechnet.
            let internal = null;
            const plus = /^(.+)_plus_(\d+)$/.exec(name);
            if (plus && ports[plus[1]]) {
                const base = ports[plus[1]].internal ?? ports[plus[1]].external;
                if (base) internal = base + parseInt(plus[2], 10);
            }

            // Freien Port aus dem Pool des Rootservers holen
            const [[free]] = await conn.query(`
                SELECT id, port FROM port_allocations
                WHERE rootserver_id = ? AND server_id IS NULL
                ORDER BY port ASC LIMIT 1
            `, [server.rootserver_id]);

            if (!free) {
                console.log(`  ✗ ${name}: kein freier Port im Pool von Rootserver ${server.rootserver_id}`);
                continue;
            }

            if (internal === null) internal = free.port;

            const protocol = declared[name].protocol || 'udp';
            ports[name] = { internal, external: free.port, protocol };

            const hint = internal === free.port ? '' : `  (Container hört auf ${internal})`;
            console.log(`  + ${name}: extern ${free.port}/${protocol} → intern ${internal}${hint}${args.dry ? ' [dry-run]' : ''}`);

            if (!args.dry) {
                await conn.execute(
                    'UPDATE port_allocations SET server_id = ?, assigned_at = NOW() WHERE id = ?',
                    [server.id, free.id]
                );
            }
            added++;
        }

        if (added && !args.dry) {
            await conn.execute(
                'UPDATE gameservers SET ports = ?, updated_at = NOW() WHERE id = ?',
                [JSON.stringify(ports), server.id]
            );
        }

        console.log(args.dry
            ? `\n${added} Port(s) würden nachgetragen – Dry-Run, nichts geändert.`
            : `\n${added} Port(s) nachgetragen. Der Server muss neu gestartet werden – das Mapping entsteht erst beim Erzeugen des Containers.`);
    } finally {
        await conn.end();
    }
}

main().catch(err => {
    console.error('Fehlgeschlagen:', err.message);
    process.exit(1);
});
