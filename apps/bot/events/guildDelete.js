const { ServiceManager } = require("dunebot-core");

/**
 * Kern-Event: guildDelete
 * Wird ausgeführt wenn der Bot eine Guild verlässt oder entfernt wird.
 * Delegiert Cleanup an den GuildManager.
 *
 * @param {import('discord.js').Guild} guild
 */
module.exports = async (guild) => {
    const Logger = ServiceManager.get("Logger");
    const guildManager = ServiceManager.get("guildManager");

    try {
        await guildManager.removeGuild(guild);
    } catch (error) {
        Logger.error(`Fehler im guildDelete-Event für Guild ${guild.id}:`, error);
    }
};
