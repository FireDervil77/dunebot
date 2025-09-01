const { ServiceManager } = require("dunebot-core");

/**
 * Event-Handler für guildCreate-Event (Bot wird zu einer Guild hinzugefügt)
 * @param {import('discord.js').Guild} guild - Die Guild, zu der der Bot hinzugefügt wurde
 * @param {import('dunebot-sdk').BotPlugin} plugin - Das Core-Plugin
 */
module.exports = async (guild) => {
    try {
        Logger.info(`Bot wurde zu Guild hinzugefügt: ${guild.name} (${guild.id})`);
        
        // 1. DBService abrufen
        const dbService = ServiceManager.get("dbService");
        if (!dbService) {
            return Logger.error("DBService nicht verfügbar in guildCreate-Event");
        }
        
        // 2. Guild in Datenbank speichern/aktualisieren
        const GuildModel = dbService.getModel("Guild");
        if (GuildModel) {
            await GuildModel.upsert({
                _id: guild.id,
                guild_name: guild.name,
                owner_id: guild.ownerId,
                owner_name: guild.owner_name,
                //region: guild.preferredLocale || "en-US",
                joined_at: new Date(),
                created_at: new Date()
            });
            Logger.info(`Guild ${guild.id} in Datenbank gespeichert`);
        }
        
        // 3. Standard-Einstellungen initialisieren
        await dbService.initGuildSettings(guild.id, {
            prefix: "!",
            locale: "de-DE",
            enabled_plugins: JSON.stringify(["core"])
        });
        
        // 4. Standard-Navigation für Guild erstellen
        await registerGuildNavigation(dbService, guild.id);
        
        // 5. Event an Dashboard senden
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
        
        // 6. Interaction und Command registrieren für die neue guild
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
async function registerGuildNavigation(dbService, guildId) {
    const dbService = ServiceManager.get("dbService");
    const Logger = ServiceManager.get("Logger");
  try {
        const { NavigationManager } = require("dunebot-sdk");
        navManager = new NavigationManager(dbService);
        
        // Standard-Navigation für WordPress-ähnliches Dashboard
        // 1. Hauptmenüpunkte
        const mainMenuItems = [
            {
                title: "Dashboard",
                url: `/admin/servers/${guildId}`,
                icon: "fa-gauge-high",
                order: 10
            },
            {
                title: "Plugins",
                url: `/admin/servers/${guildId}/plugins`,
                icon: "fa-puzzle-piece",
                order: 20
            },
            {
                title: "Befehle",
                url: `/admin/servers/${guildId}/commands`,
                icon: "fa-terminal",
                order: 30
            },
            {
                title: "Einstellungen",
                url: `/admin/servers/${guildId}/settings`,
                icon: "fa-cog",
                order: 80
            }
        ];
        
        // 2. Untermenüs für Einstellungen
        const settingsSubmenus = [
            {
                title: "Allgemein",
                url: `/admin/servers/${guildId}/settings/general`,
                icon: "fa-sliders",
                parent: `/admin/servers/${guildId}/settings`,
                order: 10
            },
            {
                title: "Sprache",
                url: `/admin/servers/${guildId}/settings/language`,
                icon: "fa-language",
                parent: `/admin/servers/${guildId}/settings`,
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