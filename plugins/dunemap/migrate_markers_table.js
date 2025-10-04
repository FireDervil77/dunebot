/**
 * Migration Script für dunemap_markers Tabelle
 * Aktualisiert Constraints und fügt Trigger hinzu
 * 
 * Ausführen mit: node plugins/dunemap/migrate_markers_table.js
 */

const mysql = require('mysql2/promise');
require('dotenv').config({ path: './apps/dashboard/.env' });

async function migrate() {
    console.log('🔧 Starte Migration für dunemap_markers Tabelle...\n');

    // DB-Connection aus Environment-Variablen
    const connection = await mysql.createConnection({
        host: process.env.MYSQL_HOST || 'localhost',
        port: process.env.MYSQL_PORT || 3306,
        user: process.env.MYSQL_USER || 'root',
        password: process.env.MYSQL_PASSWORD || '',
        database: process.env.MYSQL_DATABASE || 'dunebot',
        multipleStatements: true
    });

    try {
        // 1. Alte Constraint entfernen
        console.log('📌 Entferne alten Constraint chk_marker_type...');
        await connection.query('ALTER TABLE dunemap_markers DROP CONSTRAINT IF EXISTS chk_marker_type');
        console.log('✅ Alter Constraint entfernt\n');

        // 2. Neuen Constraint hinzufügen
        console.log('📌 Füge neuen Constraint mit allen 14 Marker-Typen hinzu...');
        await connection.query(`
            ALTER TABLE dunemap_markers ADD CONSTRAINT chk_marker_type 
            CHECK (marker_type IN (
                'titan', 'spice', 'stravidium', 'base', 'wrack',
                'aluminium', 'basalt', 'eisen', 'karbon', 'hoele',
                'hole', 'kontrollpunkt', 'taxi', 'test'
            ))
        `);
        console.log('✅ Neuer Constraint hinzugefügt\n');

        // 3. Trigger für 4-Marker-Limit erstellen
        console.log('📌 Erstelle Trigger für 4-Marker-Limit pro Koordinate...');
        
        // Zuerst alten Trigger löschen
        await connection.query('DROP TRIGGER IF EXISTS check_marker_limit');
        
        // Neuen Trigger erstellen
        await connection.query(`
            CREATE TRIGGER check_marker_limit
            BEFORE INSERT ON dunemap_markers
            FOR EACH ROW
            BEGIN
                DECLARE marker_count INT;
                
                SELECT COUNT(*) INTO marker_count
                FROM dunemap_markers
                WHERE guild_id = NEW.guild_id
                  AND sector_x = NEW.sector_x
                  AND sector_y = NEW.sector_y;
                
                IF marker_count >= 4 THEN
                    SIGNAL SQLSTATE '45000'
                    SET MESSAGE_TEXT = 'Maximal 4 Marker pro Koordinate erlaubt';
                END IF;
            END
        `);
        console.log('✅ Trigger erstellt\n');

        // 4. Verifizierung
        console.log('📌 Verifiziere Migration...');
        const [constraints] = await connection.query(`
            SELECT CONSTRAINT_NAME, CHECK_CLAUSE 
            FROM information_schema.CHECK_CONSTRAINTS 
            WHERE TABLE_NAME = 'dunemap_markers' AND CONSTRAINT_NAME = 'chk_marker_type'
        `);
        
        const [triggers] = await connection.query(`
            SELECT TRIGGER_NAME 
            FROM information_schema.TRIGGERS 
            WHERE TRIGGER_NAME = 'check_marker_limit'
        `);

        console.log('✅ Constraint gefunden:', constraints.length > 0 ? 'Ja' : 'Nein');
        console.log('✅ Trigger gefunden:', triggers.length > 0 ? 'Ja' : 'Nein');

        console.log('\n🎉 Migration erfolgreich abgeschlossen!');
        console.log('\n📋 Änderungen:');
        console.log('   - Constraint aktualisiert: Alle 14 Marker-Typen erlaubt');
        console.log('   - Trigger hinzugefügt: Maximal 4 Marker pro Koordinate');

    } catch (error) {
        console.error('\n❌ Fehler bei der Migration:', error.message);
        console.error(error);
        process.exit(1);
    } finally {
        await connection.end();
    }
}

// Migration ausführen
migrate().catch(console.error);
