'use strict';

/**
 * Kern-IPC-Handler: MITGLIED_PROFIL (G-12, K382)
 *
 * Ein Mitglied in der Form, die Profilabschnitte bekommen (`Profil.mitgliedAus`,
 * dieselbe Rechnung wie `/profile`). Ist es nicht (mehr) auf dem Server,
 * kommt `mitglied: null` mit `success: true`: Die Seite zeigt dann, was die
 * Guild noch über es hat (Moderationsfälle bleiben bis zum Ende ihrer Frist).
 *
 * @param {{ guildId: string, userId: string }} payload
 * @param {import('discord.js').Client} client
 */
const { Profil } = require('dunebot-sdk');

/** Discord: Unknown Member, Unknown User. */
const NICHT_DA = new Set([10007, 10013]);

module.exports = async (payload, client) => {
    const guildId = String(payload?.guildId ?? '');
    const userId = String(payload?.userId ?? '');
    if (!/^\d{17,20}$/.test(guildId) || !/^\d{17,20}$/.test(userId)) return { success: false, error: 'guildId oder userId fehlt' };
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return { success: false, error: 'Guild nicht gefunden' };

    let member = guild.members.cache.get(userId) || null;
    if (!member) {
        try {
            member = await guild.members.fetch({ user: userId, cache: true });
        } catch (err) {
            if (!NICHT_DA.has(err?.code)) return { success: false, error: err.message };
            member = null;
        }
    }
    return { success: true, mitglied: Profil.mitgliedAus(member) };
};
