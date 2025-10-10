#!/usr/bin/env node
/**
 * Check and Run DuneMap Migration
 * Prüft ob is_permanent Spalte existiert und führt Migration aus falls nötig
 */

require('dotenv').config({ path: './apps/dashboard/.env' });
const mysql = require('mysql2/promise');

async function checkAndMigrate() {
    console.log('🔍 Prüfe DuneMap Migration Status...\n');
    
    const connection = await mysql.createConnection({
        host: process.env.MYSQL_HOST,
        port: process.env.MYSQL_PORT,
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE
    });

    try {
        // Prüfe ob dunemap_markers Tabelle existiert
        const [tables] = await connection.query(
            "SHOW TABLES LIKE 'dunemap_markers'"
        );

        if (tables.length === 0) {
            console.log('⚠️  Tabelle dunemap_markers existiert nicht!');
            console.log('   Plugin muss erst aktiviert werden.\n');
            return;
        }

        // Prüfe ob is_permanent Spalte existiert
        const [columns] = await connection.query(
            "SHOW COLUMNS FROM dunemap_markers LIKE 'is_permanent'"
        );

        if (columns.length > 0) {
            console.log('✅ Migration bereits ausgeführt!');
            console.log(`   Spalte 'is_permanent' existiert bereits.\n`);
            
            // Zeige Index-Info
            const [indexes] = await connection.query(
                "SHOW INDEX FROM dunemap_markers WHERE Key_name = 'idx_permanent'"
            );
            
            if (indexes.length > 0) {
                console.log('✅ Index idx_permanent existiert');
            } else {
                console.log('⚠️  Index idx_permanent fehlt');
            }
            
            return;
        }

        console.log('⚠️  Migration erforderlich!\n');
        console.log('Führe Migration aus...\n');

        // Migration ausführen
        await connection.query(`
            ALTER TABLE dunemap_markers 
            ADD COLUMN is_permanent TINYINT(1) NOT NULL DEFAULT 0
        `);
        console.log('✅ Spalte is_permanent hinzugefügt');

        await connection.query(`
            CREATE INDEX idx_permanent ON dunemap_markers (guild_id, is_permanent)
        `);
        console.log('✅ Index idx_permanent erstellt');

        console.log('\n🎉 Migration erfolgreich abgeschlossen!\n');

    } catch (error) {
        console.error('❌ Fehler:', error.message);
        throw error;
    } finally {
        await connection.end();
    }
}

checkAndMigrate()
    .then(() => process.exit(0))
    .catch(err => {
        console.error(err);
        process.exit(1);
    });
