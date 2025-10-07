/**
 * Migration Script: ENABLED_PLUGINS → guild_plugins
 * 
 * Migriert bestehende Plugin-Aktivierungen aus configs.ENABLED_PLUGINS
 * in die neue guild_plugins Tabelle
 * 
 * @author FireDervil
 * @date 2025-10-07
 */

require('dotenv').config({ path: './apps/dashboard/.env' });
const mysql = require('mysql2/promise');

async function migrate() {
    const connection = await mysql.createConnection({
        host: process.env.MYSQL_HOST,
        port: process.env.MYSQL_PORT,
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE
    });

    try {
        console.log('🔄 Starte Migration: ENABLED_PLUGINS → guild_plugins...\n');

        // 1. Alle ENABLED_PLUGINS aus configs holen
        const [configs] = await connection.query(`
            SELECT guild_id, config_value 
            FROM configs 
            WHERE config_key = 'ENABLED_PLUGINS'
              AND context = 'shared'
              AND plugin_name = 'core'
        `);

        console.log(`📊 Gefunden: ${configs.length} Guilds mit ENABLED_PLUGINS\n`);

        let totalPlugins = 0;
        let insertedPlugins = 0;
        let skippedPlugins = 0;

        // 2. Für jede Guild die Plugins migrieren
        for (const { guild_id, config_value } of configs) {
            try {
                // JSON parsen
                const plugins = typeof config_value === 'string' 
                    ? JSON.parse(config_value) 
                    : config_value;

                if (!Array.isArray(plugins)) {
                    console.warn(`⚠️  Guild ${guild_id}: Ungültiges ENABLED_PLUGINS Format - übersprungen`);
                    continue;
                }

                console.log(`\n🏰 Guild ${guild_id}: ${plugins.length} Plugins`);

                // 3. Jedes Plugin in guild_plugins eintragen
                for (const plugin_name of plugins) {
                    totalPlugins++;

                    try {
                        // Plugin-Version aus registry.json holen (optional)
                        let plugin_version = null;
                        try {
                            const registry = require('./plugins/registry.json');
                            const pluginInfo = registry.find(p => p.name === plugin_name);
                            plugin_version = pluginInfo?.version || null;
                        } catch (err) {
                            // Registry nicht gefunden, Version bleibt null
                        }

                        // Insert in guild_plugins (mit ON DUPLICATE KEY UPDATE)
                        const [result] = await connection.query(`
                            INSERT INTO guild_plugins 
                                (guild_id, plugin_name, is_enabled, plugin_version, enabled_at, created_at)
                            VALUES (?, ?, 1, ?, NOW(), NOW())
                            ON DUPLICATE KEY UPDATE
                                is_enabled = 1,
                                plugin_version = VALUES(plugin_version),
                                updated_at = NOW()
                        `, [guild_id, plugin_name, plugin_version]);

                        if (result.affectedRows === 1) {
                            console.log(`  ✅ ${plugin_name} (v${plugin_version || 'unknown'}) eingefügt`);
                            insertedPlugins++;
                        } else {
                            console.log(`  ⏭️  ${plugin_name} bereits vorhanden - aktualisiert`);
                            skippedPlugins++;
                        }

                    } catch (pluginErr) {
                        console.error(`  ❌ Fehler bei Plugin ${plugin_name}:`, pluginErr.message);
                    }
                }

            } catch (guildErr) {
                console.error(`❌ Fehler bei Guild ${guild_id}:`, guildErr.message);
            }
        }

        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('📊 MIGRATION ABGESCHLOSSEN\n');
        console.log(`   Guilds verarbeitet:  ${configs.length}`);
        console.log(`   Plugins gesamt:      ${totalPlugins}`);
        console.log(`   Neu eingefügt:       ${insertedPlugins}`);
        console.log(`   Bereits vorhanden:   ${skippedPlugins}`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

        // 4. Prüfung: guild_plugins Einträge anzeigen
        const [check] = await connection.query(`
            SELECT guild_id, plugin_name, is_enabled, plugin_version 
            FROM guild_plugins 
            ORDER BY guild_id, plugin_name
        `);

        console.log('✅ Überprüfung: guild_plugins Tabelle\n');
        for (const row of check) {
            console.log(`   ${row.guild_id} | ${row.plugin_name.padEnd(15)} | ${row.is_enabled ? '✓' : '✗'} | v${row.plugin_version || '?'}`);
        }

        console.log('\n✅ Migration erfolgreich abgeschlossen!');
        console.log('⚠️  ENABLED_PLUGINS in configs bleiben vorerst bestehen (Fallback)');
        console.log('   Nach erfolgreichen Tests können sie mit folgendem Befehl gelöscht werden:');
        console.log('   DELETE FROM configs WHERE config_key = "ENABLED_PLUGINS";\n');

    } catch (error) {
        console.error('❌ MIGRATION FEHLER:', error);
        throw error;
    } finally {
        await connection.end();
    }
}

// Script ausführen
migrate().catch(err => {
    console.error('❌ FATAL ERROR:', err);
    process.exit(1);
});
