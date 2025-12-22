const { ServiceManager } = require('dunebot-core');

/**
 * Model für AutoMod Strikes
 * Verwaltet Member-spezifische Strike-Counter
 * Strikes werden bei Bestrafung zurückgesetzt
 * 
 * @author FireBot Team
 */
class AutoModStrikes {
    /**
     * Lädt aktuelle Strikes für einen Member
     * 
     * @param {string} guildId - Discord Guild ID
     * @param {string} memberId - Discord Member ID
     * @returns {Promise<number>} Aktuelle Strike-Anzahl (0 wenn keine vorhanden)
     */
    static async getStrikes(guildId, memberId) {
        const dbService = ServiceManager.get('dbService');
        
        try {
            const rows = await dbService.query(
                'SELECT strikes FROM automod_strikes WHERE guild_id = ? AND member_id = ?',
                [guildId, memberId]
            );
            
            return rows[0]?.strikes || 0;
        } catch (error) {
            const Logger = ServiceManager.get('Logger');
            Logger.error('[AutoMod] Fehler beim Laden der Strikes:', error);
            throw error;
        }
    }

    /**
     * Setzt/Aktualisiert Strikes für einen Member
     * Nutzt INSERT ... ON DUPLICATE KEY UPDATE (MySQL Upsert)
     * 
     * @param {string} guildId - Discord Guild ID
     * @param {string} memberId - Discord Member ID
     * @param {number} newStrikes - Neue Strike-Anzahl
     * @returns {Promise<void>}
     */
    static async updateStrikes(guildId, memberId, newStrikes) {
        const dbService = ServiceManager.get('dbService');
        const Logger = ServiceManager.get('Logger');
        
        try {
            await dbService.query(
                `INSERT INTO automod_strikes (guild_id, member_id, strikes) 
                 VALUES (?, ?, ?) 
                 ON DUPLICATE KEY UPDATE strikes = VALUES(strikes), updated_at = CURRENT_TIMESTAMP`,
                [guildId, memberId, newStrikes]
            );
            
            Logger.debug(`[AutoMod] Strikes für ${memberId} in Guild ${guildId} aktualisiert: ${newStrikes}`);
        } catch (error) {
            Logger.error('[AutoMod] Fehler beim Aktualisieren der Strikes:', error);
            throw error;
        }
    }

    /**
     * Setzt Strikes für einen Member auf 0 zurück
     * Wird nach Bestrafungsaktion aufgerufen
     * 
     * @param {string} guildId - Discord Guild ID
     * @param {string} memberId - Discord Member ID
     * @returns {Promise<void>}
     */
    static async resetStrikes(guildId, memberId) {
        await this.updateStrikes(guildId, memberId, 0);
    }

    /**
     * Inkrementiert Strikes für einen Member
     * 
     * @param {string} guildId - Discord Guild ID
     * @param {string} memberId - Discord Member ID
     * @param {number} amount - Anzahl Strikes die hinzugefügt werden (default: 1)
     * @returns {Promise<number>} Neue Strike-Anzahl
     */
    static async addStrikes(guildId, memberId, amount = 1) {
        const currentStrikes = await this.getStrikes(guildId, memberId);
        const newStrikes = currentStrikes + amount;
        await this.updateStrikes(guildId, memberId, newStrikes);
        return newStrikes;
    }

    /**
     * Lädt alle Member mit Strikes für eine Guild
     * Sortiert nach Strike-Anzahl (höchste zuerst)
     * 
     * @param {string} guildId - Discord Guild ID
     * @param {number} limit - Max Anzahl Ergebnisse (default: 50)
     * @returns {Promise<Array>} Array von {member_id, strikes, updated_at}
     */
    static async getTopStrikes(guildId, limit = 50) {
        const dbService = ServiceManager.get('dbService');
        
        try {
            const rows = await dbService.query(
                `SELECT member_id, strikes, updated_at 
                 FROM automod_strikes 
                 WHERE guild_id = ? AND strikes > 0
                 ORDER BY strikes DESC, updated_at DESC
                 LIMIT ?`,
                [guildId, limit]
            );
            
            return rows;
        } catch (error) {
            const Logger = ServiceManager.get('Logger');
            Logger.error('[AutoMod] Fehler beim Laden der Top-Strikes:', error);
            throw error;
        }
    }

    /**
     * Löscht alle Strikes für eine Guild (z.B. bei Plugin-Deaktivierung)
     * 
     * @param {string} guildId - Discord Guild ID
     * @returns {Promise<void>}
     */
    static async deleteAllStrikes(guildId) {
        const dbService = ServiceManager.get('dbService');
        const Logger = ServiceManager.get('Logger');
        
        try {
            await dbService.query(
                'DELETE FROM automod_strikes WHERE guild_id = ?',
                [guildId]
            );
            
            Logger.debug(`[AutoMod] Alle Strikes für Guild ${guildId} gelöscht`);
        } catch (error) {
            Logger.error('[AutoMod] Fehler beim Löschen der Strikes:', error);
            throw error;
        }
    }
}

module.exports = AutoModStrikes;
