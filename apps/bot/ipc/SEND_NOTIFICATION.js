'use strict';

const { ServiceManager } = require('dunebot-core');
const { EmbedBuilder } = require('discord.js');

/**
 * HTML zu Discord-Markdown konvertieren.
 * Wandelt gängige HTML-Tags in Discord-Formatierung um und entfernt den Rest.
 */
function htmlToDiscord(html) {
    if (!html || typeof html !== 'string') return html || '';
    return html
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
        .replace(/<\/?p[^>]*>/gi, '\n')
        .replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**')
        .replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**')
        .replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*')
        .replace(/<i[^>]*>(.*?)<\/i>/gi, '*$1*')
        .replace(/<u[^>]*>(.*?)<\/u>/gi, '__$1__')
        .replace(/<s[^>]*>(.*?)<\/s>/gi, '~~$1~~')
        .replace(/<strike[^>]*>(.*?)<\/strike>/gi, '~~$1~~')
        .replace(/<code[^>]*>(.*?)<\/code>/gi, '`$1`')
        .replace(/<a\s+href="([^"]+)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)')
        .replace(/<li[^>]*>/gi, '• ')
        .replace(/<\/li>/gi, '\n')
        .replace(/<\/?(ul|ol|div|span|h[1-6]|hr|blockquote|pre|table|thead|tbody|tr|td|th|img)[^>]*>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/**
 * Kern-IPC-Handler: SEND_NOTIFICATION
 * Sendet eine mehrsprachige Notification an Discord-Channels oder per DM.
 * Unterstützt discord_category: löst Channel aus admin_settings per Kategorie auf.
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
            category,
            action_url,
            delivery_method,
            target_guild_ids,
            discord_channel_id
        } = payload;

        const parse = (val) => typeof val === 'string' ? JSON.parse(val) : (val || {});
        const titleTranslations = parse(title_translations);
        const messageTranslations = parse(message_translations);
        const actionTextTranslations = parse(action_text_translations);
        let targetGuildIds = typeof target_guild_ids === 'string'
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

        // discord_category: Channel aus admin_settings per Kategorie auflösen
        let categoryChannelId = null;
        if (methods.includes('discord_category') && category) {
            try {
                const [setting] = await dbService.query(
                    "SELECT `value` FROM admin_settings WHERE `key` = ?",
                    [`notification_channel_${category}`]
                );
                if (setting) {
                    const cfg = JSON.parse(setting.value);
                    categoryChannelId = cfg.channel_id || null;
                }
            } catch (e) {
                Logger.warn(`[IPC] SEND_NOTIFICATION: Channel-Config für Kategorie "${category}" konnte nicht geladen werden:`, e.message);
            }
            // Control-Guild als Ziel verwenden
            const controlGuildId = process.env.CONTROL_GUILD_ID;
            if (controlGuildId && !targetGuildIds.includes(controlGuildId)) {
                targetGuildIds = [controlGuildId];
            }
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

            const title = htmlToDiscord(titleTranslations[locale] || titleTranslations['de-DE'] || 'Notification');
            const message = htmlToDiscord(messageTranslations[locale] || messageTranslations['de-DE'] || '');
            const actionText = htmlToDiscord(actionTextTranslations[locale] || actionTextTranslations['de-DE'] || 'Mehr erfahren');

            const embed = new EmbedBuilder()
                .setTitle(title)
                .setDescription(message)
                .setColor(embedColors[type] || embedColors.info)
                .setTimestamp()
                .setFooter({ text: `Notification #${id}` });

            if (action_url) {
                // Relative URLs zu absoluten URLs auflösen (base_url kommt ggf. vom Dashboard)
                const baseUrl = payload.base_url || process.env.DASHBOARD_BASE_URL || '';
                const fullUrl = action_url.startsWith('http') ? action_url : `${baseUrl}${action_url}`;
                embed.addFields({ name: actionText, value: `[🔗 ${actionText}](${fullUrl})`, inline: false });
            }

            // discord_category: In den konfigurierten Kategorie-Channel posten
            if (methods.includes('discord_category') && categoryChannelId) {
                const targetChannel = guild.channels.cache.get(categoryChannelId);
                if (targetChannel?.isTextBased()) {
                    try {
                        const sent = await targetChannel.send({ embeds: [embed] });
                        sentMessageIds[guildId] = sentMessageIds[guildId] || {};
                        sentMessageIds[guildId].categoryChannel = sent.id;
                    } catch (e) {
                        Logger.error(`[IPC] SEND_NOTIFICATION: Category-Channel-Fehler in ${guild.name}:`, e);
                    }
                } else {
                    Logger.warn(`[IPC] SEND_NOTIFICATION: Category-Channel ${categoryChannelId} nicht gefunden oder kein Text-Channel in ${guild.name}`);
                }
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
