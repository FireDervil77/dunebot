const { ServiceManager } = require('dunebot-core');

/**
 * Model für AutoMod Escalation Config
 * Verwaltet mehrstufige Bestrafungs-Eskalation basierend auf Strike-Anzahl
 * 
 * @author FireBot Team
 */
class AutoModEscalation {
    /**
     * Lädt alle Eskalationsstufen für eine Guild
     * Sortiert nach Threshold aufsteigend
     * 
     * @param {string} guildId - Discord Guild ID
     * @returns {Promise<Array>} Array von {id, guild_id, threshold, action, duration, created_at}
     */
    static async getConfig(guildId) {
        const dbService = ServiceManager.get('dbService');

        try {
            const rows = await dbService.query(
                `SELECT * FROM automod_escalation_config 
                 WHERE guild_id = ? 
                 ORDER BY threshold ASC`,
                [guildId]
            );
            return rows;
        } catch (error) {
            const Logger = ServiceManager.get('Logger');
            Logger.error('[AutoMod] Fehler beim Laden der Eskalations-Config:', error);
            throw error;
        }
    }

    /**
     * Ermittelt die passende Aktion für eine bestimmte Strike-Anzahl
     * Wählt die höchste Stufe deren Threshold <= strikes ist
     * 
     * @param {string} guildId - Discord Guild ID
     * @param {number} strikes - Aktuelle Strike-Anzahl
     * @returns {Promise<Object|null>} Passende Eskalationsstufe oder null
     */
    static async getActionForStrikes(guildId, strikes) {
        const dbService = ServiceManager.get('dbService');

        try {
            const rows = await dbService.query(
                `SELECT * FROM automod_escalation_config 
                 WHERE guild_id = ? AND threshold <= ? 
                 ORDER BY threshold DESC 
                 LIMIT 1`,
                [guildId, strikes]
            );
            return rows[0] || null;
        } catch (error) {
            const Logger = ServiceManager.get('Logger');
            Logger.error('[AutoMod] Fehler beim Ermitteln der Eskalationsaktion:', error);
            throw error;
        }
    }

    /**
     * Fügt eine neue Eskalationsstufe hinzu
     * 
     * @param {string} guildId - Discord Guild ID
     * @param {number} threshold - Strike-Schwellenwert
     * @param {string} action - Aktion (TIMEOUT, KICK, BAN)
     * @param {number|null} duration - Dauer in Minuten (nur für TIMEOUT)
     * @returns {Promise<number>} Insert-ID
     */
    static async addLevel(guildId, threshold, action, duration = null) {
        const dbService = ServiceManager.get('dbService');

        try {
            const result = await dbService.query(
                `INSERT INTO automod_escalation_config (guild_id, threshold, action, duration) 
                 VALUES (?, ?, ?, ?)`,
                [guildId, threshold, action, duration]
            );
            return result.insertId;
        } catch (error) {
            const Logger = ServiceManager.get('Logger');
            Logger.error('[AutoMod] Fehler beim Hinzufügen der Eskalationsstufe:', error);
            throw error;
        }
    }

    /**
     * Aktualisiert eine Eskalationsstufe
     * 
     * @param {number} id - Eskalations-ID
     * @param {string} guildId - Discord Guild ID (Sicherheitscheck)
     * @param {Object} updates - {threshold, action, duration}
     * @returns {Promise<boolean>} Ob Update erfolgreich war
     */
    static async updateLevel(id, guildId, updates) {
        const dbService = ServiceManager.get('dbService');

        try {
            const fields = Object.keys(updates).map(key => `${key} = ?`).join(', ');
            const values = [...Object.values(updates), id, guildId];

            const result = await dbService.query(
                `UPDATE automod_escalation_config SET ${fields} WHERE id = ? AND guild_id = ?`,
                values
            );
            return result.affectedRows > 0;
        } catch (error) {
            const Logger = ServiceManager.get('Logger');
            Logger.error('[AutoMod] Fehler beim Aktualisieren der Eskalationsstufe:', error);
            throw error;
        }
    }

    /**
     * Löscht eine Eskalationsstufe
     * 
     * @param {number} id - Eskalations-ID
     * @param {string} guildId - Discord Guild ID (Sicherheitscheck)
     * @returns {Promise<boolean>} Ob Löschung erfolgreich war
     */
    static async deleteLevel(id, guildId) {
        const dbService = ServiceManager.get('dbService');

        try {
            const result = await dbService.query(
                `DELETE FROM automod_escalation_config WHERE id = ? AND guild_id = ?`,
                [id, guildId]
            );
            return result.affectedRows > 0;
        } catch (error) {
            const Logger = ServiceManager.get('Logger');
            Logger.error('[AutoMod] Fehler beim Löschen der Eskalationsstufe:', error);
            throw error;
        }
    }

    /**
     * Erstellt Default-Eskalation für eine Guild
     * 3 Strikes = TIMEOUT 10min, 5 Strikes = KICK, 8 Strikes = BAN
     * 
     * @param {string} guildId - Discord Guild ID
     * @returns {Promise<void>}
     */
    static async createDefaults(guildId) {
        const dbService = ServiceManager.get('dbService');

        try {
            await dbService.query(
                `INSERT IGNORE INTO automod_escalation_config (guild_id, threshold, action, duration) VALUES 
                 (?, 3, 'TIMEOUT', 10),
                 (?, 5, 'KICK', NULL),
                 (?, 8, 'BAN', NULL)`,
                [guildId, guildId, guildId]
            );
        } catch (error) {
            const Logger = ServiceManager.get('Logger');
            Logger.error('[AutoMod] Fehler beim Erstellen der Default-Eskalation:', error);
            throw error;
        }
    }
}

module.exports = AutoModEscalation;
