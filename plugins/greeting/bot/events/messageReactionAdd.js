const { EmbedBuilder } = require('discord.js');
const { ServiceManager } = require('dunebot-core');

/**
 * Handles message reactions for:
 * 1. Verification via reaction (verification_type = 'reaction')
 * 2. Reaction Roles (greeting_reaction_panels / greeting_reaction_roles)
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
        // =============================================
        // 1. VERIFICATION via Reaction
        // =============================================
        const [verifySettings] = await dbService.query(
            `SELECT * FROM greeting_settings 
             WHERE guild_id = ? 
               AND verification_enabled = 1 
               AND verification_type = 'reaction' 
               AND verification_message_id = ?`,
            [guild.id, reaction.message.id]
        );

        if (verifySettings) {
            const expectedEmoji = verifySettings.verification_emoji || '✅';
            if (emoji === expectedEmoji || reaction.emoji.name === expectedEmoji) {
                const verifiedRoleId = verifySettings.verification_role_id;
                const unverifiedRoleId = verifySettings.verification_remove_role_id;

                // Already verified?
                if (verifiedRoleId && member.roles.cache.has(verifiedRoleId)) return;

                // Assign verification roles
                if (verifiedRoleId) {
                    const role = guild.roles.cache.get(verifiedRoleId);
                    if (role && guild.members.me.roles.highest.position > role.position) {
                        await member.roles.add(role);
                        Logger.info(`[Greeting] Reaction-verified ${user.tag} — added role ${role.name}`);
                    }
                }
                if (unverifiedRoleId) {
                    const removeRole = guild.roles.cache.get(unverifiedRoleId);
                    if (removeRole && guild.members.me.roles.highest.position > removeRole.position) {
                        await member.roles.remove(removeRole);
                        Logger.info(`[Greeting] Reaction-verified ${user.tag} — removed unverified role ${removeRole.name}`);
                    }
                }

                // Send ephemeral-like DM (reactions can't do ephemeral)
                try {
                    let successDesc = `Du wurdest auf **${guild.name}** verifiziert und hast jetzt vollen Zugang!`;
                    if (settings.verification_success_message) {
                        const placeholders = {
                            '{guild:name}': guild.name,
                            '{server}': guild.name,
                            '{user:name}': user.username,
                            '{user:tag}': user.tag,
                            '{user:mention}': `<@${user.id}>`,
                            '{member:name}': user.username,
                            '{member:mention}': `<@${user.id}>`,
                            '{guild:memberCount}': String(guild.memberCount),
                            '{count}': String(guild.memberCount)
                        };
                        successDesc = settings.verification_success_message;
                        for (const [key, val] of Object.entries(placeholders)) {
                            successDesc = successDesc.replaceAll(key, val);
                        }
                    }
                    const successEmbed = new EmbedBuilder()
                        .setColor(0x57F287)
                        .setTitle('✅ Erfolgreich verifiziert!')
                        .setDescription(successDesc)
                        .setThumbnail(guild.iconURL({ size: 128 }))
                        .setTimestamp();
                    await user.send({ embeds: [successEmbed] });
                } catch {
                    // DMs might be disabled
                }
            }
            return; // Don't process as reaction role
        }

        // =============================================
        // 2. REACTION ROLES
        // =============================================
        const roleRows = await dbService.query(
            `SELECT rr.role_id, rr.description
             FROM greeting_reaction_roles rr
             INNER JOIN greeting_reaction_panels rp ON rr.panel_id = rp.id
             WHERE rp.guild_id = ? AND rp.message_id = ? AND rr.emoji = ?`,
            [guild.id, reaction.message.id, emoji]
        );

        if (roleRows.length > 0) {
            const roleId = roleRows[0].role_id;
            const role = guild.roles.cache.get(roleId);
            if (role && guild.members.me.roles.highest.position > role.position) {
                await member.roles.add(role);
                Logger.info(`[Greeting] Reaction-role added: ${user.tag} → ${role.name}`);
            }
        }
    } catch (error) {
        Logger.error(`[Greeting] messageReactionAdd error for ${user.tag}:`, error);
    }
};
