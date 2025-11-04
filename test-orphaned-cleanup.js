#!/usr/bin/env node

/**
 * Test-Script für Orphaned Server Cleanup
 * Testet die neue gameserver.cleanup_orphaned Funktion im Daemon
 * 
 * Usage:
 *   node test-orphaned-cleanup.js
 * 
 * Was es macht:
 *   1. Holt alle aktiven MySQL gameservers
 *   2. Sendet cleanup_orphaned Command an Daemon
 *   3. Zeigt Statistiken (removed systemd services, SQLite entries)
 */

require('dotenv').config({ path: './apps/dashboard/.env' });
const mysql = require('mysql2/promise');

async function main() {
  console.log('🧹 Orphaned Server Cleanup Test\n');

  // MySQL Connection
  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    port: process.env.MYSQL_PORT || 3306,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE
  });

  console.log('✅ MySQL verbunden\n');

  // 1. Alle aktiven Gameserver-IDs aus MySQL holen
  const [servers] = await connection.query(`
    SELECT id, name, status 
    FROM gameservers 
    ORDER BY id
  `);

  console.log(`📊 Gefundene MySQL-Server: ${servers.length}`);
  servers.forEach(s => {
    console.log(`   - ID ${s.id}: ${s.name} (${s.status})`);
  });

  const validMySQLIDs = servers.map(s => s.id);
  console.log(`\n✅ Gültige MySQL-IDs: [${validMySQLIDs.join(', ')}]\n`);

  // 2. IPM Command an Daemon senden (simuliert)
  console.log('⚠️  IPM-Integration noch nicht implementiert!');
  console.log('Payload für Dashboard → Daemon:');
  console.log(JSON.stringify({
    type: 'command',
    id: 'test-' + Date.now(),
    command: 'gameserver.cleanup_orphaned',
    payload: {
      valid_mysql_ids: validMySQLIDs,
      remove_files: false // Nur systemd-Services, keine Dateien
    }
  }, null, 2));

  console.log('\n📝 Manueller Test:');
  console.log('1. Öffne Daemon-Logs: sudo journalctl -u firebot-daemon -f');
  console.log('2. Sende Command via Dashboard IPMServer');
  console.log('3. Prüfe Output: checked_systemd, removed_systemd, errors\n');

  await connection.end();
}

main().catch(err => {
  console.error('❌ Fehler:', err);
  process.exit(1);
});
