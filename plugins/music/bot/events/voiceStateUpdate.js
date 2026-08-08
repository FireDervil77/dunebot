const { ServiceManager } = require('dunebot-core');

/**
 * Auf Kommen und Gehen im Sprachkanal achten.
 *
 * Beides ist von Belang: geht der letzte Mensch, laeuft eine Frist an, nach
 * der der Bot den Kanal verlaesst. Kommt in dieser Frist wieder jemand
 * herein, wird sie zurueckgenommen. Nur auf das Gehen zu hoeren reichte
 * nicht - der Bot waere auch dann gegangen, wenn laengst wieder jemand da
 * gewesen waere.
 *
 * Eine leere Warteschlange ist ausdruecklich **kein** Grund zu gehen.
 *
 * @param {import('discord.js').VoiceState} vorher
 * @param {import('discord.js').VoiceState} nachher
 */
module.exports = async (vorher, nachher) => {
    const client = vorher.client;
    if (!client.musicManager) return;

    // Bots zaehlen nicht - sonst loeste der eigene Beitritt das hier aus
    if (nachher.member?.user?.bot) return;

    const gewechselt = vorher.channelId !== nachher.channelId;
    if (!gewechselt) return;

    const guildId = (nachher.guild || vorher.guild).id;

    try {
        if (vorher.channel) {
            await client.musicManager.pruefeVerwaisung(guildId, vorher.channel, false);
        }
        if (nachher.channel) {
            await client.musicManager.pruefeVerwaisung(guildId, nachher.channel, true);
        }
    } catch (err) {
        ServiceManager.get('Logger').warn(`[Musik] Verwaisungspruefung fehlgeschlagen: ${err.message}`);
    }
};
