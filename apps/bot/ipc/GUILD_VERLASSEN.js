'use strict';

/**
 * Kern-IPC-Handler: GUILD_VERLASSEN (G-04c, K380)
 *
 * Das Dashboard ruft ihn nach „Guild löschen“ (Einstellungen → Allgemein,
 * nur der Besitzer). Die Daten sind dann schon über `Datenauskunft.guildLoeschen`
 * gelöscht: Plugins abgeschaltet (Gameserver gestoppt), Zeilen über die
 * Erklärungen. Erst danach verlässt der Bot die Guild.
 *
 * Die Reihenfolge ist Absicht: So kann der Besitzer im Dashboard sehen, ob
 * das Löschen geklappt hat, bevor der Bot geht. Ginge der Bot zuerst, liefe
 * `guildDelete` → `left_at` → das Dashboard löscht im Hintergrund über
 * denselben Weg (G-04d), nur ohne Rückmeldung im Fenster. Ist die Guild schon
 * gelöscht, fehlt ihre Zeile, und `removeGuild` hat nichts mehr zu tun.
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
