const { ServiceManager } = require('dunebot-core');

/**
 * Model für AutoMod Logs
 * Speichert vollständige Violation-History für Audit-Trail
 * Behält ALLE Violations, auch wenn unter Strike-Threshold
 * 
 * @author DuneBot Team
 */
class AutoModLogs {
    /**
     * Fügt einen Log-Eintrag hinzu
     * 
     * @param {string} guildId - Discord Guild ID
     * @param {string} memberId - Discord Member ID
     * @param {string} content - Nachrichteninhalt
     * @param {string|Array} reasons - Violations (String: "SPAM,LINKS" oder Array: ['SPAM', 'LINKS'])
     * @param {number} strikes - Anzahl Strikes für diese Violation
     * @returns {Promise<void>}
     */
    static async addLog(guildId, memberId, content, reasons, strikes) {
        const dbService = ServiceManager.get('dbService');
        const Logger = ServiceManager.get('Logger');
        
        try {
            // Reasons zu String konvertieren falls Array
            const reasonsStr = Array.isArray(reasons) ? reasons.join(',') : reasons;
            
            await dbService.query(
                `INSERT INTO automod_logs 
                 (guild_id, member_id, message_content, violation_reasons, strikes_given) 
                 VALUES (?, ?, ?, ?, ?)`,
                [guildId, memberId, content, reasonsStr, strikes]
            );
            
            Logger.debug(`[AutoMod] Log für ${memberId} in Guild ${guildId} gespeichert: ${reasonsStr}`);
        } catch (error) {
            Logger.error('[AutoMod] Fehler beim Speichern des Logs:', error);
            throw error;
        }
    }

    /**
     * Lädt neueste Logs für eine Guild
     * 
     * @param {string} guildId - Discord Guild ID
     * @param {number} limit - Max Anzahl Logs (default: 50)
     * @returns {Promise<Array>} Array von Log-Objekten
     */
    static async getRecentLogs(guildId, limit = 50) {
        const dbService = ServiceManager.get('dbService');
        
        try {
            const rows = await dbService.query(
                `SELECT * FROM automod_logs 
                 WHERE guild_id = ? 
                 ORDER BY logged_at DESC 
                 LIMIT ?`,
                [guildId, limit]
            );
            
            return rows;
        } catch (error) {
            const Logger = ServiceManager.get('Logger');
            Logger.error('[AutoMod] Fehler beim Laden der Logs:', error);
            throw error;
        }
    }

    /**
     * Lädt Logs für einen bestimmten Member
     * 
     * @param {string} guildId - Discord Guild ID
     * @param {string} memberId - Discord Member ID
     * @param {number} limit - Max Anzahl Logs (default: 50)
     * @returns {Promise<Array>} Array von Log-Objekten
     */
    static async getMemberLogs(guildId, memberId, limit = 50) {
        const dbService = ServiceManager.get('dbService');
        
        try {
            const rows = await dbService.query(
                `SELECT * FROM automod_logs 
                 WHERE guild_id = ? AND member_id = ? 
                 ORDER BY logged_at DESC 
                 LIMIT ?`,
                [guildId, memberId, limit]
            );
            
            return rows;
        } catch (error) {
            const Logger = ServiceManager.get('Logger');
            Logger.error('[AutoMod] Fehler beim Laden der Member-Logs:', error);
            throw error;
        }
    }

    /**
     * Zählt Logs für einen Member in einem Zeitraum
     * Nützlich für "Violations in letzten 24h"-Checks
     * 
     * @param {string} guildId - Discord Guild ID
     * @param {string} memberId - Discord Member ID
     * @param {number} hours - Zeitraum in Stunden (default: 24)
     * @returns {Promise<number>} Anzahl Logs im Zeitraum
     */
    static async countRecentLogs(guildId, memberId, hours = 24) {
        const dbService = ServiceManager.get('dbService');
        
        try {
            const rows = await dbService.query(
                `SELECT COUNT(*) as count FROM automod_logs 
                 WHERE guild_id = ? AND member_id = ? 
                 AND logged_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)`,
                [guildId, memberId, hours]
            );
            
            return rows[0]?.count || 0;
        } catch (error) {
            const Logger = ServiceManager.get('Logger');
            Logger.error('[AutoMod] Fehler beim Zählen der Logs:', error);
            throw error;
        }
    }

    /**
     * Lädt Statistiken für eine Guild
     * 
     * @param {string} guildId - Discord Guild ID
     * @param {number} days - Zeitraum in Tagen (default: 7)
     * @returns {Promise<Object>} Statistik-Objekt
     */
    static async getStats(guildId, days = 7) {
        const dbService = ServiceManager.get('dbService');
        
        try {
            // Gesamt-Violations
            const totalRows = await dbService.query(
                `SELECT COUNT(*) as total, SUM(strikes_given) as total_strikes
                 FROM automod_logs 
                 WHERE guild_id = ? 
                 AND logged_at >= DATE_SUB(NOW(), INTERVAL ? DAY)`,
                [guildId, days]
            );
            
            // Violations nach Typ
            const typeRows = await dbService.query(
                `SELECT violation_reasons, COUNT(*) as count
                 FROM automod_logs 
                 WHERE guild_id = ? 
                 AND logged_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
                 GROUP BY violation_reasons
                 ORDER BY count DESC
                 LIMIT 10`,
                [guildId, days]
            );
            
            // Top-Violators
            const memberRows = await dbService.query(
                `SELECT member_id, COUNT(*) as violations, SUM(strikes_given) as strikes
                 FROM automod_logs 
                 WHERE guild_id = ? 
                 AND logged_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
                 GROUP BY member_id
                 ORDER BY violations DESC
                 LIMIT 10`,
                [guildId, days]
            );
            
            return {
                total: totalRows[0]?.total || 0,
                total_strikes: totalRows[0]?.total_strikes || 0,
                by_type: typeRows,
                top_violators: memberRows
            };
        } catch (error) {
            const Logger = ServiceManager.get('Logger');
            Logger.error('[AutoMod] Fehler beim Laden der Stats:', error);
            throw error;
        }
    }

    /**
     * Löscht alte Logs (z.B. für Daten-Retention)
     * 
     * @param {string} guildId - Discord Guild ID
     * @param {number} days - Logs älter als X Tage löschen
     * @returns {Promise<number>} Anzahl gelöschter Logs
     */
    static async deleteOldLogs(guildId, days) {
        const dbService = ServiceManager.get('dbService');
        const Logger = ServiceManager.get('Logger');
        
        try {
            const result = await dbService.query(
                `DELETE FROM automod_logs 
                 WHERE guild_id = ? 
                 AND logged_at < DATE_SUB(NOW(), INTERVAL ? DAY)`,
                [guildId, days]
            );
            
            Logger.debug(`[AutoMod] ${result.affectedRows} alte Logs für Guild ${guildId} gelöscht (älter als ${days} Tage)`);
            return result.affectedRows;
        } catch (error) {
            Logger.error('[AutoMod] Fehler beim Löschen alter Logs:', error);
            throw error;
        }
    }

    /**
     * Löscht alle Logs für eine Guild (z.B. bei Plugin-Deaktivierung)
     * 
     * @param {string} guildId - Discord Guild ID
     * @returns {Promise<void>}
     */
    static async deleteAllLogs(guildId) {
        const dbService = ServiceManager.get('dbService');
        const Logger = ServiceManager.get('Logger');
        
        try {
            await dbService.query(
                'DELETE FROM automod_logs WHERE guild_id = ?',
                [guildId]
            );
            
            Logger.debug(`[AutoMod] Alle Logs für Guild ${guildId} gelöscht`);
        } catch (error) {
            Logger.error('[AutoMod] Fehler beim Löschen der Logs:', error);
            throw error;
        }
    }
}

module.exports = AutoModLogs;
