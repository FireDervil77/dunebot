#!/usr/bin/env node
/**
 * Test-Script: Prüfe Permission-System nach Plugin-Aktivierung
 */

require('dotenv').config({ path: './apps/dashboard/.env' });
const mysql = require('mysql2/promise');

const GUILD_ID = '1403034310172475416';

(async () => {
  console.log('🧪 Teste Permission-System...\n');
  
  const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE
  });
  
  console.log('✅ DB verbunden\n');
  
  // ═══════════════════════════════════════════════════════════
  // 1. PERMISSION_DEFINITIONS
  // ═══════════════════════════════════════════════════════════
  
  const [perms] = await conn.query(
    'SELECT id, plugin_name, permission_key, category, is_active FROM permission_definitions WHERE guild_id = ? ORDER BY plugin_name, sort_order',
    [GUILD_ID]
  );
  
  console.log('═══════════════════════════════════════════════════════════');
  console.log('📋 permission_definitions');
  console.log('═══════════════════════════════════════════════════════════\n');
  
  const byPlugin = {};
  perms.forEach(p => {
    const plugin = p.plugin_name || '(null)';
    if (!byPlugin[plugin]) byPlugin[plugin] = [];
    byPlugin[plugin].push(p);
  });
  
  Object.keys(byPlugin).sort().forEach(plugin => {
    const list = byPlugin[plugin];
    const active = list.filter(p => p.is_active).length;
    console.log(`🔌 ${plugin.toUpperCase()} (${active}/${list.length} aktiv)`);
    list.forEach(p => {
      const icon = p.is_active ? '✓' : '✗';
      console.log(`   ${icon} ${p.permission_key}`);
      console.log(`      → Category: ${p.category || '(none)'}`);
    });
    console.log('');
  });
  
  console.log(`📊 GESAMT: ${perms.length} Permissions registriert`);
  console.log(`   Aktiv: ${perms.filter(p => p.is_active).length}`);
  console.log(`   Inaktiv: ${perms.filter(p => !p.is_active).length}\n`);
  
  // ═══════════════════════════════════════════════════════════
  // 2. GROUP_PERMISSIONS
  // ═══════════════════════════════════════════════════════════
  
  const [assignments] = await conn.query(`
    SELECT 
      gp.id,
      gp.group_id,
      gg.name as group_name,
      pd.plugin_name,
      pd.permission_key,
      gp.is_inherited,
      gp.grant_option,
      gp.assigned_by
    FROM group_permissions gp
    JOIN permission_definitions pd ON gp.permission_id = pd.id
    JOIN guild_groups gg ON gp.group_id = gg.id
    WHERE pd.guild_id = ?
    ORDER BY gg.name, pd.plugin_name, pd.permission_key
  `, [GUILD_ID]);
  
  console.log('═══════════════════════════════════════════════════════════');
  console.log('🔗 group_permissions (Zuweisungen)');
  console.log('═══════════════════════════════════════════════════════════\n');
  
  if (assignments.length === 0) {
    console.log('⚠️  Keine Zuweisungen gefunden!');
    console.log('   → Alle Gruppen nutzen Default-Permissions\n');
  } else {
    const byGroup = {};
    assignments.forEach(a => {
      if (!byGroup[a.group_name]) byGroup[a.group_name] = [];
      byGroup[a.group_name].push(a);
    });
    
    Object.keys(byGroup).sort().forEach(group => {
      console.log(`👥 ${group} (${byGroup[group].length} assignments)`);
      byGroup[group].forEach(a => {
        const flags = [];
        if (a.is_inherited) flags.push('inherited');
        if (a.grant_option) flags.push('can grant');
        const flagStr = flags.length ? ` [${flags.join(', ')}]` : '';
        console.log(`   ✅ ${a.plugin_name}.${a.permission_key}${flagStr}`);
      });
      console.log('');
    });
    
    console.log(`📊 GESAMT: ${assignments.length} Zuweisungen\n`);
  }
  
  // ═══════════════════════════════════════════════════════════
  // 3. INTEGRITÄTS-CHECK
  // ═══════════════════════════════════════════════════════════
  
  console.log('═══════════════════════════════════════════════════════════');
  console.log('🔍 Integritäts-Check');
  console.log('═══════════════════════════════════════════════════════════\n');
  
  // Verwaiste group_permissions
  const [orphaned] = await conn.query(`
    SELECT gp.id, gp.group_id, gp.permission_id
    FROM group_permissions gp
    LEFT JOIN permission_definitions pd ON gp.permission_id = pd.id
    WHERE pd.id IS NULL
  `);
  
  if (orphaned.length > 0) {
    console.log(`❌ WARNUNG: ${orphaned.length} verwaiste group_permissions gefunden!`);
    console.log('   → CASCADE DELETE funktioniert nicht korrekt!');
    orphaned.forEach(o => {
      console.log(`   - ID: ${o.id}, permission_id: ${o.permission_id}, group_id: ${o.group_id}`);
    });
  } else {
    console.log('✅ Keine verwaisten Einträge - CASCADE funktioniert korrekt!');
  }
  
  // Foreign Keys prüfen
  const [fks] = await conn.query(`
    SELECT 
      rc.CONSTRAINT_NAME,
      kcu.TABLE_NAME,
      kcu.COLUMN_NAME,
      kcu.REFERENCED_TABLE_NAME,
      kcu.REFERENCED_COLUMN_NAME,
      rc.DELETE_RULE,
      rc.UPDATE_RULE
    FROM information_schema.REFERENTIAL_CONSTRAINTS rc
    JOIN information_schema.KEY_COLUMN_USAGE kcu 
      ON rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
      AND rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
    WHERE rc.CONSTRAINT_SCHEMA = ? 
      AND kcu.TABLE_NAME IN ('group_permissions', 'permission_definitions')
      AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
  `, [process.env.MYSQL_DATABASE]);
  
  console.log('\n🔗 Foreign Key Constraints:\n');
  if (fks.length === 0) {
    console.log('⚠️  Keine Foreign Keys gefunden - CASCADE ist nicht aktiv!');
  } else {
    fks.forEach(fk => {
      console.log(`   - ${fk.TABLE_NAME}.${fk.COLUMN_NAME}`);
      console.log(`      → ${fk.REFERENCED_TABLE_NAME}.${fk.REFERENCED_COLUMN_NAME}`);
      console.log(`      → ON DELETE: ${fk.DELETE_RULE}, ON UPDATE: ${fk.UPDATE_RULE}`);
    });
  }
  
  await conn.end();
  console.log('\n✅ Analyse abgeschlossen!\n');
})();
