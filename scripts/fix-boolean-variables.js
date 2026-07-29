#!/usr/bin/env node
/**
 * Repariert Boolean-Variablen, die in der falschen Schreibweise gespeichert sind.
 *
 * Ursache: Das Variablen-Formular rendert `field_type: "boolean"` als Auswahl und
 * schrieb dabei fest `true`/`false`. Eggs stammen aber aus der Pterodactyl-Welt
 * und rechnen im Startbefehl mit Zahlen:
 *
 *     -public {{PUBLIC_SERVER}}                      → "-public true"  statt "-public 1"
 *     $( [[ {{ENABLE_CROSSPLAY}} -eq 1 ]] && … )     → "[[ true -eq 1 ]]" ist FALSCH
 *
 * Der zweite Fall ist der tückische: Bash wertet nicht-numerische Strings in
 * arithmetischen Vergleichen als 0, deshalb ist sowohl "true" als auch "false"
 * ungleich 1 – der Schalter liess sich nie wieder einschalten.
 *
 * Die richtige Schreibweise steht im Addon: `default_value`. Ist der Default "1"
 * oder "0", gehören Zahlen hinein; ist er "true"/"false", eben Worte.
 *
 * Beispiele:
 *   node scripts/fix-boolean-variables.js --dry
 *   node scripts/fix-boolean-variables.js --server 108
 *   node scripts/fix-boolean-variables.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../apps/dashboard/.env') });
const mysql = require('mysql2/promise');

const TRUTHY = ['1', 'true', 'yes', 'on'];
const FALSY  = ['0', 'false', 'no', 'off'];

function parseArgs(argv) {
    const args = { dry: false, server: null };
    for (let i = 2; i < argv.length; i++) {
        switch (argv[i]) {
            case '--dry':    args.dry = true;            break;
            case '--server': args.server = argv[++i];    break;
            default:
                console.error(`Unbekanntes Argument: ${argv[i]}`);
                process.exit(1);
        }
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
        const [rows] = await conn.query(`
            SELECT gs.id, gs.name, gs.env_variables,
                   COALESCE(am.game_data, gs.frozen_game_data) AS game_data
            FROM gameservers gs
            LEFT JOIN addon_marketplace am ON gs.addon_marketplace_id = am.id
            ${args.server ? 'WHERE gs.id = ?' : ''}
        `, args.server ? [args.server] : []);

        let changedTotal = 0;

        for (const row of rows) {
            const envVars  = parse(row.env_variables);
            const gameData = parse(row.game_data);
            const booleans = (gameData.variables || [])
                .filter(v => String(v.field_type || '').toLowerCase() === 'boolean');

            const changes = [];

            for (const variable of booleans) {
                const key = variable.env_variable;
                if (!key || envVars[key] === undefined) continue;

                const current = String(envVars[key]).trim().toLowerCase();
                const isOn    = TRUTHY.includes(current);
                if (!isOn && !FALSY.includes(current)) continue; // z.B. "2" – nicht anfassen

                const def       = String(variable.default_value ?? '').trim().toLowerCase();
                const usesWords = def === 'true' || def === 'false';
                const wanted    = usesWords ? (isOn ? 'true' : 'false') : (isOn ? '1' : '0');

                if (String(envVars[key]) !== wanted) {
                    changes.push(`${key}: ${JSON.stringify(envVars[key])} → ${JSON.stringify(wanted)}`);
                    envVars[key] = wanted;
                }
            }

            if (!changes.length) continue;

            console.log(`\nServer #${row.id} — ${row.name}`);
            for (const change of changes) console.log(`  ${change}`);
            changedTotal += changes.length;

            if (!args.dry) {
                await conn.execute(
                    'UPDATE gameservers SET env_variables = ?, updated_at = NOW() WHERE id = ?',
                    [JSON.stringify(envVars), row.id]
                );
            }
        }

        if (!changedTotal) {
            console.log('Nichts zu tun – alle Boolean-Variablen passen zum Addon-Default.');
        } else {
            console.log(args.dry
                ? `\n${changedTotal} Variable(n) betroffen – Dry-Run, nichts geändert.`
                : `\n${changedTotal} Variable(n) korrigiert. Die Server müssen neu gestartet werden, damit der Startbefehl neu gebaut wird.`);
        }
    } finally {
        await conn.end();
    }
}

main().catch(err => {
    console.error('Fehlgeschlagen:', err.message);
    process.exit(1);
});
