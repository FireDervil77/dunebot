/**
 * Zeigt alle Datenbank-Einträge für eine bestimmte Guild
 */
require('dotenv').config({ path: './apps/dashboard/.env' });
const mysql = require('mysql2/promise');

const GUILD_ID = '1403034310172475416'; // Dein TestServer

async function getAllGuildData() {
    const connection = await mysql.createConnection({
        host: process.env.MYSQL_HOST,
        port: process.env.MYSQL_PORT,
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE
    });

    console.log(`\n🔍 Suche alle Daten für Guild: ${GUILD_ID}\n`);
    console.log('='.repeat(80));

    try {
        // 1. Hole alle Tabellen
        const [tables] = await connection.execute(`
            SELECT TABLE_NAME 
            FROM information_schema.TABLES 
            WHERE TABLE_SCHEMA = ? 
            AND TABLE_TYPE = 'BASE TABLE'
            ORDER BY TABLE_NAME
        `, [process.env.MYSQL_DATABASE]);

        console.log(`📊 Gefunden: ${tables.length} Tabellen in der Datenbank\n`);

        for (const { TABLE_NAME: tableName } of tables) {
            try {
                // Hole Spalten-Info
                const [columns] = await connection.execute(`
                    SELECT COLUMN_NAME 
                    FROM information_schema.COLUMNS 
                    WHERE TABLE_SCHEMA = ? 
                    AND TABLE_NAME = ?
                `, [process.env.MYSQL_DATABASE, tableName]);

                const columnNames = columns.map(c => c.COLUMN_NAME);

                // Suche nach Guild-ID Spalten (verschiedene Namenskonventionen)
                const guildColumns = columnNames.filter(col => 
                    col === 'guild_id' || 
                    col === '_id' && tableName === 'guilds' ||
                    col === 'guildId'
                );

                if (guildColumns.length === 0) {
                    // Keine Guild-Spalte → Tabelle überspringen
                    continue;
                }

                const guildColumn = guildColumns[0];

                // Hole Daten für diese Guild
                const [rows] = await connection.execute(
                    `SELECT * FROM ${tableName} WHERE ${guildColumn} = ?`,
                    [GUILD_ID]
                );

                if (rows.length > 0) {
                    console.log(`\n📋 Tabelle: ${tableName}`);
                    console.log(`   Guild-Spalte: ${guildColumn}`);
                    console.log(`   Anzahl Einträge: ${rows.length}`);
                    console.log('-'.repeat(80));
                    
                    // Zeige Daten in Tabellenform
                    console.table(rows);
                }

            } catch (tableError) {
                // Fehler bei einzelner Tabelle ignorieren (z.B. keine Berechtigung)
                // console.error(`   ⚠️ Fehler bei Tabelle ${tableName}:`, tableError.message);
            }
        }

        // Spezielle Abfrage für configs-Tabelle
        console.log(`\n📋 Tabelle: configs (spezielle Abfrage)`);
        console.log('-'.repeat(80));
        const [configs] = await connection.execute(
            `SELECT plugin_name, scope, config_key, config_value 
             FROM configs 
             WHERE guild_id = ? 
             ORDER BY plugin_name, config_key 
             LIMIT 50`,
            [GUILD_ID]
        );
        
        if (configs.length > 0) {
            console.log(`   Anzahl Config-Einträge: ${configs.length}`);
            console.table(configs);
        } else {
            console.log('   ❌ KEINE Config-Einträge gefunden für diese Guild!');
        }

        // guild_plugins Tabelle
        console.log(`\n📋 Tabelle: guild_plugins`);
        console.log('-'.repeat(80));
        const [guildPlugins] = await connection.execute(
            `SELECT plugin_name, is_enabled, plugin_version, enabled_at, enabled_by, disabled_at 
             FROM guild_plugins 
             WHERE guild_id = ?`,
            [GUILD_ID]
        );
        
        if (guildPlugins.length > 0) {
            console.log(`   Anzahl Plugin-Einträge: ${guildPlugins.length}`);
            console.table(guildPlugins);
        } else {
            console.log('   ❌ KEINE guild_plugins Einträge gefunden!');
        }

        console.log('\n' + '='.repeat(80));
        console.log('✅ Analyse abgeschlossen\n');

    } catch (error) {
        console.error('❌ Fehler:', error);
    } finally {
        await connection.end();
    }
}

getAllGuildData();
