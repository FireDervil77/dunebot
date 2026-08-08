const { aufloesen } = require('../../quellen');
const { MusicSettings } = require('../../../shared/models');

/**
 * IPC: Vom Dashboard aus etwas in die Warteschlange legen.
 *
 * Der Bot muss dafuer schon in einem Sprachkanal stehen - vom Dashboard aus
 * laesst sich kein Kanal betreten, weil dort niemand sitzt, dem man folgen
 * koennte.
 */
module.exports = async (payload, client) => {
    const { guildId, eingabe, angefordertVon, anfang } = payload;

    if (!client.musicManager) return { success: false, error: 'Das Musik-System laeuft nicht' };
    if (!guildId || !eingabe) return { success: false, error: 'guildId und eingabe sind erforderlich' };

    const abspieler = client.musicManager.vorhanden(guildId);
    if (!abspieler || !abspieler.verbunden) {
        return { success: false, error: 'Der Bot ist in keinem Sprachkanal. Starte im Discord mit /play.' };
    }

    try {
        const einstellungen = await MusicSettings.getSettings(guildId);
        // `guildId` muss mit: Eine hochgeladene Datei wird ueber `datei:<id>`
        // angefordert, und ohne die Guild liesse sich durch Raten der Nummer
        // die Datei einer fremden Guild abspielen.
        const ergebnis = await aufloesen(eingabe, { angefordertVon: angefordertVon || null, einstellungen, guildId });

        if (ergebnis.titel.length === 0) {
            return { success: false, error: ergebnis.hinweis || 'Nichts gefunden' };
        }

        const { aufgenommen, abgewiesen } = await abspieler.hinzufuegen(ergebnis.titel, { anfang: Boolean(anfang) });
        await abspieler.starten();

        return { success: true, aufgenommen, abgewiesen, quelle: ergebnis.quelle };
    } catch (error) {
        return { success: false, error: error.message };
    }
};
