const { ServiceManager } = require('dunebot-core');

/**
 * Verlauf: was tatsaechlich gelaufen ist.
 *
 * Wird vom Bot beim Start eines Titels geschrieben und im Dashboard
 * angezeigt - jede Tabelle braucht eine Ansicht, sonst ist sie tot.
 */
class MusicHistory {
    /**
     * Einen gespielten Titel festhalten.
     *
     * @param {string} guildId Discord-Guild-ID
     * @param {Object} titel Titeldaten
     */
    static async add(guildId, titel) {
        const dbService = ServiceManager.get('dbService');

        await dbService.query(`
            INSERT INTO music_history
                (guild_id, title, url, source, duration_sec, thumbnail, requested_by, voice_channel)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            guildId,
            String(titel.title || '').substring(0, 512),
            String(titel.url || '').substring(0, 1024),
            titel.source || 'unbekannt',
            titel.durationSec || null,
            titel.thumbnail ? String(titel.thumbnail).substring(0, 1024) : null,
            titel.requestedBy || null,
            titel.voiceChannelId || null
        ]);
    }

    /**
     * Die zuletzt gespielten Titel.
     *
     * @param {string} guildId Discord-Guild-ID
     * @param {number} grenze Hoechstzahl
     * @returns {Promise<Array>} Verlaufseintraege
     */
    static async getRecent(guildId, grenze = 50) {
        const dbService = ServiceManager.get('dbService');
        return await dbService.query(
            'SELECT * FROM music_history WHERE guild_id = ? ORDER BY played_at DESC LIMIT ?',
            [guildId, grenze]
        );
    }

    /**
     * Zahlen fuer die Uebersicht.
     *
     * @param {string} guildId Discord-Guild-ID
     * @param {number} tage Zeitraum
     * @returns {Promise<Object>} { gesamt, spielzeitSek, nachQuelle, top }
     */
    static async getStats(guildId, tage = 30) {
        const dbService = ServiceManager.get('dbService');

        const [summe, nachQuelle, top] = await Promise.all([
            dbService.query(
                `SELECT COUNT(*) AS gesamt, COALESCE(SUM(duration_sec), 0) AS spielzeit
                   FROM music_history
                  WHERE guild_id = ? AND played_at >= DATE_SUB(NOW(), INTERVAL ? DAY)`,
                [guildId, tage]
            ),
            dbService.query(
                `SELECT source, COUNT(*) AS anzahl
                   FROM music_history
                  WHERE guild_id = ? AND played_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
                  GROUP BY source ORDER BY anzahl DESC`,
                [guildId, tage]
            ),
            dbService.query(
                `SELECT title, url, COUNT(*) AS anzahl
                   FROM music_history
                  WHERE guild_id = ? AND played_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
                  GROUP BY title, url ORDER BY anzahl DESC LIMIT 10`,
                [guildId, tage]
            )
        ]);

        return {
            gesamt: summe[0]?.gesamt || 0,
            spielzeitSek: Number(summe[0]?.spielzeit || 0),
            nachQuelle,
            top
        };
    }

    /**
     * Alte Eintraege loeschen.
     *
     * @param {string} guildId Discord-Guild-ID
     * @param {number} tage Was aelter ist, faellt weg
     * @returns {Promise<number>} Geloeschte Zeilen
     */
    static async deleteOlderThan(guildId, tage) {
        const dbService = ServiceManager.get('dbService');
        const ergebnis = await dbService.query(
            'DELETE FROM music_history WHERE guild_id = ? AND played_at < DATE_SUB(NOW(), INTERVAL ? DAY)',
            [guildId, tage]
        );
        return ergebnis?.affectedRows || 0;
    }

    /** Alles einer Guild entfernen - beim Abschalten des Plugins. */
    static async deleteAll(guildId) {
        await ServiceManager.get('dbService').query('DELETE FROM music_history WHERE guild_id = ?', [guildId]);
    }
}

module.exports = MusicHistory;
