#!/usr/bin/env node

/**
 * Permission-System Analyzer
 * 
 * Findet fehlende Permissions in der Administrator-Gruppe
 */

require('dotenv').config({ path: './apps/dashboard/.env' });
const mysql = require('mysql2/promise');

async function main() {
    const conn = await mysql.createConnection({
        host: process.env.MYSQL_HOST,
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE
    });
    
    const guildId = '1403034310172475416';
    
    console.log('🔍 PRÜFE: Welche Permissions fehlen der Administrator-Gruppe?\n');
    
    // Alle aktiven Permissions
    const [allPerms] = await conn.query(`
        SELECT id, permission_key, plugin_name, category
        FROM permission_definitions
        WHERE guild_id = ? AND is_active = 1
        ORDER BY plugin_name, permission_key
    `, [guildId]);
    
    console.log(`📊 Gesamt: ${allPerms.length} aktive Permissions\n`);
    
    // Administrator-Gruppe finden
    const [adminGroups] = await conn.query(`
        SELECT id FROM guild_groups 
        WHERE guild_id = ? AND slug = 'administrator'
    `, [guildId]);
    
    if (!adminGroups || adminGroups.length === 0) {
        console.log('❌ Administrator-Gruppe nicht gefunden!');
        await conn.end();
        return;
    }
    
    const adminGroupId = adminGroups[0].id;
    console.log(`✅ Administrator-Gruppe ID: ${adminGroupId}\n`);
    
    // Zugewiesene Permissions
    const [assignedPerms] = await conn.query(`
        SELECT permission_id 
        FROM group_permissions 
        WHERE group_id = ?
    `, [adminGroupId]);
    
    const assignedIds = new Set(assignedPerms.map(p => p.permission_id));
    console.log(`✅ Administrator hat: ${assignedIds.size} Permissions\n`);
    
    // Fehlende Permissions
    const missingPerms = allPerms.filter(p => !assignedIds.has(p.id));
    
    if (missingPerms.length === 0) {
        console.log('✅ Administrator-Gruppe hat ALLE Permissions!');
    } else {
        console.log(`⚠️  FEHLENDE PERMISSIONS (${missingPerms.length}):\n`);
        
        let currentPlugin = null;
        missingPerms.forEach(p => {
            if (p.plugin_name !== currentPlugin) {
                currentPlugin = p.plugin_name;
                console.log(`\n  🔌 Plugin: ${currentPlugin}`);
            }
            console.log(`    [${p.id}] ${p.permission_key} (${p.category})`);
        });
        
        console.log('\n\n📝 SQL zum Hinzufügen:\n');
        console.log('INSERT INTO group_permissions (group_id, permission_id, assigned_by, assigned_at) VALUES');
        const values = missingPerms.map(p => `  (${adminGroupId}, ${p.id}, 'system', NOW())`);
        console.log(values.join(',\n') + ';');
    }
    
    await conn.end();
}

main().catch(console.error);
