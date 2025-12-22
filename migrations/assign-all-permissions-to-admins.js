/**
 * Einmaliges Script: Alle bestehenden Permissions der Administrator-Gruppe zuweisen
 * 
 * Dieses Script läuft einmalig nach dem Refactor und weist ALLE Permissions
 * aus permission_definitions automatisch der Administrator-Gruppe jeder Guild zu.
 * 
 * @author FireBot Team
 * @date 2025-11-03
 */

const mysql = require('mysql2/promise');
require('dotenv').config({ path: './apps/dashboard/.env' });

async function assignAllPermissionsToAdmins() {
    console.log('🚀 Starte einmalige Permission-Zuweisung für alle Guilds...\n');
    
    const conn = await mysql.createConnection({
        host: process.env.MYSQL_HOST,
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE
    });
    
    console.log('✅ DB verbunden\n');
    
    // 1. Hole alle Guilds
    const [guilds] = await conn.query(
        'SELECT DISTINCT guild_id FROM guild_groups'
    );
    
    console.log(`📊 Gefunden: ${guilds.length} Guild(s)\n`);
    
    let totalGuildsProcessed = 0;
    let totalPermissionsAssigned = 0;
    
    for (const guild of guilds) {
        const guildId = guild.guild_id;
        console.log(`🏰 Verarbeite Guild: ${guildId}`);
        
        // 2. Finde Administrator-Gruppe
        const [adminGroups] = await conn.query(
            'SELECT id, name FROM guild_groups WHERE guild_id = ? AND slug = ?',
            [guildId, 'administrator']
        );
        
        if (!adminGroups || adminGroups.length === 0) {
            console.log(`   ⚠️  Keine Administrator-Gruppe gefunden - Skip\n`);
            continue;
        }
        
        const adminGroup = adminGroups[0];
        console.log(`   ✅ Administrator-Gruppe: ${adminGroup.name} (ID: ${adminGroup.id})`);
        
        // 3. Hole ALLE Permissions dieser Guild aus permission_definitions
        const [permissions] = await conn.query(
            'SELECT id, permission_key, plugin_name FROM permission_definitions WHERE guild_id = ? ORDER BY plugin_name, permission_key',
            [guildId]
        );
        
        console.log(`   📋 Gefunden: ${permissions.length} Permissions`);
        
        if (permissions.length === 0) {
            console.log(`   ⚠️  Keine Permissions gefunden - Skip\n`);
            continue;
        }
        
        let assignedCount = 0;
        let skippedCount = 0;
        
        // 4. Weise jede Permission der Administrator-Gruppe zu
        for (const perm of permissions) {
            try {
                const [result] = await conn.query(
                    `INSERT IGNORE INTO group_permissions 
                     (group_id, permission_id, assigned_at, assigned_by, is_inherited, grant_option) 
                     VALUES (?, ?, NOW(), 'migration-script', 0, 0)`,
                    [adminGroup.id, perm.id]
                );
                
                if (result.affectedRows > 0) {
                    assignedCount++;
                    totalPermissionsAssigned++;
                } else {
                    skippedCount++;
                }
            } catch (err) {
                console.log(`   ❌ Fehler bei ${perm.plugin_name}:${perm.permission_key}: ${err.message}`);
            }
        }
        
        console.log(`   ✅ Zugewiesen: ${assignedCount}, Übersprungen: ${skippedCount}\n`);
        totalGuildsProcessed++;
    }
    
    await conn.end();
    
    console.log('═'.repeat(80));
    console.log('🎉 Migration abgeschlossen!\n');
    console.log(`📊 Statistik:`);
    console.log(`   - Guilds verarbeitet: ${totalGuildsProcessed}`);
    console.log(`   - Permissions zugewiesen: ${totalPermissionsAssigned}`);
    console.log('═'.repeat(80));
    
    // Verifizierung
    console.log('\n🔍 Verifizierung:\n');
    
    const conn2 = await mysql.createConnection({
        host: process.env.MYSQL_HOST,
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE
    });
    
    for (const guild of guilds) {
        const guildId = guild.guild_id;
        
        const [adminGroups] = await conn2.query(
            'SELECT id FROM guild_groups WHERE guild_id = ? AND slug = ?',
            [guildId, 'administrator']
        );
        
        if (adminGroups.length === 0) continue;
        
        const adminGroupId = adminGroups[0].id;
        
        // Zähle Permissions pro Plugin
        const [stats] = await conn2.query(`
            SELECT 
                pd.plugin_name,
                COUNT(*) as count
            FROM group_permissions gp
            INNER JOIN permission_definitions pd ON gp.permission_id = pd.id
            WHERE gp.group_id = ?
            GROUP BY pd.plugin_name
            ORDER BY pd.plugin_name
        `, [adminGroupId]);
        
        console.log(`   Guild ${guildId}:`);
        stats.forEach(row => {
            console.log(`      - ${row.plugin_name}: ${row.count} permissions`);
        });
        console.log('');
    }
    
    await conn2.end();
    
    console.log('✅ Verifizierung abgeschlossen!\n');
}

assignAllPermissionsToAdmins()
    .then(() => {
        console.log('✅ Script beendet');
        process.exit(0);
    })
    .catch((err) => {
        console.error('❌ Kritischer Fehler:', err);
        process.exit(1);
    });
