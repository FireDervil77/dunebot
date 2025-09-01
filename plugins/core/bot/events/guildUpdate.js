const { ServiceManager } = require("dunebot-core");

/**
 * @param {import('discord.js').Guild} oldGuild
 * @param {import('discord.js').Guild} newGuild
 */
module.exports = async function(oldGuild, newGuild) {
    const dbService = ServiceManager.get("dbService");
    const Logger = ServiceManager.get("Logger");
    
    try {
        // Only update if owner or name changed
        if (oldGuild.ownerId !== newGuild.ownerId || oldGuild.name !== newGuild.name) {
            const owner = newGuild.members.cache.get(newGuild.ownerId) || 
                         await newGuild.members.fetch(newGuild.ownerId).catch(() => null);

            const Guild = dbService.getModel("Guild");
            await Guild.upsert({
                _id: newGuild.id,
                guild_name: newGuild.name,
                owner_id: newGuild.ownerId,
                owner_name: owner?.user.username || null,
                joined_at: oldGuild.joinedAt,
                left_at: null
            });

            Logger.info(
                `Guild Updated: ${oldGuild.name} -> ${newGuild.name} ` +
                `Owner: ${oldGuild.ownerId} -> ${newGuild.ownerId}`
            );
        }
    } catch (error) {
        Logger.error(`Failed to update guild ${newGuild.name}:`, error);
    }
};