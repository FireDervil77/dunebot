/**
 * Migration: AutoMod - Mention Limits hinzufügen
 * Fügt max_mentions und max_role_mentions Spalten zur automod_settings Tabelle hinzu
 * 
 * @author DuneBot Team
 * @date 2025-10-13
 */

const mysql = require('mysql2/promise');
require('dotenv').config({ path: './apps/dashboard/.env' });

async function migrate() {
    let connection;
    
    try {
        console.log('🔌 Verbinde mit Datenbank...');
        connection = await mysql.createConnection({
            host: process.env.MYSQL_HOST,
            port: process.env.MYSQL_PORT,
            user: process.env.MYSQL_USER,
            password: process.env.MYSQL_PASSWORD,
            database: process.env.MYSQL_DATABASE
        });
        
        console.log('✅ Verbindung hergestellt\n');
        
        // Prüfen ob Spalten bereits existieren
        console.log('🔍 Prüfe vorhandene Spalten...');
        const [columns] = await connection.query(`
            SELECT COLUMN_NAME 
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'automod_settings'
        `, [process.env.MYSQL_DATABASE]);
        
        const existingColumns = columns.map(c => c.COLUMN_NAME);
        const hasMaxMentions = existingColumns.includes('max_mentions');
        const hasMaxRoleMentions = existingColumns.includes('max_role_mentions');
        
        console.log(`   max_mentions: ${hasMaxMentions ? '✓ existiert bereits' : '✗ fehlt'}`);
        console.log(`   max_role_mentions: ${hasMaxRoleMentions ? '✓ existiert bereits' : '✗ fehlt'}\n`);
        
        // max_mentions hinzufügen
        if (!hasMaxMentions) {
            console.log('➕ Füge max_mentions Spalte hinzu...');
            await connection.query(`
                ALTER TABLE automod_settings 
                ADD COLUMN max_mentions TINYINT UNSIGNED DEFAULT 0 
                COMMENT 'Max User-Mentions pro Nachricht (0 = unbegrenzt)'
                AFTER max_lines
            `);
            console.log('✅ max_mentions erfolgreich hinzugefügt\n');
        } else {
            console.log('⏭️  max_mentions bereits vorhanden, überspringe\n');
        }
        
        // max_role_mentions hinzufügen
        if (!hasMaxRoleMentions) {
            console.log('➕ Füge max_role_mentions Spalte hinzu...');
            await connection.query(`
                ALTER TABLE automod_settings 
                ADD COLUMN max_role_mentions TINYINT UNSIGNED DEFAULT 0 
                COMMENT 'Max Rollen-Mentions pro Nachricht (0 = unbegrenzt)'
                AFTER max_mentions
            `);
            console.log('✅ max_role_mentions erfolgreich hinzugefügt\n');
        } else {
            console.log('⏭️  max_role_mentions bereits vorhanden, überspringe\n');
        }
        
        // Finale Struktur anzeigen
        console.log('📊 Finale Tabellenstruktur:');
        const [finalStructure] = await connection.query('DESCRIBE automod_settings');
        console.table(finalStructure.map(s => ({
            Field: s.Field,
            Type: s.Type,
            Null: s.Null,
            Default: s.Default
        })));
        
        console.log('\n✅ Migration erfolgreich abgeschlossen!');
        
    } catch (error) {
        console.error('\n❌ Migration fehlgeschlagen:', error);
        process.exit(1);
    } finally {
        if (connection) {
            await connection.end();
            console.log('\n🔌 Datenbankverbindung geschlossen');
        }
    }
}

// Migration ausführen
migrate();
