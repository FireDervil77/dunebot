#!/usr/bin/env node

const mysql = require('mysql2/promise');
require('dotenv').config({ path: './apps/dashboard/.env' });

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE
  });
  
  console.log('🗑️  Lösche alle Permissions mit plain text translation keys...\n');
  
  const result = await conn.query(`
    DELETE FROM permission_definitions 
    WHERE name_translation_key NOT LIKE '%:%'
  `);
  
  console.log(`✅ Gelöscht: ${result[0].affectedRows} Permissions`);
  
  // Zeige verbleibende
  const [remaining] = await conn.query('SELECT COUNT(*) as count FROM permission_definitions');
  console.log(`📊 Verbleibende Permissions: ${remaining[0].count}\n`);
  
  await conn.end();
  process.exit(0);
})();
