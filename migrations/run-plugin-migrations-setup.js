#!/usr/bin/env node

/**
 * Erstellt die plugin_migrations Tabelle
 * Diese Tabelle trackt alle ausgeführten SQL-Migrationen
 * 
 * Usage: node migrations/run-plugin-migrations-setup.js
 * 
 * @author FireDervil
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', 'apps', 'dashboard', '.env') });
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

async function main() {
    console.log('🚀 Plugin-Migrations-Tabelle Setup\n');
    
    try {
        // Datenbank-Verbindung
        const connection = await mysql.createConnection({
            host: process.env.MYSQL_HOST,
            port: process.env.MYSQL_PORT || 3306,
            user: process.env.MYSQL_USER,
            password: process.env.MYSQL_PASSWORD,
            database: process.env.MYSQL_DATABASE,
            multipleStatements: true
        });
        
        console.log('✅ Datenbank-Verbindung hergestellt\n');
        
        // SQL-Datei lesen
        const sqlFile = path.join(__dirname, 'create_plugin_migrations_table.sql');
        const sql = fs.readFileSync(sqlFile, 'utf8');
        
        console.log('📄 Führe SQL-Script aus...');
        await connection.query(sql);
        
        console.log('✅ Tabelle `plugin_migrations` erfolgreich erstellt!\n');
        
        // Prüfe ob Tabelle existiert
        const [tables] = await connection.query(`
            SELECT COUNT(*) as count 
            FROM information_schema.tables 
            WHERE table_schema = ? AND table_name = 'plugin_migrations'
        `, [process.env.MYSQL_DATABASE]);
        
        if (tables[0].count > 0) {
            console.log('✓ Tabelle existiert und ist bereit');
            
            // Zeige Struktur
            const [columns] = await connection.query(`
                SELECT column_name, column_type 
                FROM information_schema.columns 
                WHERE table_schema = ? AND table_name = 'plugin_migrations'
                ORDER BY ordinal_position
            `, [process.env.MYSQL_DATABASE]);
            
            console.log('\n📋 Tabellen-Struktur:');
            columns.forEach(col => {
                console.log(`   - ${col.column_name}: ${col.column_type}`);
            });
        }
        
        await connection.end();
        
        console.log('\n🎉 Setup abgeschlossen!\n');
        console.log('ℹ️  Das System verhindert jetzt automatisch doppelte Schema-Ausführungen.');
        console.log('ℹ️  SQL-Dateien werden nur einmal pro Plugin ausgeführt.\n');
        
    } catch (error) {
        console.error('❌ Fehler beim Setup:', error.message);
        console.error('\n📝 Stack Trace:', error.stack);
        process.exit(1);
    }
}

main();
