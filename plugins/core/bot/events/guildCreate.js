const { ServiceManager } = require("dunebot-core");
const { NavigationManager } = require("dunebot-sdk");
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
        const existingConfig = await dbService.getConfigs(guild.id, "core", "shared");
        
        if (!existingConfig || !existingConfig.ENABLED_PLUGINS) {
            Logger.info(`📝 Neue Guild - initialisiere Config und Navigation für ${guild.id}`);
            
            // 4. Guild-spezifische Konfiguration initialisieren
            await initGuildConfigs(guild.id, defaultConfig);
            
            // 5. Standard-Navigation für Guild erstellen
            await registerGuildNavigation(guild.id);
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

/**
 * Registriert die Standard-Navigation für eine Guild nach WordPress-Muster
 * @param {Object} dbService - DBService-Instance
 * @param {string} guildId - Discord Guild ID
 * @param {Object} plugin - Core-Plugin-Instance
 */
async function registerGuildNavigation(guildId) {

    const Logger = ServiceManager.get("Logger");

    try {
        
        const navManager = new NavigationManager();
        
        // 1. Hauptmenüpunkte
        const mainMenuItems = [
            {
                title: "Dashboard",
                url: `/guild/${guildId}`,
                icon: "fa-gauge-high",
                order: 10
            },
            {
                title: "Plugins",
                url: `/guild/${guildId}/plugins`,
                icon: "fa-puzzle-piece",
                order: 20
            },
            {
                title: "Befehle",
                url: `/guild/${guildId}/commands`,
                icon: "fa-terminal",
                order: 30
            },
            {
                title: "Einstellungen",
                url: `/guild/${guildId}/settings`,
                icon: "fa-cog",
                order: 80
            }
        ];
        
        // 2. Untermenüs für Einstellungen
        const settingsSubmenus = [
            {
                title: "Allgemein",
                url: `/Guild/${guildId}/settings/general`,
                icon: "fa-sliders",
                parent: `/guild/${guildId}/settings`,
                order: 10
            },
            {
                title: "Sprache",
                url: `/guild/${guildId}/settings/language`,
                icon: "fa-language",
                parent: `/guild/${guildId}/settings`,
                order: 20
            }
        ];
        
        // 3. Dashboard-Widgets
        const dashboardWidgets = [
            {
                title: "Server-Übersicht",
                url: "core-server-overview",
                type: "widget",
                icon: "fa-server",
                order: 10
            },
            {
                title: "Aktivität",
                url: "core-activity",
                type: "widget",
                icon: "fa-chart-line",
                order: 20
            }
        ];
        
        // Alle Menüpunkte zusammenfassen
        const allNavItems = [...mainMenuItems, ...settingsSubmenus, ...dashboardWidgets];
        
        // Navigation registrieren
        await navManager.registerNavigation("core", guildId, allNavItems);
        
        Logger.info(`Standard-Navigation für Guild ${guildId} erfolgreich registriert`);
    } catch (error) {
        Logger.error(`Fehler beim Erstellen der Navigation für Guild ${guildId}:`, error);
    }
}

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

        // Alle Config-Einträge setzen
        for (const [key, value] of Object.entries(flatConfig)) {
            await dbService.setConfig(
                "core",
                key,
                value,
                "shared",
                guildId,
                false
            );
        }

        // ENABLED_PLUGINS separat setzen (Array wird als JSON gespeichert)
        await dbService.setConfig(
            "core",
            "ENABLED_PLUGINS", 
            JSON.stringify(['core']),
            "shared",
            guildId,
            false
        );

        Logger.info(`Guild-Konfiguration für ${guildId} initialisiert`);
    } catch (error) {
        Logger.error(`Fehler beim Initialisieren der Guild-Konfiguration für ${guildId}:`, error);
        throw error;
    }
}