#!/usr/bin/env node
'use strict';

/**
 * DuneBot Migration CLI
 * 
 * Nutzung:
 *   node migrate.js status                              - Status aller Migrationen
 *   node migrate.js pending                             - Nur ausstehende anzeigen
 *   node migrate.js run                                 - Alle Migrationen ausführen
 *   node migrate.js create kern "beschreibung"          - Neue Kern-Migration erstellen
 *   node migrate.js create plugin <name> "beschreibung" - Neue Plugin-Migration erstellen
 *   node migrate.js rollback kern                       - Letzte Kern-Batch rückgängig
 *   node migrate.js rollback plugin <name>              - Letzte Plugin-Batch rückgängig
 */

const path = require('path');
const fs = require('fs');

// .env aus apps/dashboard laden (dort liegen die DB-Credentials)
require('dotenv').config({ path: path.join(__dirname, 'apps', 'dashboard', '.env') });

const { ServiceManager } = require('./packages/dunebot-core');
const MigrationRunner = require('./packages/dunebot-core/lib/MigrationRunner');
const DBClient = require('./packages/dunebot-db-client/lib/DBClient');

const PROJECT_ROOT = __dirname;
const PLUGINS_DIR = path.join(PROJECT_ROOT, 'plugins');
const KERN_MIGRATIONS_DIR = path.join(PROJECT_ROOT, 'migrations', 'kern');

// Einfacher Logger für CLI — auch im ServiceManager registrieren (DBClient braucht ihn)
const logger = {
    info: (msg) => console.log(`  ${msg}`),
    warn: (msg) => console.log(`  ⚠ ${msg}`),
    error: (msg, ...args) => console.error(`  ✗ ${msg}`, ...args),
    success: (msg) => console.log(`  ✓ ${msg}`),
    debug: () => {}
};
ServiceManager.register('Logger', logger);

async function getDbConnection() {
    const db = new DBClient();
    await db.connect();
    return db;
}

// ─── Commands ─────────────────────────────────────────────

async function cmdStatus(filterPending = false) {
    const db = await getDbConnection();
    try {
        await MigrationRunner.ensureTable(db);

        console.log('\n┌──────────────────────────────────────────────────┐');
        console.log('│          DuneBot Migration Status                │');
        console.log('└──────────────────────────────────────────────────┘\n');

        // Kern-Migrationen
        await showScopeStatus(db, 'kern', 'kern', KERN_MIGRATIONS_DIR, filterPending);

        // Plugin-Migrationen
        if (fs.existsSync(PLUGINS_DIR)) {
            const plugins = fs.readdirSync(PLUGINS_DIR, { withFileTypes: true })
                .filter(d => d.isDirectory())
                .map(d => d.name)
                .sort();

            for (const pluginName of plugins) {
                const migrDir = path.join(PLUGINS_DIR, pluginName, 'migrations');
                if (fs.existsSync(migrDir)) {
                    await showScopeStatus(db, 'plugin', pluginName, migrDir, filterPending);
                }
            }
        }
    } finally {
        await db.close();
    }
}

async function showScopeStatus(db, scope, source, migrationsDir, filterPending) {
    const runner = new MigrationRunner(db, { scope, source, migrationsDir, logger });
    const statuses = await runner.status();

    if (statuses.length === 0) return;

    const filtered = filterPending ? statuses.filter(s => s.status === 'pending') : statuses;
    if (filtered.length === 0) return;

    const label = scope === 'kern' ? '🔧 Kern' : `🔌 ${source}`;
    console.log(`  ${label}`);
    console.log(`  ${'─'.repeat(60)}`);

    for (const s of filtered) {
        let icon, info;
        if (s.status === 'pending') {
            icon = '○';
            info = 'ausstehend';
        } else if (s.status === 'failed') {
            icon = '✗';
            info = 'fehlgeschlagen';
        } else {
            icon = '✓';
            info = s.executed_at ? new Date(s.executed_at).toLocaleString('de-DE') : 'done';
        }

        const checksumWarn = !s.checksum_match ? ' ⚠ GEÄNDERT' : '';
        console.log(`  ${icon} ${s.filename}  ${info}${checksumWarn}`);
    }
    console.log('');
}

async function cmdRun() {
    const db = await getDbConnection();
    try {
        console.log('\n  Führe Migrationen aus...\n');

        // Kern
        const kernResult = await MigrationRunner.runKern(db, logger, PROJECT_ROOT);

        // Alle Plugins
        const pluginResult = await MigrationRunner.runAllPlugins(db, PLUGINS_DIR, logger);

        const total = kernResult.executed + pluginResult.total;
        if (total === 0) {
            console.log('  Keine ausstehenden Migrationen.\n');
        } else {
            console.log(`\n  Fertig: ${total} Migration(en) ausgeführt.\n`);
        }
    } finally {
        await db.close();
    }
}

async function cmdCreate(args) {
    const scope = args[0];

    if (scope === 'kern') {
        const description = args.slice(1).join(' ');
        if (!description) {
            console.error('  Fehler: Beschreibung fehlt. Nutzung: node migrate.js create kern "beschreibung"');
            process.exit(1);
        }
        const filePath = MigrationRunner.createMigrationFile('kern', 'kern', description, PROJECT_ROOT);
        console.log(`\n  ✓ Erstellt: ${path.relative(PROJECT_ROOT, filePath)}\n`);

    } else if (scope === 'plugin') {
        const pluginName = args[1];
        const description = args.slice(2).join(' ');
        if (!pluginName || !description) {
            console.error('  Fehler: Nutzung: node migrate.js create plugin <name> "beschreibung"');
            process.exit(1);
        }
        const filePath = MigrationRunner.createMigrationFile('plugin', pluginName, description, PLUGINS_DIR);
        console.log(`\n  ✓ Erstellt: ${path.relative(PROJECT_ROOT, filePath)}\n`);

    } else {
        console.error('  Fehler: Scope muss "kern" oder "plugin" sein.');
        process.exit(1);
    }
}

async function cmdRollback(args) {
    const scope = args[0];
    const db = await getDbConnection();

    try {
        let runner;
        if (scope === 'kern') {
            runner = new MigrationRunner(db, {
                scope: 'kern', source: 'kern',
                migrationsDir: KERN_MIGRATIONS_DIR, logger
            });
        } else if (scope === 'plugin') {
            const pluginName = args[1];
            if (!pluginName) {
                console.error('  Fehler: Plugin-Name fehlt. Nutzung: node migrate.js rollback plugin <name>');
                process.exit(1);
            }
            runner = new MigrationRunner(db, {
                scope: 'plugin', source: pluginName,
                migrationsDir: path.join(PLUGINS_DIR, pluginName, 'migrations'), logger
            });
        } else {
            console.error('  Fehler: Scope muss "kern" oder "plugin" sein.');
            process.exit(1);
        }

        console.log('\n  Rollback...\n');
        const result = await runner.rollback();
        console.log(`\n  ${result.rolledBack} zurückgerollt, ${result.skipped} übersprungen.\n`);
    } finally {
        await db.close();
    }
}

// ─── Main ─────────────────────────────────────────────────

(async () => {
    const args = process.argv.slice(2);
    const command = args[0];

    try {
        switch (command) {
            case 'status':
                await cmdStatus(false);
                break;
            case 'pending':
                await cmdStatus(true);
                break;
            case 'run':
                await cmdRun();
                break;
            case 'create':
                await cmdCreate(args.slice(1));
                break;
            case 'rollback':
                await cmdRollback(args.slice(1));
                break;
            default:
                console.log(`
  DuneBot Migration CLI

  Befehle:
    status                              Status aller Migrationen
    pending                             Nur ausstehende anzeigen
    run                                 Alle Migrationen ausführen
    create kern "beschreibung"          Neue Kern-Migration
    create plugin <name> "beschreibung" Neue Plugin-Migration
    rollback kern                       Letzte Kern-Batch zurückrollen
    rollback plugin <name>              Letzte Plugin-Batch zurückrollen
`);
        }
    } catch (error) {
        console.error(`\n  Fehler: ${error.message}\n`);
        process.exit(1);
    }

    process.exit(0);
})();
