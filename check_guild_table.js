/**
 * Tabellen-Struktur-Check
 */

require('dotenv').config({ path: './apps/dashboard/.env' });
const mysql = require('mysql2/promise');

async function checkTableStructure() {
    console.log('🔍 Prüfe guilds-Tabellen-Struktur...\n');
    
    const connection = await mysql.createConnection({
        host: process.env.MYSQL_HOST,
        port: process.env.MYSQL_PORT,
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE
    });

    try {
        // Beschreibe die Tabelle
        const [columns] = await connection.execute('DESCRIBE guilds');
        
        console.log('📋 guilds-Tabelle Spalten:\n');
        console.log('=' .repeat(80));
        columns.forEach(col => {
            console.log(`  ${col.Field.padEnd(20)} ${col.Type.padEnd(20)} ${col.Null === 'YES' ? 'NULL' : 'NOT NULL'} ${col.Key ? `[${col.Key}]` : ''}`);
        });
        console.log('=' .repeat(80));
        
        // Zeige die ersten 5 Einträge
        const [rows] = await connection.execute('SELECT * FROM guilds LIMIT 5');
        console.log(`\n📊 Erste ${rows.length} Einträge:\n`);
        
        if (rows.length === 0) {
            console.log('⚠️  Tabelle ist leer!');
        } else {
            rows.forEach((row, i) => {
                console.log(`${i + 1}. Eintrag:`);
                Object.entries(row).forEach(([key, value]) => {
                    console.log(`   ${key}: ${value}`);
                });
                console.log('');
            });
        }
        
    } catch (error) {
        console.error('❌ Fehler:', error);
    } finally {
        await connection.end();
    }
}

checkTableStructure()
    .then(() => {
        console.log('✅ Check abgeschlossen\n');
        process.exit(0);
    })
    .catch((error) => {
        console.error('FATAL ERROR:', error);
        process.exit(1);
    });
