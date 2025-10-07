const { ServiceManager } = require("dunebot-core");
const path = require("path");
const fs = require("fs");

// Standard-Konfiguration aus config.json laden
const configPath = path.join(__dirname, "../../dashboard/config.json"); 
const defaultConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));

/**
 * Event-Handler für guildCreate-Event (Bot wird zu einer Guild hinzugefügt)
 * @param {import('discord.js').Guild} guild - Die Guild, zu der der Bot hinzugefügt wurde
 * @param {import('dunebot-sdk').BotPlugin} plugin - Das Core-Plugin
 */
module.exports = async (guild) => {
    const Logger = ServiceManager.get("Logger");
    try {    
        Logger.info(`Bot wurde zu Guild hinzugefügt: ${guild.name} (${guild.id})`);
        
        // 1. DBService abrufen
        const dbService = ServiceManager.get("dbService");
        if (!dbService) {
            return Logger.error("DBService nicht verfügbar in guildCreate-Event");
        }

        // 2. Guild in Datenbank speichern/aktualisieren
        await dbService.query(`
            INSERT INTO guilds 
                (_id, guild_name, owner_id, owner_name, joined_at, created_at, updated_at)
            VALUES 
                (?, ?, ?, ?, NOW(), NOW(), NOW())
            ON DUPLICATE KEY UPDATE
                guild_name = VALUES(guild_name),
                owner_id = VALUES(owner_id),
                owner_name = VALUES(owner_name),
                joined_at = VALUES(joined_at),
                left_at = NULL,
                updated_at = NOW()
        `, [
            guild.id,
            guild.name,
            guild.ownerId,
            guild.owner?.user?.username || null,
        ]);
        
        // 3. Prüfen ob Guild bereits konfiguriert ist
        // NEU: Prüfen ob Guild bereits Plugins in guild_plugins hat
        const existingPlugins = await dbService.query(
            'SELECT COUNT(*) as count FROM guild_plugins WHERE guild_id = ?',
            [guild.id]
        );
        
        if (!existingPlugins || existingPlugins[0].count === 0) {
            Logger.info(`📝 Neue Guild - initialisiere Config für ${guild.id}`);
            
            // 4. Guild-spezifische Konfiguration initialisieren
            await initGuildConfigs(guild.id, defaultConfig);
            
            // 5. Core-Plugin in guild_plugins aktivieren
            await dbService.enablePluginForGuild(guild.id, 'core', null, null);
            Logger.info(`Core-Plugin für neue Guild ${guild.id} in guild_plugins aktiviert`);
            
            // 6. Navigation wird beim ersten Dashboard-Zugriff registriert (onGuildEnable)
        } else {
            Logger.info(`✅ Guild ${guild.id} war bereits konfiguriert (Re-Join)`);
        }
        
        // 6. Event an Dashboard senden
        try {
            const ipcClient = guild.client.ipcClient;
            if (ipcClient) {
                await ipcClient.send("dashboard:GUILD_JOINED", {
                    guildId: guild.id,
                    guildName: guild.name
                });
            }
        } catch (ipcError) {
            Logger.warn(`Fehler beim Senden des guild_joined-Events an Dashboard: ${ipcError.message}`);
        }
        
        // 7. Interaction und Command registrieren für die neue guild
        guild.client.wait(5000).then(async () => {
            await guild.client.commandManager.registerInteractions(guild.id);
            guild.client.logger.success(`Registered interactions in ${guild.name}`);
        });

    } catch (error) {
        Logger.error(`Fehler im guildCreate-Event für Guild ${guild.id}:`, error);
    }
};

async function initGuildConfigs(guildId, configObj) {
    const Logger = ServiceManager.get("Logger");
    const dbService = ServiceManager.get("dbService");

    try {
        // Konfiguration flach machen
        const flattenConfig = (obj) => {
            const result = {};
            for (const key in obj) {
                if (typeof obj[key] === 'object' && !Array.isArray(obj[key])) {
                    // Für verschachtelte Objekte
                    const flattened = flattenConfig(obj[key]);
                    for (const subKey in flattened) {
                        result[`${key}_${subKey}`] = flattened[subKey];
                    }
                } else {
                    // Für einfache Werte
                    result[key] = obj[key];
                }
            }
            return result;
        };

        // Konfiguration flach machen
        const flatConfig = flattenConfig(configObj);

        // ensureConfigs() statt setConfig() - überschreibt KEINE existierenden Configs!
        const stats = await dbService.ensureConfigs(
            "core",
            flatConfig,
            "shared",
            guildId
        );

        // HINWEIS: ENABLED_PLUGINS wird nicht mehr in configs gespeichert!
        // Plugins werden über guild_plugins Tabelle verwaltet
        // Core-Plugin wurde bereits in guildCreate-Event via enablePluginForGuild() aktiviert

        Logger.info(`Guild-Konfiguration für ${guildId}: ${stats.created} neu erstellt, ${stats.existing} bereits vorhanden`);
    } catch (error) {
        Logger.error(`Fehler beim Initialisieren der Guild-Konfiguration für ${guildId}:`, error);
        throw error;
    }
}