'use strict';

/**
 * Kern-IPC-Handler: MITGLIEDER_LISTE (G-12, K382)
 *
 * Die Mitglieder einer Guild für die Seite „Mitglieder“ im Dashboard, schmal
 * (keine Rollen, kein Profil): ID, Namen, Avatar, Bot, Beitritt. Geholt über
 * `Mitglieder.holen` (Frist 15 s); eine halbe Liste sagt `vollstaendig: false`
 * mit Grund.
 *
 * Gibt es die Guild auf diesem Shard nicht, antwortet er `success: false`;
 * das Dashboard nimmt die Antwort des Shards, der sie hat.
 *
 * @param {{ guildId: string }} payload
 * @param {import('discord.js').Client} client
 */
const Mitglieder = require('../helpers/Mitglieder');
const { ServiceManager } = require('dunebot-core');

module.exports = async (payload, client) => {
    const guildId = String(payload?.guildId ?? '');
    if (!/^\d{17,20}$/.test(guildId)) return { success: false, error: 'guildId fehlt' };
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return { success: false, error: 'Guild nicht gefunden' };

    const { mitglieder, vollstaendig, grund } = await Mitglieder.holen(guild, ServiceManager.get('Logger'));
    const liste = [...mitglieder.values()].map((m) => ({
        id: m.id,
        name: m.user.username,
        anzeige: m.displayName,
        avatar: m.displayAvatarURL({ extension: 'png', size: 64 }),
        bot: Boolean(m.user.bot),
        beigetreten: m.joinedTimestamp ?? null,
    }));
    liste.sort((a, b) => a.anzeige.localeCompare(b.anzeige, 'de', { sensitivity: 'base' }));
    return { success: true, vollstaendig, grund, anzahl: guild.memberCount ?? liste.length, mitglieder: liste };
};
