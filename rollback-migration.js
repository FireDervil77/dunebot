/**
 * Manual Migration Rollback Script
 * Führt down() Methode einer Migration manuell aus
 * 
 * Usage: node rollback-migration.js <plugin> <version> <guildId>
 * Beispiel: node rollback-migration.js core 6.7.0 1403034310172475416
 */

require('dotenv').config({ path: './apps/dashboard/.env' });

const path = require('path');
const pino = require('pino');
const { ServiceManager } = require('./packages/dunebot-core');
const DBService = require('./packages/dunebot-db-client/lib/DBService');

// Simple Logger für Standalone-Script
const logger = pino({
    level: 'debug',
    transport: {
        target: 'pino-pretty',
        options: { colorize: true }
    }
});

async function rollbackMigration(pluginName, version, guildId) {
    console.log('🔄 Manual Migration Rollback');
    console.log(`Plugin: ${pluginName}`);
    console.log(`Version: ${version}`);
    console.log(`Guild: ${guildId || 'GLOBAL'}`);
    console.log('');
    
    try {
        // Logger registrieren (ZUERST!)
        ServiceManager.register('Logger', logger);
        
        // DBService initialisieren
        const dbService = new DBService({
            host: process.env.MYSQL_HOST,
            port: process.env.MYSQL_PORT || 3306,
            user: process.env.MYSQL_USER,
            password: process.env.MYSQL_PASSWORD,
            database: process.env.MYSQL_DATABASE
        });
        await dbService.connect();
        ServiceManager.register('dbService', dbService);
        
        console.log('✅ Database connected');
        
        // 3. Migration-Datei laden
        const migrationPath = path.join(
            __dirname,
            'plugins',
            pluginName,
            'dashboard',
            'migrations',
            `${version}-*.js`
        );
        
        // Finde Migration-Datei
        const fs = require('fs');
        const migrationDir = path.join(__dirname, 'plugins', pluginName, 'dashboard', 'migrations');
        const files = fs.readdirSync(migrationDir);
        const migrationFile = files.find(f => f.startsWith(`${version}-`));
        
        if (!migrationFile) {
            throw new Error(`Migration ${version} nicht gefunden in ${migrationDir}`);
        }
        
        const migrationFullPath = path.join(migrationDir, migrationFile);
        console.log(`📂 Migration gefunden: ${migrationFile}`);
        
        const migration = require(migrationFullPath);
        
        if (!migration.down) {
            throw new Error(`Migration ${version} hat keine down() Methode!`);
        }
        
        // 4. Rollback ausführen
        console.log('');
        console.log('🔻 Führe Rollback aus...');
        console.log('─────────────────────────────────────────');
        
        await migration.down(dbService, guildId);
        
        console.log('─────────────────────────────────────────');
        console.log('');
        
        // 5. Migration-Eintrag aus DB löschen
        const migrationFileRelative = `dashboard/migrations/${migrationFile}`;
        
        await dbService.query(
            'DELETE FROM plugin_migrations WHERE plugin_name = ? AND migration_file = ? AND guild_id = ?',
            [pluginName, migrationFileRelative, guildId]
        );
        
        console.log(`✅ Migration-Eintrag gelöscht aus plugin_migrations`);
        
        // 6. Plugin-Version zurücksetzen (optional)
        const previousVersion = await getPreviousVersion(dbService, pluginName, version);
        if (previousVersion) {
            await dbService.query(
                'UPDATE plugin_versions SET current_version = ? WHERE plugin_name = ?',
                [previousVersion, pluginName]
            );
            console.log(`✅ Plugin-Version zurückgesetzt: ${version} → ${previousVersion}`);
        }
        
        console.log('');
        console.log('✅ ROLLBACK ERFOLGREICH!');
        console.log('');
        console.log('🚀 Starte Dashboard neu mit: pm2 restart dashboard-dev');
        
        try {
            await dbService.close(); // close() statt disconnect()
        } catch (e) {
            // Ignore - nicht kritisch
        }
        process.exit(0);
        
    } catch (error) {
        console.error('');
        console.error('❌ ROLLBACK FEHLGESCHLAGEN:');
        console.error(error);
        process.exit(1);
    }
}

async function getPreviousVersion(dbService, pluginName, currentVersion) {
    const migrations = await dbService.query(
        `SELECT migration_version 
         FROM plugin_migrations 
         WHERE plugin_name = ? 
         AND migration_version < ? 
         ORDER BY executed_at DESC 
         LIMIT 1`,
        [pluginName, currentVersion]
    );
    
    return migrations.length > 0 ? migrations[0].migration_version : null;
}

// CLI Arguments
const [,, pluginName, version, guildId] = process.argv;

if (!pluginName || !version) {
    console.error('❌ Usage: node rollback-migration.js <plugin> <version> [guildId]');
    console.error('❌ Beispiel: node rollback-migration.js core 6.7.0 1403034310172475416');
    process.exit(1);
}

rollbackMigration(pluginName, version, guildId || null);
