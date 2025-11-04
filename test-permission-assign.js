/**
 * Test-Script: Permissions manuell zur Administrator-Gruppe zuweisen
 */

const { ServiceManager } = require('dunebot-core');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: './apps/dashboard/.env' });

const guildId = '1403034310172475416';
const pluginNames = ['gameserver', 'masterserver'];

async function assignPermissions() {
    console.log('🚀 Starte manuelle Permission-Zuweisung...\n');
    
    // DB Connection
    const conn = await mysql.createConnection({
        host: process.env.MYSQL_HOST,
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE
    });
    
    console.log('✅ DB verbunden');
    
    // Administrator-Gruppe finden
    const [groups] = await conn.query(
        'SELECT id, name FROM guild_groups WHERE guild_id = ? AND slug = ?',
        [guildId, 'administrator']
    );
    
    if (!groups || groups.length === 0) {
        console.error('❌ Administrator-Gruppe nicht gefunden!');
        process.exit(1);
    }
    
    const adminGroup = groups[0];
    console.log(`✅ Administrator-Gruppe gefunden: ${adminGroup.name} (ID: ${adminGroup.id})\n`);
    
    let totalAdded = 0;
    
    for (const pluginName of pluginNames) {
        console.log(`📦 Verarbeite Plugin: ${pluginName}`);
        
        // Alle Permissions des Plugins holen
        const [permissions] = await conn.query(
            'SELECT id, permission_key FROM permission_definitions WHERE guild_id = ? AND plugin_name = ?',
            [guildId, pluginName]
        );
        
        console.log(`   Gefunden: ${permissions.length} Permissions`);
        
        for (const perm of permissions) {
            try {
                const [result] = await conn.query(
                    `INSERT IGNORE INTO group_permissions 
                     (group_id, permission_id, assigned_at, assigned_by, is_inherited, grant_option) 
                     VALUES (?, ?, NOW(), 'manual-script', 0, 0)`,
                    [adminGroup.id, perm.id]
                );
                
                if (result.affectedRows > 0) {
                    console.log(`   ✅ ${perm.permission_key}`);
                    totalAdded++;
                } else {
                    console.log(`   ⏭️  ${perm.permission_key} (bereits vorhanden)`);
                }
            } catch (err) {
                console.error(`   ❌ ${perm.permission_key}: ${err.message}`);
            }
        }
        
        console.log('');
    }
    
    await conn.end();
    
    console.log(`\n🎉 Fertig! ${totalAdded} Permissions zugewiesen`);
    
    // Verifizierung
    const conn2 = await mysql.createConnection({
        host: process.env.MYSQL_HOST,
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE
    });
    
    const [count] = await conn2.query(
        'SELECT COUNT(*) as total FROM group_permissions WHERE group_id = ?',
        [adminGroup.id]
    );
    
    console.log(`\n📊 Administrator-Gruppe hat jetzt ${count[0].total} Permissions total`);
    
    await conn2.end();
}

assignPermissions()
    .then(() => {
        console.log('\n✅ Script beendet');
        process.exit(0);
    })
    .catch((err) => {
        console.error('\n❌ Fehler:', err);
        process.exit(1);
    });
