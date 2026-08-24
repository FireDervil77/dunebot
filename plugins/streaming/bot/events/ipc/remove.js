'use strict';

/**
 * IPC: Ankuendigung loeschen.
 *
 * Nur fuer Ziele, die als Aufraeumart ausdruecklich "loeschen" gewaehlt haben.
 * Ist die Nachricht schon weg, ist das der Zielzustand und kein Fehler.
 *
 * @param {Object} payload { guildId, channelId, messageId }
 * @param {Object} client Discord-Client
 * @returns {Promise<Object>} { success } oder { success: false, error, code }
 */
module.exports = async (payload, client) => {
    const { guildId, channelId, messageId } = payload;

    try {
        const guild = client.guilds.cache.get(guildId);
        if (!guild) return { success: false, error: 'Guild nicht gefunden', code: 10004 };

        const kanal = await guild.channels.fetch(channelId).catch(() => null);
        if (!kanal) return { success: false, error: 'Kanal nicht gefunden', code: 10003 };

        const nachricht = await kanal.messages.fetch(messageId).catch(() => null);
        if (!nachricht) return { success: true };

        await nachricht.delete();
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message, code: error.code ?? null };
    }
};
