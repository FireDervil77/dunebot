const { baueNachricht, ANLAESSE } = require("../utils");
const { ServiceManager } = require('dunebot-core');

/**
 * Fires when a member updates (detects boost start)
 * @param {import('discord.js').GuildMember} oldMember
 * @param {import('discord.js').GuildMember} newMember
 */
module.exports = async (oldMember, newMember) => {
    const dbService = ServiceManager.get('dbService');
    const logger = ServiceManager.get('Logger');

    // Seit Partials.GuildMember (G-13) kommt fuer ein ungecachtes Mitglied
    // ein LEERES altes Mitglied: `premiumSince` ist dort immer null. Ohne
    // diese Zeile bekaeme jeder boostende Nutzer bei jeder Aenderung (Nick,
    // Rolle) erneut die Boost-Nachricht. Den Vorher-Stand kennen wir nicht —
    // vor G-13 kam hier fuer solche Mitglieder gar kein Aufruf an, es bleibt
    // also beim alten Verhalten.
    if (oldMember.partial) return;

    // Check if member just started boosting
    const wasBoosting = oldMember.premiumSince !== null;
    const isBoosting = newMember.premiumSince !== null;

    if (wasBoosting || !isBoosting) return; // Not a new boost

    try {
        const rows = await dbService.query(
            'SELECT * FROM greeting_settings WHERE guild_id = ?',
            [newMember.guild.id]
        );

        const settings = rows?.[0];
        if (!settings || !settings.boost_enabled) return;

        const channel = newMember.guild.channels.cache.get(settings.boost_channel);
        if (!channel) return;

        const response = await baueNachricht(newMember, ANLAESSE.boost);
        await channel.send(response);

        logger.info(`[Greeting] Sent boost message for ${newMember.user.tag} in ${newMember.guild.name}`);
    } catch (error) {
        logger.error(`[Greeting] Error in boost event for guild ${newMember.guild.id}:`, error);
    }
};
