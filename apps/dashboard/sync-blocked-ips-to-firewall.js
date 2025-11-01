#!/usr/bin/env node
/**
 * Sync Blocked IPs to iptables
 * 
 * Liest blocked_ips aus der Datenbank und blockt sie auf Firewall-Ebene
 * - Erstellt iptables-Regeln für jede IP
 * - Muss als Root oder mit sudo ausgeführt werden
 * - Sollte als Cronjob laufen (z.B. alle 5 Minuten)
 * 
 * Usage:
 *   sudo node sync-blocked-ips-to-firewall.js
 *   oder als Cronjob:
 *   (crontab) slash-five slash-asterisk slash-asterisk slash-asterisk slash-asterisk sudo node /path/to/sync-blocked-ips-to-firewall.js
 * 
 * @author FireBot Team
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const mysql = require('mysql2/promise');
const { execSync } = require('child_process');

const CHAIN_NAME = 'DUNEBOT_BLOCKED';

async function main() {
    console.log('[Firewall-Sync] Starting...');
    
    // DB-Verbindung
    const connection = await mysql.createConnection({
        host: process.env.MYSQL_HOST,
        port: process.env.MYSQL_PORT || 3306,
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE
    });

    try {
        // Alle geblockten IPs aus DB laden
        const [rows] = await connection.query(
            'SELECT ip FROM blocked_ips WHERE is_whitelisted = FALSE'
        );

        console.log(`[Firewall-Sync] Found ${rows.length} blocked IPs in database`);

        // iptables Chain erstellen (falls nicht vorhanden)
        try {
            execSync(`iptables -N ${CHAIN_NAME} 2>/dev/null || true`);
        } catch (error) {
            // Chain existiert bereits - ignorieren
        }

        // Chain in INPUT einhängen (falls nicht bereits)
        const inputRules = execSync('iptables -L INPUT -n --line-numbers').toString();
        if (!inputRules.includes(CHAIN_NAME)) {
            execSync(`iptables -I INPUT 1 -j ${CHAIN_NAME}`);
            console.log(`[Firewall-Sync] Created chain ${CHAIN_NAME}`);
        }

        // Alle bestehenden Regeln in der Chain löschen
        execSync(`iptables -F ${CHAIN_NAME}`);
        console.log(`[Firewall-Sync] Flushed chain ${CHAIN_NAME}`);

        // Neue Regeln hinzufügen
        let blocked = 0;
        for (const row of rows) {
            const ip = row.ip;
            try {
                // DROP alle Pakete von dieser IP
                execSync(`iptables -A ${CHAIN_NAME} -s ${ip} -j DROP`);
                blocked++;
            } catch (error) {
                console.error(`[Firewall-Sync] Failed to block ${ip}:`, error.message);
            }
        }

        console.log(`[Firewall-Sync] Successfully blocked ${blocked} IPs at firewall level`);
        console.log('[Firewall-Sync] Done!');

    } catch (error) {
        console.error('[Firewall-Sync] Error:', error);
        process.exit(1);
    } finally {
        await connection.end();
    }
}

// Permission-Check
if (process.getuid && process.getuid() !== 0) {
    console.error('[Firewall-Sync] ERROR: This script must be run as root!');
    console.error('Usage: sudo node sync-blocked-ips-to-firewall.js');
    process.exit(1);
}

main().catch(console.error);
