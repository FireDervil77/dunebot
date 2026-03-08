const { ServiceManager } = require("dunebot-core");

/**
 * Kern-Event: guildCreate
 * Wird ausgeführt wenn der Bot zu einer neuen Guild hinzugefügt wird.
 * Delegiert die gesamte Logik an den GuildManager.
 *
 * @param {import('discord.js').Guild} guild
 */
module.exports = async (guild) => {
    const Logger = ServiceManager.get("Logger");
    const guildManager = ServiceManager.get("guildManager");

    try {
        await guildManager.registerGuild(guild);

        // Slash-Commands für die neue Guild registrieren (verzögert)
        guild.client.wait(5000).then(async () => {
            await guild.client.commandManager.registerInteractions(guild.id);
            Logger.success(`Interactions in ${guild.name} registriert`);
        });
    } catch (error) {
        Logger.error(`Fehler im guildCreate-Event für Guild ${guild.id}:`, error);
    }
};
