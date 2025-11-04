#!/usr/bin/env node

const mysql = require('mysql2/promise');
const fs = require('fs');
require('dotenv').config({ path: './apps/dashboard/.env' });

const GUILD_ID = '1403034310172475416';
const PLUGIN = process.argv[2] || 'core'; // core oder gameserver

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE
  });
  
  console.log(`📦 Lade ${PLUGIN} Permissions aus permissions.json...\n`);
  
  // Lade permissions.json
  const permissionsData = JSON.parse(
    fs.readFileSync(`./plugins/${PLUGIN}/dashboard/permissions.json`, 'utf8')
  );
  
  const pluginName = permissionsData.plugin;
  const permissions = permissionsData.permissions;
  
  console.log(`Plugin: ${pluginName}`);
  console.log(`Permissions: ${permissions.length}\n`);
  
  let inserted = 0;
  let skipped = 0;
  
  // Zwei Durchläufe: 1. Ohne requires, 2. Mit requires
  console.log('🔄 Durchlauf 1: Permissions ohne Dependencies...\n');
  
  for (const perm of permissions.filter(p => !p.requires)) {
    const nameTranslationKey = `${pluginName}:${perm.name}`;
    const descTranslationKey = `${pluginName}:${perm.description}`;
    const permissionKey = `${pluginName}:${perm.key}`;
    
    try {
      const [existing] = await conn.query(
        'SELECT id FROM permission_definitions WHERE guild_id = ? AND permission_key = ?',
        [GUILD_ID, permissionKey]
      );
      
      if (existing.length > 0) {
        console.log(`⏭️  Überspringe: ${permissionKey} (existiert bereits)`);
        skipped++;
        continue;
      }
      
      await conn.query(`
        INSERT INTO permission_definitions (
          guild_id,
          permission_key,
          category,
          name_translation_key,
          description_translation_key,
          is_dangerous,
          requires_permissions,
          plugin_name,
          sort_order,
          is_active
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      `, [
        GUILD_ID,
        permissionKey,
        perm.category,
        nameTranslationKey,
        descTranslationKey,
        perm.is_dangerous || 0,
        null,
        pluginName,
        perm.sort_order || 999
      ]);
      
      console.log(`✅ Eingefügt: ${permissionKey}`);
      inserted++;
      
    } catch (error) {
      console.error(`❌ Fehler bei ${permissionKey}:`, error.message);
    }
  }
  
  console.log('\n🔄 Durchlauf 2: Permissions mit Dependencies...\n');
  
  for (const perm of permissions.filter(p => p.requires)) {
    const nameTranslationKey = `${pluginName}:${perm.name}`;
    const descTranslationKey = `${pluginName}:${perm.description}`;
    const permissionKey = `${pluginName}:${perm.key}`;
    
    try {
      const [existing] = await conn.query(
        'SELECT id FROM permission_definitions WHERE guild_id = ? AND permission_key = ?',
        [GUILD_ID, permissionKey]
      );
      
      if (existing.length > 0) {
        console.log(`⏭️  Überspringe: ${permissionKey} (existiert bereits)`);
        skipped++;
        continue;
      }
      
      // requires_permissions ist ein JSON-Array!
      const requiresJson = JSON.stringify([`${pluginName}:${perm.requires}`]);
      
      await conn.query(`
        INSERT INTO permission_definitions (
          guild_id,
          permission_key,
          category,
          name_translation_key,
          description_translation_key,
          is_dangerous,
          requires_permissions,
          plugin_name,
          sort_order,
          is_active
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      `, [
        GUILD_ID,
        permissionKey,
        perm.category,
        nameTranslationKey,
        descTranslationKey,
        perm.is_dangerous || 0,
        requiresJson,
        pluginName,
        perm.sort_order || 999
      ]);
      
      console.log(`✅ Eingefügt: ${permissionKey}`);
      inserted++;
      
    } catch (error) {
      console.error(`❌ Fehler bei ${permissionKey}:`, error.message);
    }
  }
  
  console.log('\n' + '='.repeat(60));
  console.log(`✅ Erfolgreich eingefügt: ${inserted}`);
  console.log(`⏭️  Übersprungen: ${skipped}`);
  console.log('='.repeat(60));
  
  // Zeige Statistik
  const [stats] = await conn.query(
    'SELECT COUNT(*) as total FROM permission_definitions WHERE guild_id = ?',
    [GUILD_ID]
  );
  console.log(`\n📊 Gesamte Permissions für Guild: ${stats[0].total}\n`);
  
  await conn.end();
  process.exit(0);
})();
