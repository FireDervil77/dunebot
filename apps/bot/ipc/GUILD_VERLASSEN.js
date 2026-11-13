'use strict';

/**
 * Kern-IPC-Handler: GUILD_VERLASSEN (G-04c, K380)
 *
 * Das Dashboard ruft ihn nach „Guild löschen“ (Einstellungen → Allgemein,
 * nur der Besitzer). Die Daten sind dann schon über `Datenauskunft.guildLoeschen`
 * gelöscht: Plugins abgeschaltet (Gameserver gestoppt), Zeilen über die
 * Erklärungen. Erst danach verlässt der Bot die Guild.
 *
 * Die Reihenfolge ist Absicht. Ginge der Bot zuerst, liefe `guildDelete` →
 * `GuildManager._cleanupAllGuildData` über `SHOW TABLES` und nähme die
 * Gameserver-Zeilen mit, ohne die Container zu stoppen (K381). So findet
 * dieser Weg nur noch Reste, die zwischen Löschen und Verlassen neu angelegt
 * wurden.
 *
 * Die Kontroll-Guild verlässt der Bot nie, egal wer fragt.
 *
 * @param {{ guildId: string }} payload
 * @param {import('discord.js').Client} client
 * @returns {Promise<{success: boolean, error?: string}>}
 */
module.exports = async (payload, client) => {
    const guildId = String(payload?.guildId ?? '');
    if (!/^\d{17,20}$/.test(guildId)) return { success: false, error: 'guildId fehlt' };
    if (guildId === String(process.env.CONTROL_GUILD_ID)) {
        return { success: false, error: 'Die Kontroll-Guild verlässt der Bot nicht.' };
    }
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return { success: false, error: 'Der Bot ist in dieser Guild nicht.' };
    try {
        await guild.leave();
        return { success: true };
    } catch (fehler) {
        return { success: false, error: fehler.message };
    }
};
