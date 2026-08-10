'use strict';

const { Logger } = require('dunebot-sdk/utils');

/**
 * IPC-Ereignis: `discord:holeEmojis`
 *
 * Liefert die eigenen Emojis einer Guild für die Auswahl im Dashboard.
 *
 * ## Warum das überhaupt nötig ist
 *
 * Das Emoji-Feld eines Rollenmenüs war ein blankes Textfeld. Wer draufklickt,
 * erwartet eine Auswahl — bekam aber nichts, und musste ein Zeichen von
 * anderswo hineinkopieren. Für **Server-Emojis** ist das nicht nur unbequem,
 * sondern kaum machbar: Discord will dort die Form `<:name:id>`, und die ID
 * kennt niemand auswendig. Genau die liefert dieser Handler.
 *
 * Standard-Emojis braucht es dafür nicht — die stehen im Dashboard, weil sie
 * für jede Guild gleich sind. Über die Leitung geht nur, was guild-eigen ist.
 *
 * @param {{guildId: string}} payload
 * @param {import('discord.js').Client} discordClient
 * @returns {Promise<{success: boolean, emojis?: Array, message?: string}>}
 */
module.exports = async (payload, discordClient) => {
    const { guildId } = payload || {};

    if (!guildId) {
        return { success: false, message: 'guildId fehlt' };
    }

    try {
        const guild = await discordClient.guilds.fetch(String(guildId));
        if (!guild) {
            return { success: false, message: 'Der Bot ist nicht auf diesem Server' };
        }

        // Frisch holen statt aus dem Zwischenspeicher: wer gerade ein Emoji
        // hochgeladen hat, will es sofort auswählen können.
        const sammlung = await guild.emojis.fetch();

        const emojis = [...sammlung.values()]
            .filter(e => e.available !== false)
            .map(e => ({
                id:       e.id,
                name:     e.name,
                animated: !!e.animated,
                // Die Form, die Discord in Nachrichten und Reaktionen erwartet.
                // Das Dashboard trägt genau diese Zeichenkette ins Feld ein.
                kennung:  e.animated ? `<a:${e.name}:${e.id}>` : `<:${e.name}:${e.id}>`,
                url:      e.imageURL({ size: 64 }),
            }))
            .sort((a, b) => a.name.localeCompare(b.name, 'de'));

        return { success: true, emojis };

    } catch (error) {
        Logger.error('[discord] Emojis konnten nicht geladen werden:', error);
        return { success: false, message: 'Die Emojis dieses Servers sind gerade nicht abrufbar' };
    }
};
