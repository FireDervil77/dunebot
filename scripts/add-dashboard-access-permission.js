#!/usr/bin/env node
/**
 * Script: Add DASHBOARD.ACCESS Permission to all Guilds
 * 
 * Fügt die neue DASHBOARD.ACCESS Permission aus permissions.json
 * zu allen Guilds in permission_definitions hinzu.
 * 
 * @author FireDervil
 * @date 2025-11-01
 */

require('dotenv').config({ path: './apps/dashboard/.env' });
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

(async () => {
  try {
    console.log('=== Add DASHBOARD.ACCESS Permission ===\n');
    
    const conn = await mysql.createConnection({
      host: process.env.MYSQL_HOST,
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE
    });
    
    // Lade permissions.json
    const permissionsPath = path.join(__dirname, '../plugins/core/dashboard/permissions.json');
    const permissionsData = JSON.parse(fs.readFileSync(permissionsPath, 'utf8'));
    
    // Finde DASHBOARD.ACCESS
    const dashboardAccess = permissionsData.permissions.find(p => p.key === 'DASHBOARD.ACCESS');
    
    if (!dashboardAccess) {
      console.error('❌ DASHBOARD.ACCESS nicht in permissions.json gefunden!');
      process.exit(1);
    }
    
    console.log('✅ DASHBOARD.ACCESS in permissions.json gefunden');
    console.log('   Key:', dashboardAccess.key);
    console.log('   Name:', dashboardAccess.name);
    console.log('   Category:', dashboardAccess.category);
    console.log('   Sort Order:', dashboardAccess.sort_order);
    
    // Hole alle Guilds
    const [guilds] = await conn.query('SELECT _id FROM guilds');
    console.log(`\n📋 Füge DASHBOARD.ACCESS zu ${guilds.length} Guilds hinzu...\n`);
    
    let added = 0;
    let skipped = 0;
    
    for (const guild of guilds) {
      const guildId = guild._id;
      
      // Prüfe ob bereits existiert
      const [existing] = await conn.query(
        'SELECT id FROM permission_definitions WHERE guild_id = ? AND permission_key = ?',
        [guildId, 'DASHBOARD.ACCESS']
      );
      
      if (existing.length > 0) {
        console.log(`  Guild ${guildId}: ⏭️  bereits vorhanden`);
        skipped++;
        continue;
      }
      
      // Insert Permission
      await conn.query(`
        INSERT INTO permission_definitions 
        (guild_id, permission_key, category, name_translation_key, description_translation_key, 
         is_dangerous, sort_order, plugin_name, is_active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        guildId,
        dashboardAccess.key,
        dashboardAccess.category,
        dashboardAccess.name,
        dashboardAccess.description,
        dashboardAccess.is_dangerous || 0,
        dashboardAccess.sort_order || 0,
        'core',
        1
      ]);
      
      console.log(`  Guild ${guildId}: ✅ hinzugefügt`);
      added++;
    }
    
    console.log(`\n=== Zusammenfassung ===`);
    console.log(`✅ Hinzugefügt: ${added}`);
    console.log(`⏭️  Übersprungen: ${skipped}`);
    console.log(`📊 Total: ${guilds.length}`);
    
    await conn.end();
    console.log('\n✅ Fertig!');
    
  } catch (error) {
    console.error('❌ Fehler:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
})();
