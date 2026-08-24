'use strict';

/**
 * IPC: Ankuendigung senden.
 *
 * Der Bot entscheidet hier **nichts**. Er bekommt eine fertige Nutzlast und
 * setzt sie ab - alles Ueberlegen ist im Dashboard passiert, wo der Zustand
 * liegt. Das haelt den Bot austauschbar und den Weg kurz.
 *
 * @param {Object} payload { guildId, channelId, content, embeds, components, veroeffentlichen }
 * @param {Object} client Discord-Client
 * @returns {Promise<Object>} { success, messageId } oder { success: false, error, code }
 */
module.exports = async (payload, client) => {
    const { guildId, channelId, content, embeds, components, veroeffentlichen } = payload;

    try {
        const guild = client.guilds.cache.get(guildId);
        if (!guild) return { success: false, error: 'Guild nicht gefunden', code: 10004 };

        const kanal = await guild.channels.fetch(channelId).catch(() => null);
        if (!kanal) return { success: false, error: 'Kanal nicht gefunden', code: 10003 };

        const nachricht = await kanal.send({ content, embeds, components });

        // Veroeffentlichen ist ein Zusatz, kein Teil des Erfolgs: Gepostet ist
        // gepostet. Discord begrenzt das Veroeffentlichen je Kanal und Stunde -
        // ein Fehlschlag darf die Ankuendigung nicht ungueltig machen.
        if (veroeffentlichen && kanal.type === 5) {
            try {
                await nachricht.crosspost();
            } catch (err) {
                client.logger?.warn(`[Streaming] Veroeffentlichen fehlgeschlagen: ${err.message}`);
            }
        }

        return { success: true, messageId: nachricht.id };
    } catch (error) {
        return { success: false, error: error.message, code: error.code ?? null };
    }
};
