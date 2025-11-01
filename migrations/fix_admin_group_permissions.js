/**
 * Migration: Admin-Gruppe Permissions aktualisieren
 * 
 * Problem: Admin-Gruppen haben nur "wildcard: true", aber keine expliziten Permissions
 * Lösung: Füge alle wichtigen Permissions explizit hinzu (inklusive permissions.assign)
 * 
 * Betrifft: Alle bestehenden Guilds mit Administrator-Gruppe
 * 
 * @author FireDervil
 * @date 2025-10-30
 */

const mysql = require('mysql2/promise');
require('dotenv').config({ path: './apps/dashboard/.env' });

const ADMIN_PERMISSIONS = {
    wildcard: true,
    // Explizite Permissions für bessere UI-Kompatibilität
    'permissions.view': true,
    'permissions.users.view': true,
    'permissions.users.invite': true,
    'permissions.users.edit': true,
    'permissions.users.remove': true,
    'permissions.groups.view': true,
    'permissions.groups.create': true,
    'permissions.groups.edit': true,
    'permissions.groups.delete': true,
    'permissions.assign': true,  // ← WICHTIG für Matrix-Editing!
    'gameserver.view': true,
    'gameserver.create': true,
    'gameserver.edit': true,
    'gameserver.delete': true,
    'gameserver.start': true,
    'gameserver.stop': true,
    'gameserver.restart': true,
    'gameserver.console.view': true,
    'gameserver.console.execute': true,
    'gameserver.files.view': true,
    'gameserver.files.upload': true,
    'gameserver.files.download': true,
    'gameserver.files.delete': true,
    'gameserver.settings.edit': true,
    'moderation.view': true,
    'moderation.ban': true,
    'moderation.kick': true,
    'moderation.warn': true,
    'moderation.mute': true,
    'moderation.settings.edit': true,
    'core.settings.view': true,
    'core.settings.edit': true,
    'core.plugins.manage': true
};

async function run() {
    let connection;
    
    try {
        // Verbindung aufbauen
        connection = await mysql.createConnection({
            host: process.env.MYSQL_HOST,
            user: process.env.MYSQL_USER,
            password: process.env.MYSQL_PASSWORD,
            database: process.env.MYSQL_DATABASE
        });
        
        console.log('✅ Datenbank-Verbindung hergestellt\n');
        
        // Hole alle Administrator-Gruppen
        const [adminGroups] = await connection.query(`
            SELECT id, guild_id, name, slug, permissions 
            FROM guild_groups 
            WHERE slug = 'administrator'
            ORDER BY guild_id
        `);
        
        if (adminGroups.length === 0) {
            console.log('ℹ️  Keine Administrator-Gruppen gefunden.');
            return;
        }
        
        console.log(`📊 Gefundene Administrator-Gruppen: ${adminGroups.length}\n`);
        
        let updatedCount = 0;
        let skippedCount = 0;
        
        // Für jede Admin-Gruppe
        for (const group of adminGroups) {
            try {
                const currentPerms = JSON.parse(group.permissions || '{}');
                
                // Prüfe ob permissions.assign bereits vorhanden ist
                if (currentPerms['permissions.assign'] === true) {
                    console.log(`⏭️  Guild ${group.guild_id} - Bereits aktuell, überspringe`);
                    skippedCount++;
                    continue;
                }
                
                // Merge: Behalte existierende, füge neue hinzu
                const updatedPerms = { ...currentPerms, ...ADMIN_PERMISSIONS };
                
                // Update in DB
                await connection.query(
                    'UPDATE guild_groups SET permissions = ?, updated_at = NOW() WHERE id = ?',
                    [JSON.stringify(updatedPerms), group.id]
                );
                
                console.log(`✅ Guild ${group.guild_id} - Administrator-Gruppe aktualisiert`);
                updatedCount++;
                
            } catch (parseError) {
                console.error(`❌ Guild ${group.guild_id} - Fehler beim Parsen der Permissions:`, parseError.message);
            }
        }
        
        console.log(`\n📊 Zusammenfassung:`);
        console.log(`   ✅ Aktualisiert: ${updatedCount}`);
        console.log(`   ⏭️  Übersprungen: ${skippedCount}`);
        console.log(`   📈 Gesamt: ${adminGroups.length}`);
        
    } catch (error) {
        console.error('❌ Fehler beim Ausführen der Migration:', error);
        throw error;
        
    } finally {
        if (connection) {
            await connection.end();
            console.log('\n✅ Datenbank-Verbindung geschlossen');
        }
    }
}

// Ausführen
run().catch(err => {
    console.error('💥 Migration fehlgeschlagen:', err);
    process.exit(1);
});
