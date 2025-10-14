/**
 * Emergency Fix: Add AUTO_INCREMENT to notifications.id
 * 
 * @author FireDervil
 */

require('dotenv').config({ path: './apps/dashboard/.env' });
const mysql = require('mysql2/promise');

async function fixNotificationsTable() {
    console.log('🔧 Starte Notifications-Tabellen-Fix...');
    
    const connection = await mysql.createConnection({
        host: process.env.MYSQL_HOST || 'localhost',
        port: process.env.MYSQL_PORT || 3306,
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE
    });

    try {
        // 1. Prüfe aktuelle Tabellen-Struktur
        console.log('\n📊 Aktuelle Tabellen-Struktur:');
        const [columns] = await connection.execute('DESCRIBE notifications');
        console.table(columns);

        // 2. Prüfe ob id AUTO_INCREMENT hat
        const [createTable] = await connection.execute('SHOW CREATE TABLE notifications');
        const createStatement = createTable[0]['Create Table'];
        
        if (createStatement.includes('AUTO_INCREMENT')) {
            console.log('\n✅ Die id-Spalte hat bereits AUTO_INCREMENT!');
        } else {
            console.log('\n⚠️  Die id-Spalte hat KEIN AUTO_INCREMENT!');
            console.log('🔧 Füge AUTO_INCREMENT hinzu...');
            
            // Füge AUTO_INCREMENT hinzu (INT ist ok für diese Tabelle)
            const idColumn = columns.find(col => col.Field === 'id');
            console.log('🔧 Ändere id-Spalte von', idColumn?.Type, 'zu INT AUTO_INCREMENT...');
            
            await connection.execute(`
                ALTER TABLE notifications 
                MODIFY COLUMN id INT(11) NOT NULL AUTO_INCREMENT
            `);
            console.log('✅ AUTO_INCREMENT erfolgreich hinzugefügt!');
        }

        // 3. Zeige finale Struktur
        console.log('\n📊 Finale Tabellen-Struktur:');
        const [finalColumns] = await connection.execute('DESCRIBE notifications');
        console.table(finalColumns);

        console.log('\n✅ Fix abgeschlossen!');

    } catch (error) {
        console.error('❌ Fehler beim Fix:', error.message);
        throw error;
    } finally {
        await connection.end();
    }
}

fixNotificationsTable()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error('FATAL ERROR:', error);
        process.exit(1);
    });
