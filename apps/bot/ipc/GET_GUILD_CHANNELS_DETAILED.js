/**
 * IPC Handler: GET_GUILD_CHANNELS_DETAILED
 * 
 * Liefert ALLE Channels einer Guild inkl. Kategorien, Voice, Stage, Forum etc.
 * Für die Dashboard Channel-Verwaltung (Spiegel der Discord-Channels).
 * 
 * @param {object} payload - { guildId }
 * @param {import('discord.js').Client} client
 * @returns {object} { success, channels, categories, botHasManageChannels }
 */
const { ChannelType, PermissionsBitField } = require('discord.js');
const { ServiceManager } = require('dunebot-core');

// Channel-Typen lesbar machen
const CHANNEL_TYPE_NAMES = {
    [ChannelType.GuildText]: 'text',
    [ChannelType.GuildVoice]: 'voice',
    [ChannelType.GuildCategory]: 'category',
    [ChannelType.GuildAnnouncement]: 'announcement',
    [ChannelType.GuildStageVoice]: 'stage',
    [ChannelType.GuildForum]: 'forum',
    [ChannelType.GuildMedia]: 'media',
};

const CHANNEL_TYPE_ICONS = {
    text: 'fa-hashtag',
    voice: 'fa-volume-high',
    category: 'fa-folder',
    announcement: 'fa-bullhorn',
    stage: 'fa-podcast',
    forum: 'fa-comments',
    media: 'fa-images',
};

module.exports = async (payload, client) => {
    const Logger = ServiceManager.get('Logger');
    const { guildId } = payload;

    if (!guildId) {
        return { success: false, error: 'Guild-ID ist erforderlich' };
    }

    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
        return { success: false, error: 'Guild nicht gefunden' };
    }

    const botMember = guild.members.me;
    const botHasManageChannels = botMember
        ? botMember.permissions.has(PermissionsBitField.Flags.ManageChannels)
        : false;

    try {
        // Kategorien zuerst sammeln
        const categories = guild.channels.cache
            .filter(ch => ch.type === ChannelType.GuildCategory)
            .sort((a, b) => a.position - b.position)
            .map(cat => ({
                id: cat.id,
                name: cat.name,
                position: cat.position,
                type: 'category',
                icon: CHANNEL_TYPE_ICONS.category,
            }));

        // Alle nicht-Kategorie Channels
        const channels = guild.channels.cache
            .filter(ch => ch.type !== ChannelType.GuildCategory)
            .sort((a, b) => a.position - b.position)
            .map(ch => {
                const typeName = CHANNEL_TYPE_NAMES[ch.type] || 'unknown';
                return {
                    id: ch.id,
                    name: ch.name,
                    type: typeName,
                    icon: CHANNEL_TYPE_ICONS[typeName] || 'fa-circle',
                    position: ch.position,
                    parentId: ch.parentId || null,
                    parentName: ch.parent ? ch.parent.name : null,
                    topic: ch.topic || null,
                    nsfw: ch.nsfw || false,
                    rateLimitPerUser: ch.rateLimitPerUser || 0,
                    bitrate: ch.bitrate || null,
                    userLimit: ch.userLimit || null,
                    createdAt: ch.createdTimestamp,
                };
            });

        Logger.debug(`[IPC] GET_GUILD_CHANNELS_DETAILED: ${channels.length} Channels + ${categories.length} Kategorien für Guild ${guildId}`);

        return {
            success: true,
            channels,
            categories,
            botHasManageChannels,
            channelTypeIcons: CHANNEL_TYPE_ICONS,
        };
    } catch (error) {
        Logger.error(`[IPC] GET_GUILD_CHANNELS_DETAILED Fehler:`, error);
        return { success: false, error: error.message };
    }
};
