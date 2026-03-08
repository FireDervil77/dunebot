const { ServiceManager } = require("dunebot-core");
const { ActivityType } = require("discord.js");

/**
 * Kern-Event: ready
 * Wird ausgeführt wenn der Bot sich erfolgreich bei Discord angemeldet hat.
 * Synchronisiert alle bekannten Guilds über den GuildManager.
 *
 * @param {import('discord.js').Client} client
 */
module.exports = async (client) => {
    const Logger = ServiceManager.get("Logger");
    const dbService = ServiceManager.get("dbService");
    const guildManager = ServiceManager.get("guildManager");

    Logger.success(`Eingeloggt als ${client.user.tag}! (${client.user.id})`);
    Logger.info(`Serving ${client.guilds.cache.size} servers`);

    // Bot-Sprache aus der Konfiguration laden
    const config = await client.coreConfig();
    client.defaultLanguage = config?.LOCALE?.DEFAULT || "de-DE";

    // Guild-Locale aus DB setzen
    for (const guild of client.guilds.cache.values()) {
        const settings = await dbService.getConfigs(guild.id);
        guild.locale = settings?.locale || client.defaultLanguage;
    }

    // Alle Guilds synchronisieren
    Logger.info(`Synchronisiere ${client.guilds.cache.size} Guilds...`);
    for (const guild of client.guilds.cache.values()) {
        try {
            await guildManager.syncGuild(guild);
        } catch (error) {
            Logger.error(`Fehler beim Sync der Guild ${guild.name}:`, error);
        }
    }

    // Bot-Status setzen
    try {
        const memberCount = client.guilds.cache.reduce((sum, g) => sum + (g.memberCount || 0), 0);
        const serverCount = client.guilds.cache.size;

        client.user.setPresence({
            activities: [{
                name: `Dune on ${serverCount} Server with ${memberCount} Members!`,
                type: ActivityType.Watching,
            }],
            status: "online",
        });
    } catch (err) {
        Logger.warn(`Konnte Bot-Status nicht setzen: ${err.message}`);
    }

    Logger.success("Bot ist bereit!");
};
