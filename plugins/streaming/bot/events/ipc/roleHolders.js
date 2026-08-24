'use strict';

/**
 * IPC: Wer traegt diese Rolle gerade?
 *
 * Grundlage des Rollenabgleichs. Ohne diese Frage kann das Dashboard nicht
 * wissen, wem es eine Rolle zu Unrecht gelassen hat — und genau das passiert
 * bei jedem Neustart, der zwischen „live gegangen" und „Stream beendet" faellt.
 *
 * `guild.members.fetch()` ist noetig: Der Zwischenspeicher kennt nur, wer
 * gerade aktiv war. Abgemeldete Mitglieder fehlen dort — und behielten die
 * Rolle damit ausgerechnet dann, wenn sie am wenigsten hingucken.
 *
 * @param {Object} payload { guildId, roleId }
 * @param {Object} client Discord-Client
 * @returns {Promise<Object>} { success, traeger: string[] }
 */
module.exports = async (payload, client) => {
    const { guildId, roleId } = payload;

    try {
        const guild = client.guilds.cache.get(guildId);
        if (!guild) return { success: false, error: 'Guild nicht gefunden', code: 10004 };

        const rolle = guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId).catch(() => null);
        if (!rolle) return { success: true, traeger: [], hinweis: 'Rolle gibt es nicht mehr' };

        await guild.members.fetch().catch(() => {});

        const traeger = rolle.members.map(m => m.id);
        return { success: true, traeger };
    } catch (error) {
        return { success: false, error: error.message, code: error.code ?? null };
    }
};
