/**
 * Guild-Tabellen-Check
 * Prüft welche Guilds in der DB sind
 */

require('dotenv').config({ path: './apps/dashboard/.env' });
const mysql = require('mysql2/promise');

async function checkGuilds() {
    console.log('🔍 Prüfe guilds-Tabelle...\n');
    
    const connection = await mysql.createConnection({
        host: process.env.MYSQL_HOST,
        port: process.env.MYSQL_PORT,
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE
    });

    try {
        // Alle Guilds anzeigen
        const [guilds] = await connection.execute(`
            SELECT 
                _id,
                guild_id,
                guild_name,
                created_at,
                updated_at
            FROM guilds 
            ORDER BY created_at DESC
        `);
        
        console.log(`📊 Guilds in Datenbank: ${guilds.length}\n`);
        console.log('=' .repeat(80));
        
        if (guilds.length === 0) {
            console.log('⚠️  KEINE GUILDS gefunden!');
            console.log('\n💡 Guilds werden normalerweise erstellt wenn:');
            console.log('   1. Ein User sich das erste Mal einloggt');
            console.log('   2. Der Bot einer Guild beitritt');
            console.log('   3. Ein Plugin in einer Guild aktiviert wird\n');
        } else {
            guilds.forEach((guild, i) => {
                console.log(`${i + 1}. ${guild.guild_name || 'Unnamed Guild'}`);
                console.log(`   Guild-ID: ${guild.guild_id}`);
                console.log(`   DB-ID: ${guild._id}`);
                console.log(`   Erstellt: ${guild.created_at}`);
                console.log(`   Aktualisiert: ${guild.updated_at || 'N/A'}`);
                console.log('');
            });
        }
        
        console.log('=' .repeat(80));
        
        // Prüfe guild_plugins für zusätzlichen Context
        console.log('\n📦 Guild-Plugins (aktiviert):\n');
        
        const [guildPlugins] = await connection.execute(`
            SELECT 
                gp.guild_id,
                g.guild_name,
                gp.plugin_name,
                gp.enabled_at
            FROM guild_plugins gp
            LEFT JOIN guilds g ON gp.guild_id = g.guild_id
            WHERE gp.is_enabled = 1
            ORDER BY gp.enabled_at DESC
            LIMIT 20
        `);
        
        if (guildPlugins.length === 0) {
            console.log('⚠️  Keine aktiven Plugins in Guilds gefunden');
        } else {
            guildPlugins.forEach(gp => {
                console.log(`  • ${gp.guild_name || gp.guild_id}: ${gp.plugin_name} (seit ${gp.enabled_at})`);
            });
        }
        
    } catch (error) {
        console.error('❌ Fehler:', error);
    } finally {
        await connection.end();
    }
}

checkGuilds()
    .then(() => {
        console.log('\n✅ Check abgeschlossen\n');
        process.exit(0);
    })
    .catch((error) => {
        console.error('FATAL ERROR:', error);
        process.exit(1);
    });
