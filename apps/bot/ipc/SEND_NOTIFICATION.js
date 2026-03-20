'use strict';

const { ServiceManager } = require('dunebot-core');
const { EmbedBuilder } = require('discord.js');

/**
 * Kern-IPC-Handler: SEND_NOTIFICATION
 * Sendet eine mehrsprachige Notification an Discord-Channels oder per DM.
 */
module.exports = async (payload, client) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');

    try {
        const {
            id,
            title_translations,
            message_translations,
            action_text_translations,
            type,
            action_url,
            delivery_method,
            target_guild_ids,
            discord_channel_id
        } = payload;

        const parse = (val) => typeof val === 'string' ? JSON.parse(val) : (val || {});
        const titleTranslations = parse(title_translations);
        const messageTranslations = parse(message_translations);
        const actionTextTranslations = parse(action_text_translations);
        const targetGuildIds = typeof target_guild_ids === 'string'
            ? JSON.parse(target_guild_ids)
            : (target_guild_ids || []);

        // delivery_method: Backward-compat (String → Array)
        let methods;
        try {
            methods = typeof delivery_method === 'string' ? JSON.parse(delivery_method) : delivery_method;
            if (!Array.isArray(methods)) methods = [delivery_method];
        } catch (e) {
            methods = [delivery_method || 'dashboard'];
        }
        // Legacy 'all' expanden
        if (methods.includes('all')) {
            methods = ['dashboard', 'system_channel', 'discord_channel', 'discord_dm'];
        }

        const embedColors = { info: 0x3498db, warning: 0xf39c12, error: 0xe74c3c, success: 0x2ecc71 };
        const sentMessageIds = {};

        for (const guildId of targetGuildIds) {
            const guild = client.guilds.cache.get(guildId);
            if (!guild) {
                Logger.warn(`[IPC] SEND_NOTIFICATION: Guild ${guildId} nicht im Cache, überspringe`);
                continue;
            }

            // Guild-Locale aus DB
            const [localeRow] = await dbService.query(
                "SELECT config_value FROM configs WHERE plugin_name = 'core' AND config_key = 'LOCALE' AND guild_id = ? AND context = 'shared'",
                [guildId]
            );
            const locale = localeRow?.config_value || 'de-DE';

            const title = titleTranslations[locale] || titleTranslations['de-DE'] || 'Notification';
            const message = messageTranslations[locale] || messageTranslations['de-DE'] || '';
            const actionText = actionTextTranslations[locale] || actionTextTranslations['de-DE'] || 'Mehr erfahren';

            const embed = new EmbedBuilder()
                .setTitle(title)
                .setDescription(message)
                .setColor(embedColors[type] || embedColors.info)
                .setTimestamp()
                .setFooter({ text: `Notification #${id}` });

            if (action_url) {
                embed.addFields({ name: actionText, value: `[🔗 ${action_url}](${action_url})`, inline: false });
            }

            if (methods.includes('system_channel')) {
                const systemChannel = guild.systemChannel;
                if (systemChannel?.isTextBased()) {
                    try {
                        const sent = await systemChannel.send({ embeds: [embed] });
                        sentMessageIds[guildId] = sentMessageIds[guildId] || {};
                        sentMessageIds[guildId].systemChannel = sent.id;
                    } catch (e) {
                        Logger.error(`[IPC] SEND_NOTIFICATION: SystemChannel-Fehler in ${guild.name}:`, e);
                    }
                }
            }

            if (methods.includes('discord_channel') && discord_channel_id) {
                const targetChannel = guild.channels.cache.get(discord_channel_id);
                if (targetChannel?.isTextBased()) {
                    try {
                        const sent = await targetChannel.send({ embeds: [embed] });
                        sentMessageIds[guildId] = sentMessageIds[guildId] || {};
                        sentMessageIds[guildId].channel = sent.id;
                    } catch (e) {
                        Logger.error(`[IPC] SEND_NOTIFICATION: Channel-Fehler in ${guild.name}:`, e);
                    }
                }
            }

            if (methods.includes('discord_dm')) {
                try {
                    const members = await guild.members.fetch();
                    const admins = members.filter(m => m.permissions.has('ManageGuild') && !m.user.bot);
                    const dmIds = [];
                    for (const [, member] of admins) {
                        try {
                            const dm = await member.createDM();
                            const sent = await dm.send({ embeds: [embed] });
                            dmIds.push(sent.id);
                        } catch (_) { /* DMs können gesperrt sein */ }
                    }
                    if (dmIds.length > 0) {
                        sentMessageIds[guildId] = sentMessageIds[guildId] || {};
                        sentMessageIds[guildId].dms = dmIds;
                    }
                } catch (e) {
                    Logger.error(`[IPC] SEND_NOTIFICATION: DM-Fehler in ${guild.name}:`, e);
                }
            }
        }

        if (Object.keys(sentMessageIds).length > 0) {
            await dbService.query(
                'UPDATE notifications SET sent_to_discord = 1, discord_message_ids = ? WHERE id = ?',
                [JSON.stringify(sentMessageIds), id]
            );
        }

        return {
            success: true,
            sentToGuilds: Object.keys(sentMessageIds).length,
            messageIds: sentMessageIds
        };

    } catch (error) {
        Logger.error('[IPC] SEND_NOTIFICATION Fehler:', error);
        return { success: false, error: error.message };
    }
};
