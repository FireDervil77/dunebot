/**
 * Session Statistics Checker
 * Prüft aktuelle Session-Statistiken in der DB
 */

require('dotenv').config({ path: './apps/dashboard/.env' });
const mysql = require('mysql2/promise');

async function checkSessions() {
    console.log('🔍 Verbinde zu MySQL...\n');
    
    const connection = await mysql.createConnection({
        host: process.env.MYSQL_HOST,
        port: process.env.MYSQL_PORT,
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE
    });

    try {
        // Gesamt-Statistiken
        console.log('📊 SESSION-STATISTIKEN:\n');
        console.log('=' .repeat(60));
        
        const [stats] = await connection.execute(`
            SELECT 
                COUNT(*) as total_sessions,
                SUM(CASE WHEN LENGTH(data) > 500 THEN 1 ELSE 0 END) as authenticated,
                SUM(CASE WHEN LENGTH(data) <= 500 THEN 1 ELSE 0 END) as anonymous,
                SUM(CASE WHEN expires < UNIX_TIMESTAMP() THEN 1 ELSE 0 END) as expired,
                SUM(CASE WHEN expires >= UNIX_TIMESTAMP() THEN 1 ELSE 0 END) as active
            FROM sessions
        `);
        
        const s = stats[0];
        console.log(`Gesamt Sessions:        ${s.total_sessions}`);
        console.log(`  ├─ Aktiv:             ${s.active} (${((s.active/s.total_sessions)*100).toFixed(1)}%)`);
        console.log(`  └─ Abgelaufen:        ${s.expired} (${((s.expired/s.total_sessions)*100).toFixed(1)}%)`);
        console.log('');
        console.log(`Authentifizierte:       ${s.authenticated} (${((s.authenticated/s.total_sessions)*100).toFixed(1)}%)`);
        console.log(`Anonyme:                ${s.anonymous} (${((s.anonymous/s.total_sessions)*100).toFixed(1)}%)`);
        console.log('=' .repeat(60));
        
        // Details zu abgelaufenen anonymen Sessions
        console.log('\n🗑️  ABGELAUFENE ANONYME SESSIONS (sollten gelöscht werden):\n');
        
        const [expiredAnon] = await connection.execute(`
            SELECT COUNT(*) as count
            FROM sessions 
            WHERE expires < UNIX_TIMESTAMP()
            AND LENGTH(data) < 500
        `);
        
        console.log(`Anzahl: ${expiredAnon[0].count}`);
        
        if (expiredAnon[0].count > 0) {
            console.log('⚠️  Diese sollten durch SessionManager-Cleanup entfernt werden!');
        } else {
            console.log('✅ Keine abgelaufenen anonymen Sessions - Cleanup funktioniert!');
        }
        
        // Aktive anonyme Sessions (legitim)
        console.log('\n👤 AKTIVE ANONYME SESSIONS (legitim - User browsen ohne Login):\n');
        
        const [activeAnon] = await connection.execute(`
            SELECT COUNT(*) as count
            FROM sessions 
            WHERE expires >= UNIX_TIMESTAMP()
            AND LENGTH(data) < 500
        `);
        
        console.log(`Anzahl: ${activeAnon[0].count}`);
        
        // Sample-Daten von aktiven anonymen Sessions
        const [samples] = await connection.execute(`
            SELECT 
                session_id,
                FROM_UNIXTIME(expires) as expires_at,
                LENGTH(data) as data_size,
                data
            FROM sessions 
            WHERE expires >= UNIX_TIMESTAMP()
            AND LENGTH(data) < 500
            LIMIT 3
        `);
        
        if (samples.length > 0) {
            console.log('\n📋 Beispiel-Sessions (erste 3):');
            samples.forEach((s, i) => {
                console.log(`\n  ${i+1}. Session-ID: ${s.session_id.substring(0, 20)}...`);
                console.log(`     Läuft ab: ${s.expires_at}`);
                console.log(`     Größe: ${s.data_size} bytes`);
                try {
                    const parsed = JSON.parse(s.data);
                    console.log(`     Cookie: ${parsed.cookie ? 'Ja' : 'Nein'}`);
                    console.log(`     User: ${parsed.user ? 'Authentifiziert' : 'Anonym'}`);
                } catch (e) {
                    console.log(`     Daten: Nicht parsebar`);
                }
            });
        }
        
        // Empfehlungen
        console.log('\n\n💡 EMPFEHLUNGEN:\n');
        console.log('=' .repeat(60));
        
        if (expiredAnon[0].count > 100) {
            console.log('⚠️  AKTION ERFORDERLICH: Viele abgelaufene Sessions!');
            console.log('   → SessionManager-Cleanup läuft möglicherweise nicht');
            console.log('   → Manuelles Cleanup empfohlen');
        }
        
        if (activeAnon[0].count > 50) {
            console.log('ℹ️  Viele aktive anonyme Sessions erkannt');
            console.log('   → Normal wenn viele Besucher ohne Login browsen');
            console.log('   → Werden automatisch nach Ablauf bereinigt');
        }
        
        if (s.authenticated > 0) {
            console.log(`✅ ${s.authenticated} authentifizierte Sessions gefunden`);
            console.log('   → Diese werden NICHT automatisch gelöscht (Schutz)');
        }
        
        console.log('=' .repeat(60));
        
    } catch (error) {
        console.error('❌ Fehler:', error);
    } finally {
        await connection.end();
    }
}

checkSessions()
    .then(() => {
        console.log('\n✅ Session-Check abgeschlossen\n');
        process.exit(0);
    })
    .catch((error) => {
        console.error('FATAL ERROR:', error);
        process.exit(1);
    });
