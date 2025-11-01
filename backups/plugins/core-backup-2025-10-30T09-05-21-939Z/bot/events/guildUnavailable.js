const { ServiceManager } = require("dunebot-core");
/**
 * @param {import('discord.js').Guild} guild
 */
module.exports = async (guild) => {
    const Logger = ServiceManager.get("Logger");
    Logger.warn(`Guild Unavailable: ${guild.name}`);
};
