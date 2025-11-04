/**
 * Test-Script: unregisterPluginPermissions() testen
 */

const mysql = require('mysql2/promise');
require('dotenv').config({ path: './apps/dashboard/.env' });

const guildId = '1403034310172475416';
const testPlugin = 'gameserver'; // Testen mit gameserver

async function testUnregister() {
    console.log('🧪 Teste unregisterPluginPermissions()...\n');
    
    const conn = await mysql.createConnection({
        host: process.env.MYSQL_HOST,
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE
    });
    
    console.log('✅ DB verbunden\n');
    
    // VORHER: Zähle Permissions
    console.log('📊 VORHER:');
    const [before1] = await conn.query(
        'SELECT COUNT(*) as count FROM permission_definitions WHERE guild_id = ? AND plugin_name = ?',
        [guildId, testPlugin]
    );
    console.log(`   permission_definitions: ${before1[0].count} ${testPlugin} permissions`);
    
    const [before2] = await conn.query(`
        SELECT COUNT(*) as count 
        FROM group_permissions gp
        INNER JOIN permission_definitions pd ON gp.permission_id = pd.id
        WHERE pd.guild_id = ? AND pd.plugin_name = ?
    `, [guildId, testPlugin]);
    console.log(`   group_permissions: ${before2[0].count} zugewiesene ${testPlugin} permissions\n`);
    
    // Simuliere PermissionManager.unregisterPluginPermissions()
    console.log('🗑️  Führe DELETE aus (CASCADE sollte group_permissions automatisch löschen)...\n');
    
    // 1. Zähle group_permissions VOR Delete (für Logging)
    const [permissions] = await conn.query(
        'SELECT id FROM permission_definitions WHERE guild_id = ? AND plugin_name = ?',
        [guildId, testPlugin]
    );
    
    if (permissions.length === 0) {
        console.log('❌ Keine Permissions gefunden für Plugin!');
        await conn.end();
        process.exit(1);
    }
    
    const permIds = permissions.map(p => p.id);
    
    const [gpCount] = await conn.query(
        'SELECT COUNT(*) as count FROM group_permissions WHERE permission_id IN (?)',
        [permIds]
    );
    
    console.log(`   Vor DELETE: ${gpCount[0].count} Zuweisungen in group_permissions`);
    
    // 2. DELETE aus permission_definitions (CASCADE!)
    const [result] = await conn.query(
        'DELETE FROM permission_definitions WHERE guild_id = ? AND plugin_name = ?',
        [guildId, testPlugin]
    );
    
    console.log(`   DELETE affectedRows: ${result.affectedRows}\n`);
    
    // NACHHER: Zähle Permissions
    console.log('📊 NACHHER:');
    const [after1] = await conn.query(
        'SELECT COUNT(*) as count FROM permission_definitions WHERE guild_id = ? AND plugin_name = ?',
        [guildId, testPlugin]
    );
    console.log(`   permission_definitions: ${after1[0].count} ${testPlugin} permissions`);
    
    const [after2] = await conn.query(`
        SELECT COUNT(*) as count 
        FROM group_permissions gp
        LEFT JOIN permission_definitions pd ON gp.permission_id = pd.id
        WHERE pd.plugin_name = ? OR pd.id IS NULL
    `, [testPlugin]);
    console.log(`   group_permissions: ${after2[0].count} ${testPlugin} permissions (sollte 0 sein!)\n`);
    
    // Verifiziere CASCADE hat funktioniert
    const [orphaned] = await conn.query(`
        SELECT gp.id, gp.permission_id
        FROM group_permissions gp
        LEFT JOIN permission_definitions pd ON gp.permission_id = pd.id
        WHERE pd.id IS NULL
        LIMIT 5
    `);
    
    if (orphaned.length > 0) {
        console.log('⚠️  WARNUNG: Verwaiste group_permissions Einträge gefunden (CASCADE FAILED):');
        orphaned.forEach(row => {
            console.log(`   - group_permissions.id=${row.id}, permission_id=${row.permission_id} (Definition existiert nicht!)`);
        });
    } else {
        console.log('✅ Keine verwaisten Einträge - CASCADE hat funktioniert!');
    }
    
    await conn.end();
    
    console.log('\n🎉 Test abgeschlossen!');
}

testUnregister()
    .then(() => {
        console.log('\n✅ Script beendet');
        process.exit(0);
    })
    .catch((err) => {
        console.error('\n❌ Fehler:', err);
        process.exit(1);
    });
