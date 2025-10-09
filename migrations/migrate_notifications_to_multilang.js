#!/usr/bin/env node
/**
 * Migration: Notifications Tabelle auf 2-sprachiges System umstellen
 * 
 * Ändert:
 * - title → title_translations (JSON)
 * - message → message_translations (JSON)  
 * - action_text → action_text_translations (JSON)
 * 
 * Gleiche Struktur wie news-Tabelle
 * 
 * @author FireDervil
 * @date 2025-10-08
 */

require('dotenv').config({ path: './apps/dashboard/.env' });
const mysql = require('mysql2/promise');

const migration = {
    up: async (connection) => {
        console.log('📦 Starte Notifications Multi-Language Migration...\n');

        // 1. Prüfen ob bereits migriert
        console.log('1️⃣ Prüfe ob Migration bereits durchgeführt wurde...');
        const [existingColumns] = await connection.query(
            "SHOW COLUMNS FROM notifications LIKE 'title_translations'"
        );

        if (existingColumns.length > 0) {
            console.log('⚠️  Migration wurde bereits durchgeführt. Überspringe...');
            return;
        }

        // 2. Backup erstellen
        console.log('2️⃣ Erstelle Backup der notifications-Tabelle...');
        await connection.query(
            'CREATE TABLE notifications_backup_20251008 AS SELECT * FROM notifications'
        );
        const [backupCount] = await connection.query(
            'SELECT COUNT(*) as count FROM notifications_backup_20251008'
        );
        console.log(`   ✅ Backup erstellt: ${backupCount[0].count} Einträge gesichert\n`);

        // 3. Neue Spalten hinzufügen
        console.log('3️⃣ Füge neue JSON-Spalten hinzu...');
        await connection.query(`
            ALTER TABLE notifications
            ADD COLUMN title_translations LONGTEXT NULL AFTER id,
            ADD COLUMN message_translations LONGTEXT NULL AFTER title_translations,
            ADD COLUMN action_text_translations LONGTEXT NULL AFTER message_translations
        `);
        console.log('   ✅ Neue Spalten erstellt\n');

        // 4. Daten migrieren
        console.log('4️⃣ Migriere existierende Daten zu JSON-Format...');
        const [notifications] = await connection.query('SELECT * FROM notifications');
        
        let migrated = 0;
        for (const notification of notifications) {
            const titleTranslations = {
                'de-DE': notification.title || '',
                'en-GB': '' // Leer, muss manuell befüllt werden
            };

            const messageTranslations = {
                'de-DE': notification.message || '',
                'en-GB': ''
            };

            const actionTextTranslations = {
                'de-DE': notification.action_text || 'Mehr erfahren',
                'en-GB': 'Learn more'
            };

            await connection.query(`
                UPDATE notifications 
                SET title_translations = ?,
                    message_translations = ?,
                    action_text_translations = ?
                WHERE id = ?
            `, [
                JSON.stringify(titleTranslations),
                JSON.stringify(messageTranslations),
                JSON.stringify(actionTextTranslations),
                notification.id
            ]);

            migrated++;
            if (migrated % 5 === 0 || migrated === notifications.length) {
                console.log(`   📝 ${migrated}/${notifications.length} Notifications migriert`);
            }
        }
        console.log(`   ✅ Alle ${migrated} Notifications erfolgreich migriert\n`);

        // 5. Alte Spalten entfernen
        console.log('5️⃣ Entferne alte Spalten...');
        await connection.query(`
            ALTER TABLE notifications
            DROP COLUMN title,
            DROP COLUMN message,
            DROP COLUMN action_text
        `);
        console.log('   ✅ Alte Spalten entfernt\n');

        // 6. Constraints hinzufügen
        console.log('6️⃣ Füge JSON-Constraints hinzu...');
        await connection.query(`
            ALTER TABLE notifications
            ADD CONSTRAINT check_title_json CHECK (JSON_VALID(title_translations)),
            ADD CONSTRAINT check_message_json CHECK (JSON_VALID(message_translations)),
            ADD CONSTRAINT check_action_text_json CHECK (JSON_VALID(action_text_translations))
        `);
        console.log('   ✅ JSON-Validation Constraints hinzugefügt\n');

        console.log('✅ Migration erfolgreich abgeschlossen!');
        console.log('\n📋 Nächste Schritte:');
        console.log('   - Englische Übersetzungen manuell hinzufügen');
        console.log('   - Admin-Interface für 2-sprachige Eingabe anpassen');
        console.log('   - Backup-Tabelle kann nach Verifizierung gelöscht werden: DROP TABLE notifications_backup_20251008\n');
    },

    down: async (connection) => {
        console.log('⏮️  Rollback: Stelle alte Struktur wieder her...\n');

        // 1. Prüfen ob Backup existiert
        const [backupExists] = await connection.query(
            "SHOW TABLES LIKE 'notifications_backup_20251008'"
        );

        if (backupExists.length === 0) {
            throw new Error('❌ Backup-Tabelle nicht gefunden! Rollback nicht möglich.');
        }

        // 2. Alte Spalten wiederherstellen
        console.log('1️⃣ Füge alte Spalten hinzu...');
        await connection.query(`
            ALTER TABLE notifications
            ADD COLUMN title VARCHAR(255) NOT NULL AFTER id,
            ADD COLUMN message TEXT NOT NULL AFTER title,
            ADD COLUMN action_text VARCHAR(100) DEFAULT 'Mehr erfahren' AFTER dismissed
        `);
        console.log('   ✅ Alte Spalten erstellt\n');

        // 3. Daten zurückmigrieren
        console.log('2️⃣ Migriere Daten zurück...');
        const [notifications] = await connection.query('SELECT * FROM notifications');

        for (const notification of notifications) {
            const titleTranslations = JSON.parse(notification.title_translations || '{}');
            const messageTranslations = JSON.parse(notification.message_translations || '{}');
            const actionTextTranslations = JSON.parse(notification.action_text_translations || '{}');

            await connection.query(`
                UPDATE notifications
                SET title = ?,
                    message = ?,
                    action_text = ?
                WHERE id = ?
            `, [
                titleTranslations['de-DE'] || '',
                messageTranslations['de-DE'] || '',
                actionTextTranslations['de-DE'] || 'Mehr erfahren',
                notification.id
            ]);
        }
        console.log('   ✅ Daten zurückmigriert\n');

        // 4. JSON-Spalten entfernen
        console.log('3️⃣ Entferne JSON-Spalten...');
        await connection.query(`
            ALTER TABLE notifications
            DROP CONSTRAINT check_title_json,
            DROP CONSTRAINT check_message_json,
            DROP CONSTRAINT check_action_text_json
        `);
        await connection.query(`
            ALTER TABLE notifications
            DROP COLUMN title_translations,
            DROP COLUMN message_translations,
            DROP COLUMN action_text_translations
        `);
        console.log('   ✅ JSON-Spalten entfernt\n');

        console.log('✅ Rollback erfolgreich abgeschlossen!');
    }
};

// Migration ausführen
(async () => {
    let connection;
    
    try {
        connection = await mysql.createConnection({
            host: process.env.MYSQL_HOST,
            port: process.env.MYSQL_PORT,
            user: process.env.MYSQL_USER,
            password: process.env.MYSQL_PASSWORD,
            database: process.env.MYSQL_DATABASE
        });

        console.log('🔗 Datenbankverbindung hergestellt\n');

        // Prüfe Kommandozeilenargument
        const command = process.argv[2];

        if (command === 'down') {
            await migration.down(connection);
        } else {
            await migration.up(connection);
        }

    } catch (error) {
        console.error('❌ Migration fehlgeschlagen:', error.message);
        console.error(error);
        process.exit(1);
    } finally {
        if (connection) {
            await connection.end();
            console.log('🔌 Datenbankverbindung geschlossen\n');
        }
    }
})();
