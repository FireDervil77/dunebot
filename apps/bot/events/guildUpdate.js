const { ServiceManager } = require("dunebot-core");

/**
 * Kern-Event: guildUpdate
 * Synchronisiert geänderte Guild-Informationen (Name, Owner) in die DB.
 *
 * @param {import('discord.js').Guild} oldGuild
 * @param {import('discord.js').Guild} newGuild
 */
module.exports = async (oldGuild, newGuild) => {
    const Logger = ServiceManager.get("Logger");
    const dbService = ServiceManager.get("dbService");

    try {
        if (oldGuild.ownerId !== newGuild.ownerId || oldGuild.name !== newGuild.name) {
            const owner = newGuild.members.cache.get(newGuild.ownerId) ||
                await newGuild.members.fetch(newGuild.ownerId).catch(() => null);

            await dbService.query(`
                INSERT INTO guilds
                    (_id, guild_name, owner_id, owner_name, joined_at, left_at, updated_at)
                VALUES
                    (?, ?, ?, ?, ?, NULL, NOW())
                ON DUPLICATE KEY UPDATE
                    guild_name = VALUES(guild_name),
                    owner_id   = VALUES(owner_id),
                    owner_name = VALUES(owner_name),
                    left_at    = VALUES(left_at),
                    updated_at = NOW()
            `, [
                newGuild.id,
                newGuild.name,
                newGuild.ownerId,
                owner?.user?.username || null,
                oldGuild.joinedAt,
            ]);

            Logger.info(
                `Guild aktualisiert: ${oldGuild.name} → ${newGuild.name} | ` +
                `Owner: ${oldGuild.ownerId} → ${newGuild.ownerId}`
            );
        }
    } catch (error) {
        Logger.error(`Fehler beim Guild-Update für ${newGuild.name}:`, error);
    }
};
