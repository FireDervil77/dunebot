'use strict';

/**
 * Kern-IPC-Handler: BEFEHLE_NEU_ANMELDEN (K365, 2026-11-11)
 *
 * Das Dashboard ruft ihn, nachdem unter Einstellungen → Allgemein gespeichert
 * wurde. Der Schalter „Slash-Befehle“ wirkt bei Discord nur über die
 * Registrierung: Bis dahin meldete der Bot die Befehle einer Guild nur beim
 * Start und beim Beitritt an — ein umgelegter Schalter galt erst nach dem
 * nächsten Bot-Neustart.
 *
 * `force` umgeht nur die 10-Sekunden-Bremse der Warteschlange. Gesendet wird
 * weiter nur, wenn sich der Satz geändert hat (Prüfsumme in
 * `guild_command_state`); wer speichert, ohne den Schalter anzufassen, löst
 * also keine Anfrage bei Discord aus.
 *
 * @param {{ guildId: string }} payload
 * @param {import('discord.js').Client} client
 * @returns {Promise<{success: boolean, error?: string}>}
 */
module.exports = async (payload, client) => {
    const guildId = payload?.guildId;
    if (!guildId || !client.guilds.cache.has(guildId)) {
        return { success: false, error: 'Der Bot ist in dieser Guild nicht.' };
    }
    try {
        await client.commandManager.registerInteractions(guildId, true);
        return { success: true };
    } catch (fehler) {
        return { success: false, error: fehler.message };
    }
};
