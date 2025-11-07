#!/usr/bin/env node

/**
 * Sync: group_permissions → guild_groups.permissions (JSON)
 * 
 * Synchronisiert die relationalen group_permissions Einträge zurück ins
 * JSON-Feld der guild_groups Tabelle für Abwärtskompatibilität mit der
 * Berechtigungsmatrix-View.
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
    
    console.log('🔄 SYNC: group_permissions → guild_groups.permissions (JSON)\n');
    
    const guildId = '1403034310172475416';
    
    // 1. Hole alle Gruppen
    const [groups] = await conn.query(
        'SELECT id, name, slug FROM guild_groups WHERE guild_id = ?',
        [guildId]
    );
    
    console.log(`📊 Gefunden: ${groups.length} Gruppen\n`);
    
    for (const group of groups) {
        console.log(`\n🔧 Verarbeite Gruppe: ${group.name} (ID: ${group.id})`);
        
        // 2. Hole alle Permissions dieser Gruppe aus group_permissions
        const [groupPermissions] = await conn.query(`
            SELECT pd.permission_key
            FROM group_permissions gp
            JOIN permission_definitions pd ON gp.permission_id = pd.id
            WHERE gp.group_id = ?
            ORDER BY pd.permission_key
        `, [group.id]);
        
        console.log(`   Gefunden: ${groupPermissions.length} Permissions`);
        
        // 3. Baue JSON-Objekt
        const permissionsJson = {};
        groupPermissions.forEach(p => {
            permissionsJson[p.permission_key] = true;
        });
        
        // 4. Update guild_groups.permissions
        await conn.query(`
            UPDATE guild_groups 
            SET permissions = ?
            WHERE id = ?
        `, [JSON.stringify(permissionsJson), group.id]);
        
        console.log(`   ✅ JSON aktualisiert (${groupPermissions.length} Einträge)`);
        
        // Zeige erste 5 Permissions
        if (groupPermissions.length > 0) {
            const preview = groupPermissions.slice(0, 5).map(p => p.permission_key);
            console.log(`   📋 Preview: ${preview.join(', ')}${groupPermissions.length > 5 ? '...' : ''}`);
        }
    }
    
    console.log(`\n\n✅ SYNC KOMPLETT! Alle JSON-Felder wurden aktualisiert.`);
    console.log(`\n💡 Die Berechtigungsmatrix sollte jetzt korrekt anzeigen!`);
    
    await conn.end();
}

main().catch(console.error);
