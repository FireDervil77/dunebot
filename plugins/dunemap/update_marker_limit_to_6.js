/**
 * Update Marker Limit von 4 auf 6
 * Aktualisiert den Datenbank-Trigger für das neue Limit
 */

require('dotenv').config({ path: '../../apps/dashboard/.env' });
const mysql = require('mysql2/promise');

async function updateMarkerLimit() {
    let connection;
    
    try {
        console.log('🔧 Verbinde mit Datenbank...');
        connection = await mysql.createConnection({
            host: process.env.MYSQL_HOST,
            port: process.env.MYSQL_PORT,
            user: process.env.MYSQL_USER,
            password: process.env.MYSQL_PASSWORD,
            database: process.env.MYSQL_DATABASE
        });

        console.log('✅ Verbindung hergestellt');
        console.log('📝 Aktualisiere Trigger für Marker-Limit auf 6...\n');

        // Lösche alten Trigger
        console.log('🗑️  Lösche alten Trigger...');
        await connection.query('DROP TRIGGER IF EXISTS check_marker_limit');
        console.log('✅ Alter Trigger gelöscht');

        // Erstelle neuen Trigger mit Limit 6
        console.log('📌 Erstelle neuen Trigger mit Limit 6...');
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
                
                IF marker_count >= 6 THEN
                    SIGNAL SQLSTATE '45000'
                    SET MESSAGE_TEXT = 'Maximal 6 Marker pro Koordinate erlaubt';
                END IF;
            END
        `);
        console.log('✅ Neuer Trigger erstellt');

        // Verifizierung
        console.log('\n🔍 Verifiziere Trigger...');
        const [triggers] = await connection.query(`
            SHOW TRIGGERS FROM ${process.env.MYSQL_DATABASE}
            WHERE \`Trigger\` = 'check_marker_limit'
        `);

        if (triggers.length > 0) {
            console.log('✅ Trigger erfolgreich verifiziert:');
            console.log(`   - Name: ${triggers[0].Trigger}`);
            console.log(`   - Tabelle: ${triggers[0].Table}`);
            console.log(`   - Event: ${triggers[0].Event}`);
            console.log(`   - Timing: ${triggers[0].Timing}`);
        } else {
            console.log('❌ Trigger nicht gefunden!');
        }

        console.log('\n✅ Marker-Limit erfolgreich auf 6 erhöht!');
        console.log('📊 Änderungen:');
        console.log('   - Dashboard Backend: index.js');
        console.log('   - Dashboard Frontend: dunemap-admin.js');
        console.log('   - MapGenerator: shared/MapGenerator.js');
        console.log('   - Locales: de-DE.json, en-GB.json');
        console.log('   - Datenbank Trigger: check_marker_limit');

    } catch (error) {
        console.error('\n❌ Fehler beim Update:', error.message);
        console.error('Stack:', error.stack);
        process.exit(1);
    } finally {
        if (connection) {
            await connection.end();
            console.log('\n🔌 Datenbankverbindung geschlossen');
        }
    }
}

updateMarkerLimit();
