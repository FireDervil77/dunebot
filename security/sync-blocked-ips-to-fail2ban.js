#!/usr/bin/env node

/**
 * Sync Blocked IPs to fail2ban
 * 
 * Dieses Script liest alle geblockten IPs aus der Datenbank und schreibt sie
 * in /var/log/dunebot-exploits.log, damit fail2ban sie in iptables blockiert.
 * 
 * Usage: sudo node scripts/sync-blocked-ips-to-fail2ban.js
 */

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '../apps/dashboard/.env') });

const LOG_PATH = '/var/log/dunebot-exploits.log';

async function main() {
    console.log('🔄 Synchronisiere geblockte IPs mit fail2ban...\n');
    
    // DB-Verbindung
    const conn = await mysql.createConnection({
        host: process.env.MYSQL_HOST,
        port: process.env.MYSQL_PORT || 3306,
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE
    });
    
    try {
        // Alle geblockten IPs aus DB
        const [rows] = await conn.query(`
            SELECT ip, created_at, attempt_count, last_path 
            FROM blocked_ips 
            ORDER BY created_at ASC
        `);
        
        console.log(`📊 Gefunden: ${rows.length} geblockte IPs in Datenbank`);
        
        if (rows.length === 0) {
            console.log('✅ Keine IPs zu synchronisieren.');
            return;
        }
        
        // Prüfe ob Log-File existiert
        if (!fs.existsSync(LOG_PATH)) {
            console.log(`⚠️  Log-File existiert nicht: ${LOG_PATH}`);
            console.log('   Erstelle neue Datei...');
            fs.writeFileSync(LOG_PATH, '', { mode: 0o644 });
            
            // Ownership auf www-data setzen (wenn als root ausgeführt)
            if (process.getuid() === 0) {
                const { execSync } = require('child_process');
                execSync(`chown www-data:www-data ${LOG_PATH}`);
                console.log('   ✅ Ownership gesetzt: www-data:www-data');
            }
        }
        
        // Aktuellen Inhalt lesen (um Duplikate zu vermeiden)
        let existingContent = fs.readFileSync(LOG_PATH, 'utf8');
        const existingIPs = new Set();
        
        // Extrahiere bereits vorhandene IPs
        const ipRegex = /^([\d.]+) -/gm;
        let match;
        while ((match = ipRegex.exec(existingContent)) !== null) {
            existingIPs.add(match[1]);
        }
        
        console.log(`📄 Log-File hat bereits ${existingIPs.size} Einträge\n`);
        
        // Neue Einträge generieren
        let newEntries = 0;
        const logLines = [];
        
        for (const row of rows) {
            const ip = row.ip;
            
            // Überspringe wenn bereits im Log
            if (existingIPs.has(ip)) {
                continue;
            }
            
            // Apache Combined Log Format für fail2ban
            const timestamp = new Date(row.created_at).toISOString();
            const path = row.last_path || '/exploit-scan';
            const attempts = row.attempt_count || 2;
            
            const logLine = `${ip} - - [${timestamp}] "GET ${path} HTTP/1.1" 403 0 "-" "EXPLOIT-SCANNER" (${attempts} attempts)\n`;
            logLines.push(logLine);
            newEntries++;
            
            console.log(`  ➕ ${ip.padEnd(18)} (${attempts} Versuche)`);
        }
        
        if (newEntries === 0) {
            console.log('\n✅ Alle IPs sind bereits synchronisiert!');
            return;
        }
        
        // Schreibe neue Einträge in Log-File
        console.log(`\n📝 Schreibe ${newEntries} neue Einträge in ${LOG_PATH}...`);
        fs.appendFileSync(LOG_PATH, logLines.join(''));
        
        console.log('✅ Log-File aktualisiert!');
        console.log('\n🔥 fail2ban sollte die IPs jetzt automatisch in iptables blockieren!');
        console.log('   Prüfe Status: sudo fail2ban-client status dunebot-exploits');
        
    } finally {
        await conn.end();
    }
}

// Run
main().catch(err => {
    console.error('❌ Fehler:', err.message);
    process.exit(1);
});
