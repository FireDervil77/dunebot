const { ServiceManager } = require('dunebot-core');

/**
 * Wenn der letzte Mensch den Sprachkanal verlaesst, hat der Bot dort nichts
 * mehr verloren - ausser im Dauerbetrieb.
 *
 * @param {import('discord.js').VoiceState} vorher
 * @param {import('discord.js').VoiceState} nachher
 */
module.exports = async (vorher, nachher) => {
    const client = vorher.client;
    if (!client.musicManager) return;

    // Nur Weggehen und Wechseln sind hier von Belang
    const verlassen = vorher.channel && vorher.channelId !== nachher.channelId;
    if (!verlassen) return;

    try {
        await client.musicManager.pruefeVerwaisung(vorher.guild.id, vorher.channel);
    } catch (err) {
        ServiceManager.get('Logger').warn(`[Musik] Verwaisungspruefung fehlgeschlagen: ${err.message}`);
    }
};
