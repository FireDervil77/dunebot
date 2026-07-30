/**
 * IPC-Handler: gameserver:DELETE_STATUS_PANEL
 *
 * Räumt die Discord-Nachricht auf, wenn ein Panel im Dashboard entfernt wird.
 * Eine bereits gelöschte Nachricht ist kein Fehler – das Ziel ist erreicht.
 */

const { ServiceManager } = require('dunebot-core');

const ERR_UNKNOWN_MESSAGE = 10008;
const ERR_UNKNOWN_CHANNEL = 10003;
const ERR_MISSING_ACCESS  = 50001;

module.exports = async (data, discordClient) => {
    const Logger = ServiceManager.get('Logger');
    const { guild_id: guildId, channel_id: channelId, message_id: messageId } = data || {};

    if (!guildId || !channelId || !messageId) {
        return { ok: false, error: 'guild_id, channel_id und message_id erforderlich' };
    }

    try {
        const guild = discordClient.guilds.cache.get(guildId);
        if (!guild) return { ok: true, deleted: false };

        const channel = await guild.channels.fetch(channelId).catch(() => null);
        if (!channel) return { ok: true, deleted: false };

        const message = await channel.messages.fetch(messageId);
        await message.delete();
        return { ok: true, deleted: true };

    } catch (err) {
        if ([ERR_UNKNOWN_MESSAGE, ERR_UNKNOWN_CHANNEL, ERR_MISSING_ACCESS].includes(err?.code)) {
            return { ok: true, deleted: false };
        }
        Logger?.warn?.(`[Gameserver] Panel-Nachricht nicht gelöscht: ${err.message}`);
        return { ok: false, error: err.message };
    }
};
