/**
 * Migration: News-Tabelle auf Multi-Language (JSON) umstellen
 * 
 * Konvertiert die news-Tabelle von Single-Language zu Multi-Language:
 * - title → title_translations (JSON)
 * - news_text → content_translations (JSON)  
 * - excerpt → excerpt_translations (JSON)
 * 
 * Existierende deutsche News werden als "de-DE" gespeichert
 * 
 * @author FireDervil
 * @date 2025-10-06
 */

require('dotenv').config({ path: '../apps/dashboard/.env' });
const mysql = require('mysql2/promise');

async function migrateNewsToMultiLang() {
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
        console.log('✅ Datenbankverbindung erfolgreich\n');

        // 1. Prüfe ob Tabelle existiert
        console.log('📋 Prüfe news-Tabelle...');
        const [tables] = await connection.query(
            "SHOW TABLES LIKE 'news'"
        );
        
        if (tables.length === 0) {
            console.log('⚠️  News-Tabelle existiert nicht. Migration nicht notwendig.');
            return;
        }

        // 2. Prüfe ob Migration bereits durchgeführt wurde
        const [columns] = await connection.query(
            "SHOW COLUMNS FROM news LIKE 'title_translations'"
        );
        
        if (columns.length > 0) {
            console.log('ℹ️  Migration wurde bereits durchgeführt. Überspringe...');
            return;
        }

        // 3. Lade alle existierenden News
        console.log('📰 Lade existierende News...');
        const [existingNews] = await connection.query(
            'SELECT _id, title, news_text, excerpt FROM news'
        );
        console.log(`   Gefunden: ${existingNews.length} News-Einträge\n`);

        // 4. Backup-Tabelle erstellen
        console.log('💾 Erstelle Backup der news-Tabelle...');
        await connection.query(
            'CREATE TABLE news_backup_20251006 AS SELECT * FROM news'
        );
        console.log('✅ Backup erstellt: news_backup_20251006\n');

        // 5. Temporäre Spalten hinzufügen
        console.log('🔧 Füge temporäre JSON-Spalten hinzu...');
        await connection.query(`
            ALTER TABLE news 
            ADD COLUMN title_translations JSON AFTER slug,
            ADD COLUMN content_translations JSON AFTER title_translations,
            ADD COLUMN excerpt_translations JSON AFTER content_translations
        `);
        console.log('✅ Temporäre Spalten hinzugefügt\n');

        // 6. Daten konvertieren
        console.log('🔄 Konvertiere existierende News zu Multi-Language Format...');
        for (const news of existingNews) {
            const titleTranslations = {
                'de-DE': news.title || ''
            };
            const contentTranslations = {
                'de-DE': news.news_text || ''
            };
            const excerptTranslations = {
                'de-DE': news.excerpt || ''
            };

            await connection.query(
                `UPDATE news 
                 SET title_translations = ?,
                     content_translations = ?,
                     excerpt_translations = ?
                 WHERE _id = ?`,
                [
                    JSON.stringify(titleTranslations),
                    JSON.stringify(contentTranslations),
                    JSON.stringify(excerptTranslations),
                    news._id
                ]
            );
            console.log(`   ✓ News ID ${news._id}: "${news.title}"`);
        }
        console.log(`✅ ${existingNews.length} News konvertiert\n`);

        // 7. Alte Spalten entfernen
        console.log('🗑️  Entferne alte Single-Language Spalten...');
        await connection.query(`
            ALTER TABLE news 
            DROP COLUMN title,
            DROP COLUMN news_text,
            DROP COLUMN excerpt
        `);
        console.log('✅ Alte Spalten entfernt\n');

        // 8. Überprüfe neue Struktur
        console.log('🔍 Neue Tabellenstruktur:');
        const [newStructure] = await connection.query('DESCRIBE news');
        console.table(newStructure.map(col => ({
            Field: col.Field,
            Type: col.Type,
            Null: col.Null
        })));

        // 9. Zeige Beispiel-Daten
        console.log('\n📊 Beispiel-News (erste 2 Einträge):');
        const [sampleNews] = await connection.query('SELECT _id, slug, title_translations, excerpt_translations FROM news LIMIT 2');
        sampleNews.forEach(news => {
            console.log(`\n   ID: ${news._id} | Slug: ${news.slug}`);
            console.log(`   Titel: ${JSON.parse(news.title_translations)['de-DE']}`);
            console.log(`   Excerpt: ${JSON.parse(news.excerpt_translations)['de-DE'].substring(0, 50)}...`);
        });

        console.log('\n\n✨ Migration erfolgreich abgeschlossen! ✨');
        console.log('📝 Nächste Schritte:');
        console.log('   1. News-Controller anpassen (getLocalizedNews Funktion)');
        console.log('   2. News-Views aktualisieren');
        console.log('   3. Admin-Panel für News-Übersetzungen hinzufügen');
        console.log('\n💡 Backup-Tabelle: news_backup_20251006');

    } catch (error) {
        console.error('\n❌ Migration fehlgeschlagen:', error.message);
        console.error('Stack Trace:', error.stack);
        
        if (connection) {
            console.log('\n🔄 Versuche Rollback...');
            try {
                // Prüfe ob Backup existiert
                const [backup] = await connection.query(
                    "SHOW TABLES LIKE 'news_backup_20251006'"
                );
                
                if (backup.length > 0) {
                    await connection.query('DROP TABLE IF EXISTS news');
                    await connection.query('RENAME TABLE news_backup_20251006 TO news');
                    console.log('✅ Rollback erfolgreich - Original-Tabelle wiederhergestellt');
                }
            } catch (rollbackError) {
                console.error('❌ Rollback fehlgeschlagen:', rollbackError.message);
            }
        }
        
        process.exit(1);
    } finally {
        if (connection) {
            await connection.end();
            console.log('\n🔌 Datenbankverbindung geschlossen');
        }
    }
}

// Script ausführen
console.log('═══════════════════════════════════════════════════════════');
console.log('  📰 News Multi-Language Migration');
console.log('  🗓️  ' + new Date().toLocaleString('de-DE'));
console.log('═══════════════════════════════════════════════════════════\n');

migrateNewsToMultiLang();
