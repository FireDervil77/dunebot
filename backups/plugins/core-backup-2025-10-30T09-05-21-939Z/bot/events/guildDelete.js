const { ServiceManager } = require("dunebot-core");

/**
 * Dynamisches Guild-Cleanup beim Verlassen einer Guild
 * Löscht automatisch ALLE Daten der Guild aus ALLEN Tabellen
 * @param {import('discord.js').Guild} guild
 */
module.exports = async (guild, plugin) => {
    const Logger = ServiceManager.get("Logger");
    const dbService = ServiceManager.get("dbService");
    
    if (!guild.available) return;
    
    Logger.info(`🚪 Guild Left: ${guild.name} (${guild.id}) - Starte komplette Datenbereinigung...`);

    try {
        // 1. Guild als verlassen markieren (aber NICHT löschen!)
        await dbService.query(
            `UPDATE guilds SET left_at = NOW(), updated_at = NOW() WHERE _id = ?`, 
            [guild.id]
        );
        Logger.debug(`✅ Guild ${guild.id} als verlassen markiert`);

        // 2. DYNAMISCHE Bereinigung aller Tabellen mit guild_id
        const cleanupStats = await cleanupAllGuildData(guild.id, dbService, Logger);
        
        Logger.success(`🧹 Guild-Bereinigung abgeschlossen für ${guild.name} (${guild.id}):`);
        Logger.success(`   📊 ${cleanupStats.tablesProcessed} Tabellen verarbeitet`);
        Logger.success(`   🗑️  ${cleanupStats.totalDeleted} Datensätze gelöscht`);
        
        if (cleanupStats.errors.length > 0) {
            Logger.warn(`⚠️  ${cleanupStats.errors.length} Fehler bei der Bereinigung:`);
            cleanupStats.errors.forEach(error => Logger.warn(`   - ${error}`));
        }

    } catch (error) {
        Logger.error(`❌ Kritischer Fehler bei Guild-Bereinigung für ${guild.id}:`, error);
        throw error;
    }
};

/**
 * Bereinigt dynamisch ALLE Guild-Daten aus ALLEN Tabellen
 * @param {string} guildId - Discord Guild ID
 * @param {Object} dbService - Database Service
 * @param {Object} Logger - Logger Service
 * @returns {Promise<{tablesProcessed: number, totalDeleted: number, errors: Array}>}
 */
async function cleanupAllGuildData(guildId, dbService, Logger) {
    const stats = {
        tablesProcessed: 0,
        totalDeleted: 0,
        errors: []
    };

    try {
        // 1. Alle Tabellen in der Datenbank finden
        Logger.debug(`🔍 Suche nach Tabellen mit guild_id-Spalte...`);
        const tables = await dbService.query('SHOW TABLES');
        
        // Debug: Was kommt vom Query zurück?
        Logger.debug(`[DEBUG] SHOW TABLES Result:`, typeof tables, Array.isArray(tables), tables);
        
        // mysql2 returns: [rows, fields] oder nur rows - je nach Setup
        const tableRows = Array.isArray(tables) ? tables : [];
        const tableNames = tableRows.map(row => Object.values(row)[0]);
        
        Logger.debug(`[DEBUG] Extrahierte Tabellennamen:`, tableNames);
        
        // 2. Für jede Tabelle prüfen, ob sie eine guild_id-Spalte hat
        const tablesWithGuildId = [];
        
        for (const tableName of tableNames) {
            try {
                const columns = await dbService.query(`DESCRIBE ${tableName}`);
                
                // Debug: Was kommt vom DESCRIBE Query zurück?
                Logger.debug(`[DEBUG] DESCRIBE ${tableName} Result:`, typeof columns, Array.isArray(columns));
                
                const columnRows = Array.isArray(columns) ? columns : [];
                const hasGuildId = columnRows.some(col => 
                    col.Field === 'guild_id' || col.Field === 'guildId'
                );
                
                if (hasGuildId) {
                    // AUSSCHLUSS-LISTE: Tabellen die NICHT bereinigt werden sollen
                    const excludedTables = [
                        'user_feedback'  // User-Feedback bleibt für historische Zwecke erhalten
                    ];
                    
                    if (excludedTables.includes(tableName)) {
                        Logger.debug(`⏭️  ${tableName}: Übersprungen (auf Ausschluss-Liste)`);
                        continue;
                    }
                    
                    // Bestimme den korrekten Spaltennamen
                    const guildColumn = columnRows.find(col => 
                        col.Field === 'guild_id' || col.Field === 'guildId'
                    ).Field;
                    
                    tablesWithGuildId.push({ table: tableName, column: guildColumn });
                }
            } catch (error) {
                stats.errors.push(`Fehler beim Analysieren der Tabelle ${tableName}: ${error.message}`);
            }
        }

        Logger.debug(`📋 Gefundene Tabellen mit Guild-Daten: ${tablesWithGuildId.length}`);
        tablesWithGuildId.forEach(({table, column}) => 
            Logger.debug(`   - ${table}.${column}`)
        );

        // 3. Guild-Daten aus jeder Tabelle löschen
        for (const {table, column} of tablesWithGuildId) {
            try {
                // Zuerst zählen wie viele Datensätze gelöscht werden
                const countResult = await dbService.query(
                    `SELECT COUNT(*) as count FROM ${table} WHERE ${column} = ?`,
                    [guildId]
                );
                
                // Handle das dbService Query-Format
                const countRows = Array.isArray(countResult) ? countResult : [];
                const recordCount = countRows[0]?.count || 0;
                
                if (recordCount > 0) {
                    // Datensätze löschen
                    const result = await dbService.query(
                        `DELETE FROM ${table} WHERE ${column} = ?`,
                        [guildId]
                    );
                    
                    const deleted = result.affectedRows || recordCount;
                    stats.totalDeleted += deleted;
                    
                    Logger.debug(`🗑️  ${table}: ${deleted} Datensätze gelöscht`);
                } else {
                    Logger.debug(`⏭️  ${table}: Keine Daten vorhanden`);
                }
                
                stats.tablesProcessed++;
                
            } catch (error) {
                stats.errors.push(`Fehler beim Löschen aus ${table}: ${error.message}`);
                Logger.warn(`⚠️  Fehler beim Bereinigen der Tabelle ${table}:`, error.message);
            }
        }

        return stats;
        
    } catch (error) {
        stats.errors.push(`Kritischer Fehler bei der dynamischen Bereinigung: ${error.message}`);
        throw error;
    }
}