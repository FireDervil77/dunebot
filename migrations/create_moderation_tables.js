/**
 * Migration: Moderation Plugin Tables
 * Erstellt die Tabellen für das Moderation-Plugin
 * 
 * @author DuneBot Team
 */

require('dotenv').config({ path: './apps/dashboard/.env' });
const mysql = require('mysql2/promise');
const path = require('path');
const fs = require('fs');

async function main() {
    console.log('🚀 Starte Migration: Moderation Plugin Tables');
    
    let connection;
    try {
        // Verbindung aufbauen
        connection = await mysql.createConnection({
            host: process.env.MYSQL_HOST,
            port: process.env.MYSQL_PORT || 3306,
            user: process.env.MYSQL_USER,
            password: process.env.MYSQL_PASSWORD,
            database: process.env.MYSQL_DATABASE
        });
        
        console.log('✅ Datenbankverbindung hergestellt');

        // SQL-Schema-Dateien laden
        const schemasDir = path.join(__dirname, '..', 'plugins', 'moderation', 'shared', 'schemas');
        
        // 1. Moderation Settings Tabelle
        console.log('\n📋 Erstelle moderation_settings Tabelle...');
        const settingsSQL = fs.readFileSync(
            path.join(schemasDir, 'moderation_settings.sql'),
            'utf8'
        );
        await connection.query(settingsSQL);
        console.log('✅ moderation_settings Tabelle erstellt');

        // 2. Moderation Logs Tabelle
        console.log('\n📋 Erstelle moderation_logs Tabelle...');
        const logsSQL = fs.readFileSync(
            path.join(schemasDir, 'moderation_logs.sql'),
            'utf8'
        );
        await connection.query(logsSQL);
        console.log('✅ moderation_logs Tabelle erstellt');

        // Verification: Tabellen prüfen
        console.log('\n🔍 Verifiziere Tabellen...');
        const [tables] = await connection.query(`
            SHOW TABLES LIKE 'moderation_%'
        `);
        
        console.log(`✅ ${tables.length} Moderation-Tabellen gefunden:`);
        tables.forEach(row => {
            const tableName = Object.values(row)[0];
            console.log(`   - ${tableName}`);
        });

        // Zeige Spalten der moderation_settings Tabelle
        console.log('\n📊 moderation_settings Struktur:');
        const [settingsCols] = await connection.query('DESCRIBE moderation_settings');
        settingsCols.forEach(col => {
            console.log(`   ${col.Field} (${col.Type}) ${col.Key ? `[${col.Key}]` : ''}`);
        });

        // Zeige Spalten der moderation_logs Tabelle
        console.log('\n📊 moderation_logs Struktur:');
        const [logsCols] = await connection.query('DESCRIBE moderation_logs');
        logsCols.forEach(col => {
            console.log(`   ${col.Field} (${col.Type}) ${col.Key ? `[${col.Key}]` : ''}`);
        });

        console.log('\n✅ Migration erfolgreich abgeschlossen!');
        
    } catch (error) {
        console.error('❌ Fehler bei der Migration:', error.message);
        console.error(error);
        process.exit(1);
    } finally {
        if (connection) {
            await connection.end();
            console.log('✅ Datenbankverbindung geschlossen');
        }
    }
}

// Prüfung ob als Hauptmodul ausgeführt
if (require.main === module) {
    main();
}

module.exports = main;
