const { ServiceManager } = require("dunebot-core");
const { ActivityType } = require('discord.js');
const path = require("path");
const fs = require("fs");

// Standard-Konfiguration aus config.json laden
const configPath = path.join(__dirname, "../../dashboard/config.json"); 
const defaultConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));

/**
 * Ready-Event für den Bot
 * Wird ausgeführt, wenn der Bot sich bei Discord angemeldet hat
 * Initialisiert Guilds, lädt Einstellungen und registriert Befehle
 * 
 * @author firedervil
 * @param {import('discord.js').Client} client
 */
module.exports = async (client) => {
    const dbService = ServiceManager.get("dbService");
    const Logger = ServiceManager.get('Logger');
    
    Logger.success(`Logged in as ${client.user.tag}! (${client.user.id})`);
    Logger.info(`Serving ${client.guilds.cache.size} servers`);
    
    // DEBUG: Alle Guild-IDs ausgeben
    Logger.info(`📋 Guilds im Cache:`);
    client.guilds.cache.forEach(guild => {
        Logger.info(`  - ${guild.name} (${guild.id})`);
    });

    // Core-Plugin-Instanz abrufen
    const corePlugin = client.pluginManager.getPlugin("core");
    if (!corePlugin) {
        throw new Error("Core plugin not found in ready.js");
    }

    // Bot-Sprache aus der Konfiguration laden
    const config = await client.coreConfig();
    client.defaultLanguage = config?.LOCALE?.DEFAULT || "de-DE";

    // Guild-Einstellungen laden und Sprache setzen
    for (const guild of client.guilds.cache.values()) {
        const settings = await dbService.getConfigs(guild.id);
        guild.locale = settings?.locale || client.defaultLanguage;
    }

    // Guilds in der Datenbank initialisieren/aktualisieren
    Logger.info(`🔄 Initialisiere ${client.guilds.cache.size} Guilds...`);
    for (const guild of client.guilds.cache.values()) {
        try {
            // Guild-Besitzer abrufen, wenn nicht im Cache
            const owner = guild.members.cache.get(guild.ownerId) || 
                        await guild.members.fetch(guild.ownerId).catch(() => null);
            
            // 1. Guild in DB speichern/aktualisieren
            await dbService.upsertGuild({
                _id: guild.id,
                name: guild.name,
                owner_id: guild.ownerId,
                owner_name: owner?.user.username || null,
                joined_at: guild.joinedAt ? new Date(guild.joinedAt) : new Date(),
                left_at: null
            });
            
            // 2. Prüfen ob Config bereits existiert
            const existingConfig = await dbService.getConfigs(guild.id, "core", "shared");
            
            if (!existingConfig || !existingConfig.ENABLED_PLUGINS) {
                Logger.info(`📝 Initialisiere Config für Guild "${guild.name}" (${guild.id})`);
                
                // Config initialisieren
                await initGuildConfigs(guild.id, defaultConfig);
                
                // Navigation registrieren
                await registerGuildNavigation(guild.id);
            } else {
                Logger.debug(`✅ Guild "${guild.name}" (${guild.id}) bereits konfiguriert`);
            }
            
        } catch (error) {
            Logger.error(`Fehler beim Initialisieren der Guild ${guild.name}:`, error);
        }
    }

    try {
        // Mitglieder und Server zählen
        const memberCount = client.guilds.cache.reduce((sum, guild) => sum + (guild.memberCount || 0), 0);
        const serverCount = client.guilds.cache.size;

        // Status-Text mit Platzhaltern
        const message = ` Dune with ${memberCount} on ${serverCount}!`;

        client.user.setPresence({
            activities: [{
                name: message,
                type: ActivityType.Playing
            }],
            status: "online"
        });

        // Optional: Status regelmäßig aktualisieren (z.B. alle 10 Minuten)
        setInterval(async () => {
            const memberCount = client.guilds.cache.reduce((sum, guild) => sum + (guild.memberCount || 0), 0);
            const serverCount = client.guilds.cache.size;
            const message = ` Dune with ${memberCount} on ${serverCount}!`;
            client.user.setPresence({
                activities: [{
                    name: message,
                    type: ActivityType.Playing
                }],
                status: "online"
            });
        }, 1000 * 60 * 10);

        console.log(`[CORE] Presence gesetzt: ${message}`);
    } catch (error) {
        console.error("[CORE] Fehler beim Setzen des Presence-Status:", error);
    }

    // Interaktionen registrieren mit Verzögerung
    client.wait(5000).then(() => {
        client.guilds.cache.forEach(async (guild) => {
            await client.commandManager.registerInteractions(guild.id);
        });
        Logger.success("Interaktionen erfolgreich registriert");
    });
};

/**
 * Registriert die Standard-Navigation für eine Guild
 * @param {string} guildId - Discord Guild ID
 */
async function registerGuildNavigation(guildId) {
    const Logger = ServiceManager.get("Logger");
    const { NavigationManager } = require("dunebot-sdk");

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
                url: `/guild/${guildId}/settings/general`,
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
        
        Logger.debug(`Navigation für Guild ${guildId} registriert`);
    } catch (error) {
        Logger.error(`Fehler beim Erstellen der Navigation für Guild ${guildId}:`, error);
    }
}

/**
 * Initialisiert die Guild-Konfiguration
 * @param {string} guildId - Discord Guild ID
 * @param {Object} configObj - Default-Konfiguration
 */
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

        Logger.debug(`Config für Guild ${guildId} initialisiert`);
    } catch (error) {
        Logger.error(`Fehler beim Initialisieren der Config für Guild ${guildId}:`, error);
        throw error;
    }
}