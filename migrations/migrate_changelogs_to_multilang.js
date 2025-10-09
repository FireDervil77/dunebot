#!/usr/bin/env node
/**
 * Migration: Changelogs Tabelle auf 2-sprachiges System umstellen
 * 
 * Ändert:
 * - title → title_translations (JSON)
 * - description → description_translations (JSON)
 * - changes → changes_translations (JSON)
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
        console.log('📦 Starte Changelogs Multi-Language Migration...\n');

        // 1. Prüfen ob bereits migriert
        console.log('1️⃣ Prüfe ob Migration bereits durchgeführt wurde...');
        const [existingColumns] = await connection.query(
            "SHOW COLUMNS FROM changelogs LIKE 'title_translations'"
        );

        if (existingColumns.length > 0) {
            console.log('⚠️  Migration wurde bereits durchgeführt. Überspringe...');
            return;
        }

        // 2. Backup erstellen
        console.log('2️⃣ Erstelle Backup der changelogs-Tabelle...');
        await connection.query(
            'CREATE TABLE changelogs_backup_20251008 AS SELECT * FROM changelogs'
        );
        const [backupCount] = await connection.query(
            'SELECT COUNT(*) as count FROM changelogs_backup_20251008'
        );
        console.log(`   ✅ Backup erstellt: ${backupCount[0].count} Einträge gesichert\n`);

        // 3. Neue Spalten hinzufügen
        console.log('3️⃣ Füge neue JSON-Spalten hinzu...');
        await connection.query(`
            ALTER TABLE changelogs
            ADD COLUMN title_translations LONGTEXT NULL AFTER version,
            ADD COLUMN description_translations LONGTEXT NULL AFTER title_translations,
            ADD COLUMN changes_translations LONGTEXT NULL AFTER description_translations
        `);
        console.log('   ✅ Neue Spalten erstellt\n');

        // 4. Daten migrieren
        console.log('4️⃣ Migriere existierende Daten zu JSON-Format...');
        const [changelogs] = await connection.query('SELECT * FROM changelogs');
        
        let migrated = 0;
        for (const changelog of changelogs) {
            const titleTranslations = {
                'de-DE': changelog.title || '',
                'en-GB': '' // Leer, muss manuell befüllt werden
            };

            const descriptionTranslations = {
                'de-DE': changelog.description || '',
                'en-GB': ''
            };

            const changesTranslations = {
                'de-DE': changelog.changes || '',
                'en-GB': ''
            };

            await connection.query(`
                UPDATE changelogs 
                SET title_translations = ?,
                    description_translations = ?,
                    changes_translations = ?
                WHERE id = ?
            `, [
                JSON.stringify(titleTranslations),
                JSON.stringify(descriptionTranslations),
                JSON.stringify(changesTranslations),
                changelog.id
            ]);

            migrated++;
            if (migrated % 5 === 0 || migrated === changelogs.length) {
                console.log(`   📝 ${migrated}/${changelogs.length} Changelogs migriert`);
            }
        }
        console.log(`   ✅ Alle ${migrated} Changelogs erfolgreich migriert\n`);

        // 5. Alte Spalten entfernen
        console.log('5️⃣ Entferne alte Spalten...');
        await connection.query(`
            ALTER TABLE changelogs
            DROP COLUMN title,
            DROP COLUMN description,
            DROP COLUMN changes
        `);
        console.log('   ✅ Alte Spalten entfernt\n');

        // 6. Constraints hinzufügen
        console.log('6️⃣ Füge JSON-Constraints hinzu...');
        await connection.query(`
            ALTER TABLE changelogs
            ADD CONSTRAINT check_title_json CHECK (JSON_VALID(title_translations)),
            ADD CONSTRAINT check_description_json CHECK (JSON_VALID(description_translations)),
            ADD CONSTRAINT check_changes_json CHECK (JSON_VALID(changes_translations))
        `);
        console.log('   ✅ JSON-Validation Constraints hinzugefügt\n');

        console.log('✅ Migration erfolgreich abgeschlossen!');
        console.log('\n📋 Nächste Schritte:');
        console.log('   - Englische Übersetzungen manuell hinzufügen');
        console.log('   - Admin-Interface für 2-sprachige Eingabe erstellen');
        console.log('   - Frontend-Anzeige für Changelogs implementieren');
        console.log('   - Backup-Tabelle kann nach Verifizierung gelöscht werden: DROP TABLE changelogs_backup_20251008\n');
    },

    down: async (connection) => {
        console.log('⏮️  Rollback: Stelle alte Struktur wieder her...\n');

        // 1. Prüfen ob Backup existiert
        const [backupExists] = await connection.query(
            "SHOW TABLES LIKE 'changelogs_backup_20251008'"
        );

        if (backupExists.length === 0) {
            throw new Error('❌ Backup-Tabelle nicht gefunden! Rollback nicht möglich.');
        }

        // 2. Alte Spalten wiederherstellen
        console.log('1️⃣ Füge alte Spalten hinzu...');
        await connection.query(`
            ALTER TABLE changelogs
            ADD COLUMN title VARCHAR(255) NOT NULL AFTER version,
            ADD COLUMN description LONGTEXT NOT NULL AFTER title,
            ADD COLUMN changes LONGTEXT NOT NULL AFTER type
        `);
        console.log('   ✅ Alte Spalten erstellt\n');

        // 3. Daten zurückmigrieren
        console.log('2️⃣ Migriere Daten zurück...');
        const [changelogs] = await connection.query('SELECT * FROM changelogs');

        for (const changelog of changelogs) {
            const titleTranslations = JSON.parse(changelog.title_translations || '{}');
            const descriptionTranslations = JSON.parse(changelog.description_translations || '{}');
            const changesTranslations = JSON.parse(changelog.changes_translations || '{}');

            await connection.query(`
                UPDATE changelogs
                SET title = ?,
                    description = ?,
                    changes = ?
                WHERE id = ?
            `, [
                titleTranslations['de-DE'] || '',
                descriptionTranslations['de-DE'] || '',
                changesTranslations['de-DE'] || '',
                changelog.id
            ]);
        }
        console.log('   ✅ Daten zurückmigriert\n');

        // 4. JSON-Spalten entfernen
        console.log('3️⃣ Entferne JSON-Spalten...');
        await connection.query(`
            ALTER TABLE changelogs
            DROP CONSTRAINT check_title_json,
            DROP CONSTRAINT check_description_json,
            DROP CONSTRAINT check_changes_json
        `);
        await connection.query(`
            ALTER TABLE changelogs
            DROP COLUMN title_translations,
            DROP COLUMN description_translations,
            DROP COLUMN changes_translations
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
