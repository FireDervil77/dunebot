const { ServiceManager } = require('dunebot-core');

/**
 * Handles giveaway button interactions (join/leave + claim)
 * @param {import('discord.js').BaseInteraction} interaction
 */
module.exports = async (interaction) => {
    if (!interaction.isButton()) return;
    if (!interaction.customId.startsWith('giveaway_')) return;

    const Logger = ServiceManager.get('Logger');
    const { guild, user, member } = interaction;
    const manager = interaction.client.giveawayManager;

    if (!manager) {
        return interaction.reply({ content: '❌ Giveaway system not available.', ephemeral: true });
    }

    // ═══ Claim Button ═══
    if (interaction.customId.startsWith('giveaway_claim_')) {
        const giveawayId = parseInt(interaction.customId.replace('giveaway_claim_', ''), 10);
        if (isNaN(giveawayId)) return;

        try {
            await interaction.deferReply({ ephemeral: true });

            const result = await manager.claimPrize(giveawayId, user.id);

            if (result.error === 'not_winner') {
                return interaction.followUp({ content: guild.getT('giveaways:CLAIM_NOT_WINNER'), ephemeral: true });
            }
            if (result.error === 'already_claimed') {
                return interaction.followUp({ content: guild.getT('giveaways:CLAIM_ALREADY'), ephemeral: true });
            }
            if (result.error === 'claim_expired') {
                return interaction.followUp({ content: guild.getT('giveaways:CLAIM_EXPIRED'), ephemeral: true });
            }

            return interaction.followUp({
                content: guild.getT('giveaways:CLAIM_SUCCESS'),
                ephemeral: true,
            });
        } catch (error) {
            Logger.error('Giveaway claim error', error);
            if (interaction.deferred || interaction.replied) {
                return interaction.followUp({ content: guild.getT('giveaways:JOIN_ERROR'), ephemeral: true });
            }
            return interaction.reply({ content: '❌ An error occurred.', ephemeral: true });
        }
    }

    // ═══ Join/Leave Button ═══
    if (!interaction.customId.startsWith('giveaway_join_')) return;

    const giveawayId = parseInt(interaction.customId.replace('giveaway_join_', ''), 10);
    if (isNaN(giveawayId)) return;

    try {
        await interaction.deferReply({ ephemeral: true });

        const giveaway = await manager.getGiveaway(giveawayId);
        if (!giveaway) {
            return interaction.followUp({ content: guild.getT('giveaways:JOIN_NOT_FOUND'), ephemeral: true });
        }

        if (giveaway.status !== 'active') {
            return interaction.followUp({ content: guild.getT('giveaways:JOIN_NOT_ACTIVE'), ephemeral: true });
        }

        // Blacklist-Check
        if (await manager.isBlacklisted(guild.id, user.id)) {
            return interaction.followUp({
                content: guild.getT('giveaways:JOIN_BLACKLISTED'),
                ephemeral: true,
            });
        }

        // Requirements-Check
        const reqCheck = await manager.checkRequirements(giveawayId, user.id);
        if (!reqCheck.passed) {
            let msg = guild.getT('giveaways:JOIN_REQUIREMENT_FAILED');
            if (reqCheck.reason === 'missing_role') {
                msg = guild.getT('giveaways:JOIN_ROLE_REQUIRED', { roles: reqCheck.detail });
            } else if (reqCheck.reason === 'account_too_young') {
                msg = guild.getT('giveaways:JOIN_ACCOUNT_TOO_YOUNG', { days: reqCheck.detail });
            } else if (reqCheck.reason === 'server_too_young') {
                msg = guild.getT('giveaways:JOIN_SERVER_TOO_YOUNG', { days: reqCheck.detail });
            }
            return interaction.followUp({ content: msg, ephemeral: true });
        }

        // Check allowed roles (legacy)
        if (giveaway.allowed_roles) {
            const roles = typeof giveaway.allowed_roles === 'string'
                ? JSON.parse(giveaway.allowed_roles)
                : giveaway.allowed_roles;

            if (Array.isArray(roles) && roles.length > 0) {
                const hasRole = roles.some(roleId => member.roles.cache.has(roleId));
                if (!hasRole) {
                    const roleNames = roles
                        .map(id => guild.roles.cache.get(id)?.name)
                        .filter(Boolean)
                        .join(', ');
                    return interaction.followUp({
                        content: guild.getT('giveaways:JOIN_ROLE_REQUIRED', { roles: roleNames }),
                        ephemeral: true,
                    });
                }
            }
        }

        const result = await manager.addEntry(giveawayId, user.id);

        if (result.error === 'already_entered') {
            // Toggle: remove entry
            await manager.removeEntry(giveawayId, user.id);
            const entryCount = await manager.getEntryCount(giveawayId);
            await manager._updateEmbedActive(giveaway, entryCount);
            return interaction.followUp({
                content: guild.getT('giveaways:JOIN_LEFT', { prize: giveaway.prize }),
                ephemeral: true,
            });
        }

        if (result.error === 'blacklisted') {
            return interaction.followUp({
                content: guild.getT('giveaways:JOIN_BLACKLISTED'),
                ephemeral: true,
            });
        }

        if (result.error) {
            return interaction.followUp({
                content: guild.getT('giveaways:JOIN_ERROR'),
                ephemeral: true,
            });
        }

        return interaction.followUp({
            content: guild.getT('giveaways:JOIN_SUCCESS', {
                prize: giveaway.prize,
                entries: result.entryCount,
            }),
            ephemeral: true,
        });
    } catch (error) {
        Logger.error('Giveaway interactionCreate', error);
        if (interaction.deferred || interaction.replied) {
            return interaction.followUp({ content: guild.getT('giveaways:JOIN_ERROR'), ephemeral: true });
        }
        return interaction.reply({ content: '❌ An error occurred.', ephemeral: true });
    }
};
