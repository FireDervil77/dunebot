const mysql = require('mysql2/promise');
require('dotenv').config({ path: './apps/dashboard/.env' });

const colors = {
    reset: '\x1b[0m', bright: '\x1b[1m', red: '\x1b[31m', green: '\x1b[32m',
    yellow: '\x1b[33m', blue: '\x1b[34m', cyan: '\x1b[36m', magenta: '\x1b[35m'
};

function header(msg) {
    console.log(`\n${colors.bright}${colors.cyan}${'='.repeat(70)}${colors.reset}`);
    console.log(`${colors.bright}${colors.cyan}${msg}${colors.reset}`);
    console.log(`${colors.cyan}${'='.repeat(70)}${colors.reset}\n`);
}

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE
  });
  
  header('BERECHTIGUNGSSYSTEM - VOLLSTÄNDIGE ANALYSE');
  
  // 1. PERMISSIONS
  console.log('📋 1. PERMISSION DEFINITIONS (Registrierte Berechtigungen):\n');
  const [perms] = await conn.query(`
    SELECT plugin_name, category, COUNT(*) as count
    FROM permission_definitions
    WHERE guild_id = '1403034310172475416'
    GROUP BY plugin_name, category
    ORDER BY plugin_name, category
  `);
  console.table(perms);
  
  const [totalPerms] = await conn.query(`
    SELECT COUNT(*) as total FROM permission_definitions 
    WHERE guild_id = '1403034310172475416'
  `);
  console.log(`${colors.green}✅ Gesamt: ${totalPerms[0].total} Berechtigungen${colors.reset}\n`);
  
  // 2. GROUPS
  header('2. GUILD GROUPS (Rollen)');
  const [groups] = await conn.query(`
    SELECT id, name, slug, is_default, is_protected, priority, member_count, permissions_migrated
    FROM guild_groups
    WHERE guild_id = '1403034310172475416'
    ORDER BY priority DESC
  `);
  console.table(groups);
  console.log(`${colors.green}✅ ${groups.length} Groups gefunden${colors.reset}\n`);
  
  // 3. PERMISSIONS PRO GROUP
  header('3. GROUP PERMISSIONS (Zuweisungen)');
  for (const group of groups) {
    const [assigned] = await conn.query(`
      SELECT 
        pd.plugin_name,
        pd.category,
        pd.permission_key,
        pd.name_translation_key,
        gp.assigned_at,
        gp.is_inherited
      FROM group_permissions gp
      JOIN permission_definitions pd ON gp.permission_id = pd.id
      WHERE gp.group_id = ?
      ORDER BY pd.plugin_name, pd.category, pd.permission_key
    `, [group.id]);
    
    console.log(`\n${colors.bright}👥 ${group.name}${colors.reset} (ID: ${group.id}, Priority: ${group.priority})`);
    console.log(`   Default: ${group.is_default ? 'JA' : 'NEIN'}, Protected: ${group.is_protected ? 'JA' : 'NEIN'}`);
    console.log(`   Permissions: ${assigned.length}\n`);
    
    if (assigned.length > 0) {
      console.table(assigned.map(a => ({
        plugin: a.plugin_name,
        category: a.category,
        permission: a.permission_key,
        inherited: a.is_inherited ? 'JA' : 'NEIN'
      })));
    } else {
      console.log(`   ${colors.yellow}⚠️  Keine Permissions zugewiesen!${colors.reset}`);
    }
  }
  
  // 4. FK CONSTRAINTS
  header('4. FOREIGN KEY CONSTRAINTS');
  const [fks] = await conn.query(`
    SELECT 
      rc.CONSTRAINT_NAME,
      rc.TABLE_NAME,
      kcu.COLUMN_NAME,
      rc.REFERENCED_TABLE_NAME,
      kcu.REFERENCED_COLUMN_NAME,
      rc.DELETE_RULE
    FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS rc
    JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu 
      ON rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
      AND rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
    WHERE rc.CONSTRAINT_SCHEMA = ?
    AND rc.TABLE_NAME IN ('guild_groups', 'group_permissions')
  `, [process.env.MYSQL_DATABASE]);
  console.table(fks);
  
  const hasCascade = fks.some(f => f.DELETE_RULE === 'CASCADE');
  if (hasCascade) {
    console.log(`${colors.green}✅ CASCADE DELETE ist aktiv!${colors.reset}\n`);
  } else {
    console.log(`${colors.yellow}⚠️  Keine CASCADE DELETE Regeln!${colors.reset}\n`);
  }
  
  // 5. INTEGRITÄT PRÜFEN
  header('5. DATENINTEGRITÄT');
  const [orphaned] = await conn.query(`
    SELECT gp.id, gp.group_id, gp.permission_id
    FROM group_permissions gp
    LEFT JOIN guild_groups gg ON gp.group_id = gg.id
    WHERE gg.id IS NULL
  `);
  
  if (orphaned.length > 0) {
    console.log(`${colors.red}❌ ${orphaned.length} verwaiste group_permissions!${colors.reset}`);
    console.table(orphaned);
  } else {
    console.log(`${colors.green}✅ Keine verwaisten Einträge!${colors.reset}`);
  }
  
  // ZUSAMMENFASSUNG
  header('ZUSAMMENFASSUNG');
  const pluginCount = perms.reduce((acc, p) => { acc.add(p.plugin_name); return acc; }, new Set()).size;
  const [assignCount] = await conn.query('SELECT COUNT(*) as c FROM group_permissions gp JOIN guild_groups gg ON gp.group_id = gg.id WHERE gg.guild_id = "1403034310172475416"');
  
  console.log(`Plugins:              ${pluginCount}`);
  console.log(`Permissions:          ${totalPerms[0].total}`);
  console.log(`Groups:               ${groups.length}`);
  console.log(`Zuweisungen:          ${assignCount[0].c}`);
  console.log(`Foreign Keys:         ${fks.length}`);
  console.log(`CASCADE aktiv:        ${hasCascade ? 'JA' : 'NEIN'}`);
  console.log(`Verwaist:             ${orphaned.length}\n`);
  
  if (groups.length > 0 && totalPerms[0].total > 0 && orphaned.length === 0) {
    console.log(`${colors.green}${colors.bright}✅ BERECHTIGUNGSSYSTEM IST VOLL FUNKTIONSFÄHIG!${colors.reset}\n`);
  } else {
    console.log(`${colors.red}❌ PROBLEME GEFUNDEN!${colors.reset}\n`);
  }
  
  await conn.end();
})();
