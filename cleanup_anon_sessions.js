/**
 * Session Cleanup Script
 * Bereinigt alle anonymen Sessions manuell
 */

require('dotenv').config({ path: './apps/dashboard/.env' });
const mysql = require('mysql2/promise');

async function cleanupAnonymousSessions() {
    console.log('🧹 Session Cleanup gestartet...\n');
    
    const connection = await mysql.createConnection({
        host: process.env.MYSQL_HOST,
        port: process.env.MYSQL_PORT,
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE
    });

    try {
        // Vorher-Statistiken
        const [before] = await connection.execute(`
            SELECT COUNT(*) as total FROM sessions
        `);
        
        console.log(`📊 Sessions vor Cleanup: ${before[0].total}`);
        
        // Alle anonymen Sessions löschen (nur kleine Session-Daten = keine User-Info)
        const [result] = await connection.execute(`
            DELETE FROM sessions 
            WHERE LENGTH(data) < 500
        `);
        
        console.log(`✅ Gelöscht: ${result.affectedRows} anonyme Sessions`);
        
        // Nachher-Statistiken
        const [after] = await connection.execute(`
            SELECT COUNT(*) as total FROM sessions
        `);
        
        console.log(`📊 Sessions nach Cleanup: ${after[0].total}`);
        console.log('\n💡 Nur authentifizierte User-Sessions bleiben erhalten\n');
        
    } catch (error) {
        console.error('❌ Fehler:', error);
    } finally {
        await connection.end();
    }
}

cleanupAnonymousSessions()
    .then(() => {
        console.log('✅ Cleanup abgeschlossen\n');
        process.exit(0);
    })
    .catch((error) => {
        console.error('FATAL ERROR:', error);
        process.exit(1);
    });
