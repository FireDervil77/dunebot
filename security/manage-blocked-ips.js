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
const { execFileSync } = require('child_process');

// Fallback, falls fail2ban-client nicht abfragbar ist (kein Root).
// Im Normalfall werden die Jails zur Laufzeit ermittelt — siehe discoverJails().
const FAIL2BAN_JAILS_FALLBACK = ['dunebot-exploits', 'dunebot-ddos'];
const IPTABLES_CHAIN = 'DUNEBOT_BLOCKED';

// Jails, die 'audit --fix' NIEMALS automatisch entbannen darf.
//
// Die Klassifikation des Audits stützt sich auf HTTP-Evidenz (blocked_ips.last_path)
// und den PTR. Für SSH-Bans gibt es keine HTTP-Evidenz — und ein PTR wie
// "dslb-xxx.pools.arcor-ip.net" beweist dort GAR NICHTS: SSH-Bruteforce kommt
// massenhaft aus Botnetzen auf gekaperten Heimroutern. Solche IPs wurden hier
// fälschlich als "Endkunden-Anschluss = False Positive" eingestuft und entbannt.
// SSH-Bans müssen einzeln und manuell geprüft werden.
const NEVER_AUTO_UNBAN = ['sshd'];

/**
 * Ermittelt ALLE aktiven fail2ban-Jails statt einer hartkodierten Liste.
 *
 * Wichtig: Neben den dunebot-* Jails bannen auch die Debian-Standard-Jails
 * (apache-badbots, apache-noscript, apache-overflows, apache-auth) und die
 * adminapp-* Jails — teils mit bantime = -1. Eine hartkodierte Liste hat diese
 * Bans beim Audit komplett übersehen, sodass "entbannte" Nutzer weiter
 * ausgesperrt blieben.
 */
function discoverJails() {
    try {
        const out = execFileSync('fail2ban-client', ['status'], { stdio: 'pipe' }).toString();
        const match = out.match(/Jail list:\s*(.+)/);
        if (match) {
            const jails = match[1].split(',').map(j => j.trim()).filter(Boolean);
            if (jails.length > 0) return jails;
        }
    } catch {
        // fail2ban-client nicht erreichbar (meist: kein Root)
    }
    return FAIL2BAN_JAILS_FALLBACK;
}

/**
 * IP-Format validieren (IPv4/IPv6) — Schutz vor Shell-Injection,
 * bevor die IP an fail2ban-client/iptables übergeben wird
 */
function isValidIP(ip) {
    const ipv4 = /^(\d{1,3}\.){3}\d{1,3}$/;
    const ipv6 = /^[0-9a-fA-F:]+$/;
    return ipv4.test(ip) || (ip.includes(':') && ipv6.test(ip));
}

/**
 * Entfernt eine IP aus ALLEN Enforcement-Ebenen außerhalb der DB:
 * fail2ban-Jails und iptables-Chain (DUNEBOT_BLOCKED).
 * Best-Effort: Braucht Root — ohne Root werden die manuellen Befehle ausgegeben.
 * (Die Express-Ebene liest die DB-Whitelist selbst, live — kein Neustart nötig.)
 */
function releaseFromEnforcement(ip) {
    if (!isValidIP(ip)) {
        console.error(`❌ Ungültige IP-Adresse: ${ip}`);
        return;
    }

    const isRoot = process.getuid && process.getuid() === 0;
    const failedCommands = [];

    // 1. fail2ban: aus allen Jails unbannen
    for (const jail of discoverJails()) {
        const cmd = ['fail2ban-client', 'set', jail, 'unbanip', ip];
        try {
            execFileSync(cmd[0], cmd.slice(1), { stdio: 'pipe' });
            console.log(`✅ fail2ban: ${ip} aus Jail '${jail}' entbannt`);
        } catch (err) {
            const msg = (err.stderr || err.message || '').toString();
            if (msg.includes('is not banned') || msg.includes('NOK')) {
                // IP war in diesem Jail nicht gebannt — kein Fehler
                console.log(`ℹ️  fail2ban: ${ip} war in Jail '${jail}' nicht gebannt`);
            } else {
                failedCommands.push(`sudo ${cmd.join(' ')}`);
            }
        }
    }

    // 2. iptables: aus der DUNEBOT_BLOCKED-Chain entfernen (falls Chain noch existiert)
    const iptCmd = ['iptables', '-D', IPTABLES_CHAIN, '-s', ip, '-j', 'DROP'];
    try {
        execFileSync(iptCmd[0], iptCmd.slice(1), { stdio: 'pipe' });
        console.log(`✅ iptables: ${ip} aus Chain ${IPTABLES_CHAIN} entfernt`);
    } catch (err) {
        const msg = (err.stderr || err.message || '').toString();
        if (msg.includes('No chain') || msg.includes('does not exist') || msg.includes('Bad rule')) {
            // Chain existiert nicht (mehr) oder Regel nicht vorhanden — okay
            console.log(`ℹ️  iptables: keine Regel für ${ip} in ${IPTABLES_CHAIN} (Chain fehlt oder Regel nicht vorhanden)`);
        } else {
            failedCommands.push(`sudo ${iptCmd.join(' ')}`);
        }
    }

    if (failedCommands.length > 0) {
        console.log('\n⚠️  Folgende Schritte brauchen Root — bitte manuell ausführen:');
        failedCommands.forEach(cmd => console.log(`   ${cmd}`));
        if (!isRoot) {
            console.log('   (Oder das ganze Kommando mit sudo wiederholen: sudo node manage-blocked-ips.js ...)');
        }
    }
}

// ============================================================================
// Klassifikations-Muster für das audit-Kommando
// ============================================================================

// Endkunden-ISPs (PTR-Muster): Bans hier sind fast immer False Positives
const RESIDENTIAL_PTR = /vodafone|kabel-deutschland|kabeldeutschland|unitymedia|unity-media|kabelbw|arcor|t-ipconnect|telefonica|o2online|netcologne|m-net|mnet-online|pyur|versanet|ewe-ip|osnanet|alice-dsl|1und1|kabelmail|virginm\.net|btinternet|sky\.(com|net)|plus\.net|talktalk|telenet\.be|proximus|ziggo|kpn\.net|xs4all|orange\.(fr|net)|wanadoo|sfr\.net|bbox\.fr|free\.fr|swisscom|bluewin|a1\.net|chello|upc\.|magenta|drei\.com|comcast|verizon|rr\.com|charter\.com|cox\.net|sbcglobal|shawcable|rogers\.com|bell\.ca|videotron|telus\.net|optusnet|bigpond|tpgi\.com/i;

// Suchmaschinen-/Dienst-Crawler (PTR-Muster): nie bannen
const CRAWLER_PTR = /googlebot\.com|google\.com|search\.msn\.com|crawl\.yandex|applebot|petalsearch|crawl\.baidu|duckduckgo/i;

// Eindeutig bösartige Pfade (aus blocked_ips.last_path): Angreifer trotz Endkunden-PTR
const ATTACK_PATH = /\.(php|env|git|aws|ssh)|wp-login|wp-admin|phpmyadmin|sqladmin|credentials|backup|\/etc\/passwd|\.\.\/|cgi-bin|xmlrpc|actuator|HNAP/i;

/**
 * Reverse-DNS mit Timeout
 */
async function ptrLookup(ip) {
    const dns = require('dns').promises;
    try {
        const names = await Promise.race([
            dns.reverse(ip),
            new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000))
        ]);
        return names[0] || null;
    } catch {
        return null;
    }
}

/**
 * Liefert die gebannten IPs eines fail2ban-Jails (braucht Root).
 * Gibt null zurück, wenn das Jail nicht existiert oder keine Rechte bestehen.
 */
function getJailBans(jail) {
    try {
        const out = execFileSync('fail2ban-client', ['get', jail, 'banned'], { stdio: 'pipe' }).toString();
        return out.match(/(\d{1,3}\.){3}\d{1,3}/g) || [];
    } catch {
        return null;
    }
}

/**
 * status <ip>: Zeigt den Block-Zustand einer IP über ALLE Ebenen
 * (DB, alle fail2ban-Jails, iptables-Chain) in einem Aufruf.
 */
async function statusIP(ip) {
    if (!isValidIP(ip)) {
        console.error(`❌ Ungültige IP-Adresse: ${ip}`);
        return;
    }

    console.log(`\n🔎 Status für ${ip}:\n`);

    // 1. Datenbank (Express-Ebene)
    let dbPath = null;
    const conn = await getConnection();
    try {
        const [rows] = await conn.query(
            'SELECT attempt_count, blocked_at, last_attempt, last_path, is_whitelisted, notes FROM blocked_ips WHERE ip = ?',
            [ip]
        );
        if (rows.length === 0) {
            console.log('  DB (Express):     nicht in blocked_ips');
        } else {
            const r = rows[0];
            if (!r.is_whitelisted) dbPath = r.last_path || '';
            console.log(`  DB (Express):     ${r.is_whitelisted ? '✅ WHITELISTED' : '🚫 GEBLOCKT'} — ${r.attempt_count} Versuche, seit ${r.blocked_at.toISOString().slice(0, 10)}`);
            console.log(`                    letzter Pfad: ${r.last_path || '—'}${r.notes ? ` | Notiz: ${r.notes}` : ''}`);
        }
    } finally {
        await conn.end();
    }

    // 2. fail2ban-Jails
    for (const jail of discoverJails()) {
        const bans = getJailBans(jail);
        if (bans === null) {
            console.log(`  fail2ban ${jail.padEnd(17)}: ⚠️  nicht abfragbar (Root nötig? Jail existiert?)`);
        } else {
            console.log(`  fail2ban ${jail.padEnd(17)}: ${bans.includes(ip) ? '🚫 GEBANNT' : 'frei'}`);
        }
    }

    // 3. iptables-Chain
    try {
        const out = execFileSync('iptables', ['-L', IPTABLES_CHAIN, '-n'], { stdio: 'pipe' }).toString();
        console.log(`  iptables ${IPTABLES_CHAIN}: ${out.includes(ip) ? '🚫 DROP-Regel aktiv' : 'frei'}`);
    } catch {
        console.log(`  iptables ${IPTABLES_CHAIN}: Chain existiert nicht oder Root nötig`);
    }

    // 4. PTR zur Einordnung (gleiche Logik wie audit: Exploit-Evidenz schlägt PTR)
    const ptr = await ptrLookup(ip);
    console.log(`  Reverse-DNS:      ${ptr || 'kein PTR'}`);
    if (dbPath && ATTACK_PATH.test(dbPath)) {
        console.log(`  Einordnung:       💀 Angreifer (Exploit-Evidenz in DB${ptr && RESIDENTIAL_PTR.test(ptr) ? ' — vermutlich kompromittiertes Endkunden-Gerät' : ''})`);
    } else if (ptr && CRAWLER_PTR.test(ptr)) {
        console.log('  Einordnung:       🤖 Suchmaschinen-Crawler — sollte NIE gebannt sein!');
    } else if (ptr && RESIDENTIAL_PTR.test(ptr)) {
        console.log('  Einordnung:       🏠 Endkunden-Anschluss — wahrscheinlich False Positive');
    }
    console.log('');
}

/**
 * audit [--fix]: Klassifiziert ALLE fail2ban-Bans automatisch.
 * Findet Crawler und Endkunden-Anschlüsse (= wahrscheinliche False Positives)
 * und Inkonsistenzen (in DB whitelisted, aber noch gebannt).
 * Mit --fix werden die gefundenen False Positives direkt entbannt (Root nötig).
 */
async function auditBans(fix = false) {
    console.log('\n🔍 Audit: Sammle Bans aus allen fail2ban-Jails...\n');

    // 1. Bans aus allen Jails einsammeln (ip -> [jails])
    const bansByIP = new Map();
    const jails = discoverJails();
    console.log(`   Gefundene Jails: ${jails.join(', ')}\n`);
    for (const jail of jails) {
        const bans = getJailBans(jail);
        if (bans === null) {
            console.log(`⚠️  Jail '${jail}' nicht abfragbar — mit sudo ausführen für vollständiges Audit`);
            continue;
        }
        console.log(`   ${jail}: ${bans.length} Bans`);
        for (const ip of bans) {
            if (!bansByIP.has(ip)) bansByIP.set(ip, []);
            bansByIP.get(ip).push(jail);
        }
    }
    if (bansByIP.size === 0) {
        console.log('\nKeine fail2ban-Bans gefunden (oder keine Rechte). Fertig.');
        return;
    }

    // 2. DB-Kontext laden (Exploit-Evidenz + Whitelist)
    const conn = await getConnection();
    let dbBlocked = new Map(), dbWhitelisted = new Set();
    try {
        const [rows] = await conn.query('SELECT ip, last_path, is_whitelisted FROM blocked_ips');
        for (const r of rows) {
            if (r.is_whitelisted) dbWhitelisted.add(r.ip);
            else dbBlocked.set(r.ip, r.last_path || '');
        }
    } finally {
        await conn.end();
    }

    // 3. PTR-Lookups (Concurrency 30)
    console.log(`\n   Reverse-DNS für ${bansByIP.size} IPs (dauert etwas)...`);
    const entries = [...bansByIP.entries()].map(([ip, jails]) => ({ ip, jails }));
    const queue = [...entries];
    async function worker() {
        while (queue.length > 0) {
            const e = queue.shift();
            e.ptr = await ptrLookup(e.ip);
        }
    }
    await Promise.all(Array.from({ length: 30 }, worker));

    // 4. Klassifizieren
    const crawlers = [], residential = [], whitelistedButBanned = [], attackers = [], unknown = [];
    for (const e of entries) {
        const dbPath = dbBlocked.get(e.ip);
        if (dbWhitelisted.has(e.ip)) { whitelistedButBanned.push(e); continue; }
        if (e.ptr && CRAWLER_PTR.test(e.ptr)) { crawlers.push(e); continue; }
        if (dbPath && ATTACK_PATH.test(dbPath)) { attackers.push({ ...e, dbPath }); continue; }
        if (e.ptr && RESIDENTIAL_PTR.test(e.ptr)) { residential.push(e); continue; }
        unknown.push(e);
    }

    // 5. Report
    console.log('\n========== AUDIT-ERGEBNIS ==========');
    console.log(`Gesamt gebannt:                        ${entries.length}`);
    console.log(`  Angreifer (Exploit-Evidenz in DB):   ${attackers.length}`);
    console.log(`  🤖 Crawler (FALSE POSITIVE!):         ${crawlers.length}`);
    console.log(`  🏠 Endkunden-Anschluss (FP-Verdacht): ${residential.length}`);
    console.log(`  ⚠️  In DB whitelisted, aber gebannt:  ${whitelistedButBanned.length}`);
    console.log(`  Unklar (kein PTR/keine Evidenz):     ${unknown.length}`);

    const falsePositives = [...crawlers, ...residential, ...whitelistedButBanned];
    if (falsePositives.length > 0) {
        console.log('\n=== FALSE POSITIVES / INKONSISTENZEN ===');
        for (const e of falsePositives) {
            console.log(`${e.ip.padEnd(18)} | Jails: ${e.jails.join(', ').padEnd(35)} | ${e.ptr || 'kein PTR'}`);
        }

        if (fix) {
            console.log('\n🔧 --fix: Entbanne False Positives (nur HTTP-Jails)...');
            const skipped = [];
            for (const e of falsePositives) {
                for (const jail of e.jails) {
                    if (NEVER_AUTO_UNBAN.includes(jail)) {
                        skipped.push(`${e.ip} (${jail})`);
                        continue;
                    }
                    try {
                        execFileSync('fail2ban-client', ['set', jail, 'unbanip', e.ip], { stdio: 'pipe' });
                        console.log(`✅ ${e.ip} aus '${jail}' entbannt`);
                    } catch (err) {
                        console.log(`❌ ${e.ip} aus '${jail}': ${(err.stderr || err.message).toString().trim()}`);
                    }
                }
            }
            if (skipped.length > 0) {
                console.log(`\n🔒 ${skipped.length} Bans NICHT angefasst (Jail in NEVER_AUTO_UNBAN):`);
                skipped.forEach(s => console.log(`   ${s}`));
                console.log('   Diese bei Bedarf einzeln prüfen: manage-blocked-ips.js status <ip>');
            }
        } else {
            console.log('\nZum automatischen Entbannen: sudo "$(which node)" manage-blocked-ips.js audit --fix');
        }
    } else {
        console.log('\n✅ Keine False Positives gefunden.');
    }
    console.log('');
}

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

    // Auch aus fail2ban + iptables entfernen (zentrales Entsperren)
    releaseFromEnforcement(ip);
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
            // IP noch gar nicht in der DB? Als Whitelist-Eintrag anlegen,
            // damit der Express-Blocker sie künftig überspringt
            await conn.query(
                `INSERT INTO blocked_ips (ip, first_attempt, blocked_at, attempt_count, is_whitelisted, notes)
                 VALUES (?, NOW(), NOW(), 0, TRUE, ?)`,
                [ip, notes]
            );
            console.log(`✅ IP ${ip} war nicht in der DB — Whitelist-Eintrag neu angelegt`);
            console.log(`   Notiz: ${notes}`);
        }
    } finally {
        await conn.end();
    }

    // Auch aus fail2ban + iptables entfernen (zentrales Entsperren)
    releaseFromEnforcement(ip);
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

            case 'status':
                if (!args[1]) {
                    console.error('❌ IP-Adresse fehlt! Usage: node manage-blocked-ips.js status <ip>');
                    process.exit(1);
                }
                await statusIP(args[1]);
                break;

            case 'audit':
                await auditBans(args.includes('--fix'));
                break;
                
            case 'import-from-prod':
                await importFromProd();
                break;
                
            default:
                console.log(`
🛡️  Blocked IPs Management Utility

Usage:
  node manage-blocked-ips.js list              # Liste alle geblockte IPs
  node manage-blocked-ips.js status <ip>       # Block-Zustand EINER IP über alle Ebenen
  node manage-blocked-ips.js audit [--fix]     # ALLE fail2ban-Bans klassifizieren,
                                               # False Positives finden (--fix: entbannen)
  node manage-blocked-ips.js unblock <ip>      # IP entblocken (DB + fail2ban + iptables)
  node manage-blocked-ips.js whitelist <ip>    # IP whitelisten (DB + fail2ban + iptables)
  node manage-blocked-ips.js stats             # Statistiken anzeigen
  node manage-blocked-ips.js import-from-prod  # Importiere blocked_ips von PROD

Hinweis: unblock/whitelist entfernen die IP aus ALLEN Ebenen (DB-Whitelist wirkt
auf Express-Ebene sofort, ohne Neustart). fail2ban/iptables brauchen Root —
dafür das Kommando mit sudo ausführen, sonst werden die Befehle nur angezeigt.
Node ist per nvm installiert: mit sudo daher 'sudo "\$(which node)" ...' nutzen.

Examples:
  node manage-blocked-ips.js list
  sudo "\$(which node)" manage-blocked-ips.js unblock 52.178.193.251
  sudo "\$(which node)" manage-blocked-ips.js whitelist 192.168.1.1 "Internal server"
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
