const ems = require('enhanced-ms');

/**
 * /giveaway template create <name>
 * /giveaway template use <name> <channel>
 * /giveaway template list
 * /giveaway template delete <name>
 * @param {import('discord.js').GuildMember} member
 * @param {string} action - create/use/list/delete
 * @param {string} name
 * @param {object} options - {channel, prize, duration, winnerCount, ...}
 */
module.exports = async (member, action, name, options = {}) => {
    try {
        const { guild, client } = member;

        if (!member.permissions.has('ManageMessages'))
            return guild.getT('giveaways:MEMBER_PERMS');

        const manager = client.giveawayManager;
        if (!manager) return '❌ Giveaway system not available.';

        if (action === 'list') {
            const templates = await manager.getTemplates(guild.id);
            if (!templates.length) return guild.getT('giveaways:TEMPLATE_EMPTY');

            const entries = templates.map((t, i) => {
                const cfg = t.config;
                const dur = cfg.duration ? ems(cfg.duration, { shortFormat: true }) : '?';
                return `**${i + 1}.** \`${t.name}\` — ${cfg.prize || '?'} (${dur}, ${cfg.winnerCount || 1} Gewinner)`;
            }).join('\n');

            return { embeds: [{
                title: guild.getT('giveaways:TEMPLATE_LIST_TITLE'),
                description: entries,
                color: 0xf59e0b,
            }] };
        }

        if (!name) return guild.getT('giveaways:TEMPLATE_NO_NAME');

        if (action === 'create') {
            if (!options.prize || !options.duration) {
                return guild.getT('giveaways:TEMPLATE_CREATE_MISSING');
            }

            const durationMs = ems(options.duration);
            if (!durationMs) return guild.getT('giveaways:START_INVALID_DURATION');

            const config = {
                prize: options.prize,
                duration: durationMs,
                winnerCount: parseInt(options.winnerCount) || 1,
                embedColor: options.embedColor || '#f59e0b',
                buttonEmoji: '🎁',
            };

            const result = await manager.createTemplate(guild.id, name, config, member.id);
            if (result.error === 'template_exists') return guild.getT('giveaways:TEMPLATE_EXISTS', { name });
            return guild.getT('giveaways:TEMPLATE_CREATED', { name });
        }

        if (action === 'use') {
            const template = await manager.getTemplate(guild.id, name);
            if (!template) return guild.getT('giveaways:TEMPLATE_NOT_FOUND', { name });

            if (!options.channel) return guild.getT('giveaways:TEMPLATE_NO_CHANNEL');

            const cfg = template.config;
            await manager.createGiveaway(guild.id, options.channel.id, {
                prize: cfg.prize,
                duration: cfg.duration,
                winnerCount: cfg.winnerCount || 1,
                createdBy: member.id,
                hostedBy: member.id,
                embedColor: cfg.embedColor,
                buttonEmoji: cfg.buttonEmoji,
            });

            return guild.getT('giveaways:TEMPLATE_USED', { name, channel: options.channel.toString() });
        }

        if (action === 'delete') {
            const result = await manager.deleteTemplate(guild.id, name);
            if (!result.success) return guild.getT('giveaways:TEMPLATE_NOT_FOUND', { name });
            return guild.getT('giveaways:TEMPLATE_DELETED', { name });
        }

        return guild.getT('INVALID_SUBCOMMAND', { sub: action });
    } catch (error) {
        member.client.logger?.error?.('Giveaway Template', error);
        return member.guild.getT('giveaways:TEMPLATE_ERROR');
    }
};
