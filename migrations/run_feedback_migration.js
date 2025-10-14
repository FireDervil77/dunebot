require('dotenv').config({ path: './apps/dashboard/.env' });
const mysql = require('mysql2/promise');
const fs = require('fs');

async function runMigration() {
    const conn = await mysql.createConnection({
        host: process.env.MYSQL_HOST,
        port: process.env.MYSQL_PORT,
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE,
        multipleStatements: true
    });

    console.log('=== Vor der Migration ===');
    const [before] = await conn.query('SELECT COUNT(*) as total FROM nav_items WHERE url LIKE "%bug-report" OR url LIKE "%feature-request"');
    console.log('Bestehende Feedback-Items:', before[0].total);

    console.log('\n=== Führe Migration aus ===');
    const sql = fs.readFileSync('./migrations/add_feedback_navigation.sql', 'utf8');

    // Aufteilen in einzelne Statements
    const statements = sql
        .split(';')
        .filter(s => {
            const trimmed = s.trim();
            return trimmed && !trimmed.includes('INSERTED ITEMS');
        });

    for (const statement of statements) {
        if (statement.trim()) {
            await conn.query(statement);
        }
    }

    console.log('Migration erfolgreich ausgeführt!');

    console.log('\n=== Nach der Migration ===');
    const [after] = await conn.query(`
        SELECT 
            COUNT(*) as total_items,
            SUM(CASE WHEN url LIKE '%bug-report' THEN 1 ELSE 0 END) as bug_reports,
            SUM(CASE WHEN url LIKE '%feature-request' THEN 1 ELSE 0 END) as feature_requests
        FROM nav_items 
        WHERE url LIKE '%bug-report' OR url LIKE '%feature-request'
    `);
    console.log('Gesamt:', after[0].total_items);
    console.log('Bug Reports:', after[0].bug_reports);
    console.log('Feature Requests:', after[0].feature_requests);

    console.log('\n=== Beispiel-Einträge ===');
    const [examples] = await conn.query('SELECT guildId, title, url, icon, sort_order FROM nav_items WHERE url LIKE "%bug-report" OR url LIKE "%feature-request" ORDER BY guildId, sort_order LIMIT 6');
    console.table(examples);

    await conn.end();
}

runMigration().catch(console.error);
