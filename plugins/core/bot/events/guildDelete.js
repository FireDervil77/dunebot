const { ServiceManager } = require("dunebot-core");

/**
 * @param {import('discord.js').Guild} guild
 */
module.exports = async (guild, plugin) => {
    const dbService = ServiceManager.get("dbService");
    const Logger = ServiceManager.get("Logger");

    if (!guild.available) return;
    Logger.info(`Guild Left: ${guild.name} Members: ${guild.memberCount}`);

    // Mark guild as left (MySQL/Sequelize)
    const Guild = dbService.getModel("Guild");
    if (Guild.upsert) {
        await Guild.upsert({
            _id: guild.id,
            guild_name: guild.name,
            joined_at: guild.joinedAt,
            left_at: new Date()
        });
    } 
};