const { aufloesen } = require('../../quellen');
const { MusicSettings } = require('../../../shared/models');

/**
 * IPC: Eine Eingabe aufloesen, ohne sie abzuspielen.
 *
 * Das Dashboard braucht das, um Titel in eine Wiedergabeliste zu legen. Es
 * loeste bis zum 2026-08-07 selbst auf - damit haetten die Spotify-
 * Zugangsdaten in **zwei** .env-Dateien stehen muessen. Jetzt fragt es hier
 * nach, und die Zugangsdaten liegen nur im Bot.
 */
module.exports = async (payload, client) => {
    const { guildId, eingabe, angefordertVon } = payload;

    if (!guildId || !eingabe) return { success: false, error: 'guildId und eingabe sind erforderlich' };

    try {
        const einstellungen = await MusicSettings.getSettings(guildId);
        const ergebnis = await aufloesen(eingabe, { angefordertVon: angefordertVon || null, einstellungen });

        if (ergebnis.titel.length === 0) {
            return { success: false, error: ergebnis.hinweis || 'NICHTS_GEFUNDEN' };
        }
        return { success: true, titel: ergebnis.titel, quelle: ergebnis.quelle };
    } catch (error) {
        return { success: false, error: error.message };
    }
};
