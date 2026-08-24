'use strict';

/**
 * IPC: Ankuendigung bearbeiten.
 *
 * Wird zweimal gebraucht: waehrend des Streams, wenn Titel oder Kategorie
 * nachkommen, und danach fuer die Rueckschau.
 *
 * @param {Object} payload { guildId, channelId, messageId, content, embeds, components }
 * @param {Object} client Discord-Client
 * @returns {Promise<Object>} { success } oder { success: false, error, code }
 */
module.exports = async (payload, client) => {
    const { guildId, channelId, messageId, content, embeds, components } = payload;

    try {
        const guild = client.guilds.cache.get(guildId);
        if (!guild) return { success: false, error: 'Guild nicht gefunden', code: 10004 };

        const kanal = await guild.channels.fetch(channelId).catch(() => null);
        if (!kanal) return { success: false, error: 'Kanal nicht gefunden', code: 10003 };

        const nachricht = await kanal.messages.fetch(messageId).catch(() => null);
        if (!nachricht) return { success: false, error: 'Nachricht nicht gefunden', code: 10008 };

        await nachricht.edit({ content, embeds, components });
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message, code: error.code ?? null };
    }
};
