#!/usr/bin/env node
/**
 * Blocked IPs Management Utility
 * 
 * Verwaltet die blocked_ips Datenbank-Tabelle
 * 
 * Usage:
 *   node manage-blocked-ips.js list              # Zeige alle geblockte IPs
 *   node manage-blocked-ips.js unblock <ip>      # IP von Whitelist entfernen
 *   node manage-blocked-ips.js whitelist <ip>    # IP whitelisten (False Positive)
 *   node manage-blocked-ips.js stats             # Statistiken anzeigen
 *   node manage-blocked-ips.js import-from-prod  # Importiere blocked_ips von PROD
 * 
 * @author FireBot Team
 */

require('dotenv').config({ path: require('path').join(__dirname, '../apps/dashboard/.env') });
const mysql = require('mysql2/promise');

// MySQL-Connection erstellen
async function getConnection() {
    return await mysql.createConnection({
        host: process.env.MYSQL_HOST,
        port: process.env.MYSQL_PORT || 3306,
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE
    });
}

/**
 * Liste alle geblockte IPs
 */
async function listBlockedIPs() {
    const conn = await getConnection();
    
    try {
        const [rows] = await conn.query(`
            SELECT 
                ip,
                attempt_count,
                blocked_at,
                last_attempt,
                last_path,
                is_whitelisted,
                notes
            FROM blocked_ips
            ORDER BY blocked_at DESC
        `);
        
        console.log('\n📋 Blocked IPs:\n');
        console.log('IP Address          | Attempts | Blocked At          | Last Attempt        | Whitelisted | Last Path');
        console.log('-'.repeat(140));
        
        rows.forEach(row => {
            const whitelisted = row.is_whitelisted ? '✅ YES' : '❌ NO';
            console.log(
                `${row.ip.padEnd(20)}| ${String(row.attempt_count).padEnd(9)}| ${row.blocked_at.toISOString().substring(0, 19)} | ${row.last_attempt ? row.last_attempt.toISOString().substring(0, 19) : 'N/A'.padEnd(19)} | ${whitelisted.padEnd(12)}| ${row.last_path || 'N/A'}`
            );
        });
        
        console.log(`\nTotal: ${rows.length} blocked IPs\n`);
    } finally {
        await conn.end();
    }
}

/**
 * IP entblocken (aus DB löschen)
 */
async function unblockIP(ip) {
    const conn = await getConnection();
    
    try {
        const [result] = await conn.query('DELETE FROM blocked_ips WHERE ip = ?', [ip]);
        
        if (result.affectedRows > 0) {
            console.log(`✅ IP ${ip} wurde entblockt und aus der Datenbank gelöscht`);
        } else {
            console.log(`⚠️  IP ${ip} war nicht geblockt`);
        }
    } finally {
        await conn.end();
    }
}

/**
 * IP whitelisten (False Positive)
 */
async function whitelistIP(ip, notes = 'False positive') {
    const conn = await getConnection();
    
    try {
        const [result] = await conn.query(
            'UPDATE blocked_ips SET is_whitelisted = TRUE, notes = ? WHERE ip = ?',
            [notes, ip]
        );
        
        if (result.affectedRows > 0) {
            console.log(`✅ IP ${ip} wurde gewhitelistet (False Positive)`);
            console.log(`   Notiz: ${notes}`);
        } else {
            console.log(`⚠️  IP ${ip} nicht in Datenbank gefunden`);
        }
    } finally {
        await conn.end();
    }
}

/**
 * Statistiken anzeigen
 */
async function showStats() {
    const conn = await getConnection();
    
    try {
        // Gesamt-Statistiken
        const [stats] = await conn.query(`
            SELECT 
                COUNT(*) as total,
                SUM(is_whitelisted) as whitelisted,
                SUM(attempt_count) as total_attempts,
                MAX(blocked_at) as last_block
            FROM blocked_ips
        `);
        
        // Top 10 IPs nach Versuchen
        const [topIPs] = await conn.query(`
            SELECT ip, attempt_count, blocked_at
            FROM blocked_ips
            ORDER BY attempt_count DESC
            LIMIT 10
        `);
        
        // IPs nach Datum gruppiert
        const [byDate] = await conn.query(`
            SELECT 
                DATE(blocked_at) as date,
                COUNT(*) as count
            FROM blocked_ips
            GROUP BY DATE(blocked_at)
            ORDER BY date DESC
            LIMIT 7
        `);
        
        console.log('\n📊 Blocked IPs Statistics\n');
        console.log(`Total Blocked IPs:     ${stats[0].total}`);
        console.log(`Whitelisted:           ${stats[0].whitelisted}`);
        console.log(`Active Blocks:         ${stats[0].total - stats[0].whitelisted}`);
        console.log(`Total Exploit Attempts: ${stats[0].total_attempts}`);
        console.log(`Last Block:            ${stats[0].last_block ? stats[0].last_block.toISOString() : 'N/A'}`);
        
        console.log('\n🔝 Top 10 IPs by Attempts:\n');
        topIPs.forEach((row, idx) => {
            console.log(`${idx + 1}. ${row.ip.padEnd(20)} - ${row.attempt_count} attempts (blocked ${row.blocked_at.toISOString()})`);
        });
        
        console.log('\n📅 Blocks by Date (Last 7 Days):\n');
        byDate.forEach(row => {
            console.log(`${row.date.toISOString().substring(0, 10)}: ${row.count} IPs blocked`);
        });
        
        console.log('');
    } finally {
        await conn.end();
    }
}

/**
 * Importiere blocked_ips von PROD-Datenbank
 */
async function importFromProd() {
    const prodConn = await mysql.createConnection({
        host: process.env.MYSQL_HOST,
        port: process.env.MYSQL_PORT || 3306,
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: 'dunebot_prod' // PROD-DB
    });
    
    const devConn = await getConnection(); // DEV-DB
    
    try {
        // Lese PROD-Daten
        const [prodRows] = await prodConn.query('SELECT * FROM blocked_ips');
        console.log(`📥 Importiere ${prodRows.length} IPs von PROD...`);
        
        let imported = 0;
        let skipped = 0;
        
        for (const row of prodRows) {
            try {
                await devConn.query(`
                    INSERT INTO blocked_ips 
                    (ip, first_attempt, blocked_at, attempt_count, last_attempt, last_path, reason, is_whitelisted, notes)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON DUPLICATE KEY UPDATE
                        attempt_count = attempt_count + VALUES(attempt_count),
                        last_attempt = VALUES(last_attempt),
                        last_path = VALUES(last_path)
                `, [
                    row.ip,
                    row.first_attempt,
                    row.blocked_at,
                    row.attempt_count,
                    row.last_attempt,
                    row.last_path,
                    row.reason,
                    row.is_whitelisted,
                    row.notes
                ]);
                imported++;
            } catch (err) {
                skipped++;
                console.error(`⚠️  Skipped ${row.ip}: ${err.message}`);
            }
        }
        
        console.log(`\n✅ Import abgeschlossen:`);
        console.log(`   Importiert: ${imported}`);
        console.log(`   Übersprungen: ${skipped}\n`);
    } finally {
        await prodConn.end();
        await devConn.end();
    }
}

// CLI-Handler
async function main() {
    const args = process.argv.slice(2);
    const command = args[0];
    
    try {
        switch (command) {
            case 'list':
                await listBlockedIPs();
                break;
                
            case 'unblock':
                if (!args[1]) {
                    console.error('❌ IP-Adresse fehlt! Usage: node manage-blocked-ips.js unblock <ip>');
                    process.exit(1);
                }
                await unblockIP(args[1]);
                break;
                
            case 'whitelist':
                if (!args[1]) {
                    console.error('❌ IP-Adresse fehlt! Usage: node manage-blocked-ips.js whitelist <ip> [notes]');
                    process.exit(1);
                }
                await whitelistIP(args[1], args.slice(2).join(' ') || 'False positive');
                break;
                
            case 'stats':
                await showStats();
                break;
                
            case 'import-from-prod':
                await importFromProd();
                break;
                
            default:
                console.log(`
🛡️  Blocked IPs Management Utility

Usage:
  node manage-blocked-ips.js list              # Liste alle geblockte IPs
  node manage-blocked-ips.js unblock <ip>      # IP entblocken (aus DB löschen)
  node manage-blocked-ips.js whitelist <ip>    # IP whitelisten (False Positive)
  node manage-blocked-ips.js stats             # Statistiken anzeigen
  node manage-blocked-ips.js import-from-prod  # Importiere blocked_ips von PROD

Examples:
  node manage-blocked-ips.js list
  node manage-blocked-ips.js unblock 52.178.193.251
  node manage-blocked-ips.js whitelist 192.168.1.1 "Internal server"
  node manage-blocked-ips.js stats
                `);
                process.exit(0);
        }
    } catch (err) {
        console.error('❌ Error:', err.message);
        process.exit(1);
    }
}

main();
