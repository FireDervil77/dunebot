const { ServiceManager } = require('dunebot-core');

/**
 * Handles reaction removal for Reaction Roles
 * When a user removes their reaction, the corresponding role is removed
 */
module.exports = async (reaction, user) => {
    if (user.bot) return;

    // Handle partial reactions
    if (reaction.partial) {
        try { await reaction.fetch(); } catch { return; }
    }
    if (reaction.message.partial) {
        try { await reaction.message.fetch(); } catch { return; }
    }

    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const { guild } = reaction.message;
    if (!guild) return;

    const member = await guild.members.fetch(user.id).catch(() => null);
    if (!member) return;

    const emoji = reaction.emoji.id
        ? `<:${reaction.emoji.name}:${reaction.emoji.id}>`
        : reaction.emoji.name;

    try {
        // Only handle reaction roles (not verification — verification stays)
        const roleRows = await dbService.query(
            `SELECT rr.role_id
             FROM greeting_reaction_roles rr
             INNER JOIN greeting_reaction_panels rp ON rr.panel_id = rp.id
             WHERE rp.guild_id = ? AND rp.message_id = ? AND rr.emoji = ?`,
            [guild.id, reaction.message.id, emoji]
        );

        if (roleRows.length > 0) {
            const roleId = roleRows[0].role_id;
            const role = guild.roles.cache.get(roleId);
            if (role && guild.members.me.roles.highest.position > role.position) {
                await member.roles.remove(role);
                Logger.info(`[Greeting] Reaction-role removed: ${user.tag} → ${role.name}`);
            }
        }
    } catch (error) {
        Logger.error(`[Greeting] messageReactionRemove error for ${user.tag}:`, error);
    }
};
