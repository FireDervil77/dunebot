#!/usr/bin/env node

/**
 * Test: Auto-Permission-Assignment für Administrator-Gruppe
 * 
 * Testet ob neue Plugin-Permissions automatisch zur Administrator-Gruppe hinzugefügt werden
 */

require('dotenv').config({ path: './apps/dashboard/.env' });
const mysql = require('mysql2/promise');
const path = require('path');
const fs = require('fs');

async function main() {
    const conn = await mysql.createConnection({
        host: process.env.MYSQL_HOST,
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE
    });
    
    const guildId = '1403034310172475416';
    const pluginName = 'automod'; // Test mit AutoMod-Plugin
    
    console.log('🧪 TEST: Auto-Permission-Assignment\n');
    console.log(`Plugin: ${pluginName}`);
    console.log(`Guild: ${guildId}\n`);
    
    // 1. Hole permissions.json des Plugins
    const permissionsFile = path.join(__dirname, '../plugins', pluginName, 'dashboard', 'permissions.json');
    
    if (!fs.existsSync(permissionsFile)) {
        console.log(`❌ permissions.json nicht gefunden: ${permissionsFile}`);
        await conn.end();
        return;
    }
    
    const permissionsData = JSON.parse(fs.readFileSync(permissionsFile, 'utf8'));
    console.log(`📋 Plugin hat ${permissionsData.permissions.length} Permissions\n`);
    
    // 2. Administrator-Gruppe finden
    const [adminGroups] = await conn.query(
        'SELECT id FROM guild_groups WHERE guild_id = ? AND slug = ?',
        [guildId, 'administrator']
    );
    
    if (!adminGroups || adminGroups.length === 0) {
        console.log('❌ Administrator-Gruppe nicht gefunden!');
        await conn.end();
        return;
    }
    
    const adminGroupId = adminGroups[0].id;
    console.log(`✅ Administrator-Gruppe ID: ${adminGroupId}\n`);
    
    // 3. Prüfe jede Permission
    console.log('📊 PERMISSION-STATUS:\n');
    
    let inDefinitions = 0;
    let inGroupPermissions = 0;
    let missingInGroup = [];
    
    for (const perm of permissionsData.permissions) {
        const permKey = perm.key;
        
        // Prüfe ob in permission_definitions
        const [permDefs] = await conn.query(
            'SELECT id FROM permission_definitions WHERE guild_id = ? AND permission_key = ?',
            [guildId, permKey]
        );
        
        if (permDefs && permDefs.length > 0) {
            inDefinitions++;
            const permissionId = permDefs[0].id;
            
            // Prüfe ob in group_permissions
            const [groupPerms] = await conn.query(
                'SELECT id FROM group_permissions WHERE group_id = ? AND permission_id = ?',
                [adminGroupId, permissionId]
            );
            
            if (groupPerms && groupPerms.length > 0) {
                inGroupPermissions++;
                console.log(`  ✅ ${permKey.padEnd(40)} → In Gruppe`);
            } else {
                missingInGroup.push({ key: permKey, id: permissionId });
                console.log(`  ⚠️  ${permKey.padEnd(40)} → FEHLT in Gruppe!`);
            }
        } else {
            console.log(`  ❌ ${permKey.padEnd(40)} → Nicht in permission_definitions!`);
        }
    }
    
    console.log(`\n📈 ERGEBNIS:`);
    console.log(`  Permissions in permission_definitions: ${inDefinitions}/${permissionsData.permissions.length}`);
    console.log(`  Permissions in Administrator-Gruppe: ${inGroupPermissions}/${inDefinitions}`);
    
    if (missingInGroup.length > 0) {
        console.log(`\n⚠️  ${missingInGroup.length} Permissions fehlen in der Administrator-Gruppe!`);
        console.log(`\n📝 SQL zum Beheben:`);
        console.log('INSERT INTO group_permissions (group_id, permission_id, assigned_by, assigned_at) VALUES');
        const values = missingInGroup.map(p => `  (${adminGroupId}, ${p.id}, 'system', NOW())`);
        console.log(values.join(',\n') + ';');
    } else {
        console.log(`\n✅ Alle Permissions sind in der Administrator-Gruppe! Auto-Assignment funktioniert!`);
    }
    
    await conn.end();
}

main().catch(console.error);
