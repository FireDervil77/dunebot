const { ServiceManager } = require("dunebot-core");

/**
 * @param {import('discord.js').Guild} guild
 */
module.exports = async (guild, plugin) => {
    const Logger = ServiceManager.get("Logger");
    const dbService = ServiceManager.get("dbService");
    if (!guild.available) return;
    Logger.info(`Guild Left: ${guild.name} Members: ${guild.memberCount}`);

    // Mark guild as left (MySQL/Sequelize)
    await dbService.query(`UPDATE guilds SET left_at = NOW(), updated_at = NOW() WHERE _id = ?`, [guild.id]);

    await dbService.deleteConfig("core", null, "shared", guild.id);
    Logger.info(`Alle Konfigurationen für Guild ${guild.id} wurden entfernt.`);
};