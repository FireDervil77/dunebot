/**
 * IPC: Zustand des Abspielers einer Guild.
 *
 * Das Dashboard hat keinen Zugriff auf die Sprachverbindung - die lebt im
 * Bot-Vorgang. Alles, was die Oberflaeche zeigt, kommt hierueber.
 */
module.exports = async (payload, client) => {
    const { guildId } = payload;
    if (!client.musicManager) return { success: false, error: 'Das Musik-System laeuft nicht' };
    if (!guildId) return { success: false, error: 'guildId fehlt' };

    try {
        return { success: true, zustand: client.musicManager.zustand(guildId) };
    } catch (error) {
        return { success: false, error: error.message };
    }
};
