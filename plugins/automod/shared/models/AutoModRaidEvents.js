const { ServiceManager } = require('dunebot-core');

/**
 * Model für AutoMod Raid-Events
 * Loggt alle Raid-bezogenen Events für Forensics & Statistiken
 * 
 * @author FireBot Team
 */
class AutoModRaidEvents {
    /**
     * Loggt ein Raid-Event
     * 
     * @param {string} guildId - Discord Guild ID
     * @param {string} eventType - Event-Typ (JOIN_SPIKE, YOUNG_ACCOUNT, RAID_DETECTED, LOCKDOWN_ACTIVATED, LOCKDOWN_DEACTIVATED)
     * @param {Object} data - Event-Daten
     * @param {string} [data.userId] - User ID (optional)
     * @param {string} [data.userTag] - Username#Discriminator (optional)
     * @param {Date} [data.accountCreatedAt] - Account-Erstellungsdatum (optional)
     * @param {string} [data.inviteCode] - Verwendeter Invite-Code (optional)
     * @param {string} [data.actionTaken] - Durchgeführte Aktion (optional)
     * @param {Object} [data.metadata] - Zusätzliche Event-Daten (optional)
     * @returns {Promise<number>} Event-ID
     */
    static async logEvent(guildId, eventType, data = {}) {
        const dbService = ServiceManager.get('dbService');
        const Logger = ServiceManager.get('Logger');
        
        try {
            const result = await dbService.query(
                `INSERT INTO automod_raid_events 
                (guild_id, event_type, user_id, user_tag, account_created_at, invite_code, action_taken, metadata) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    guildId,
                    eventType,
                    data.userId || null,
                    data.userTag || null,
                    data.accountCreatedAt || null,
                    data.inviteCode || null,
                    data.actionTaken || null,
                    data.metadata ? JSON.stringify(data.metadata) : null
                ]
            );
            
            Logger.debug(`[AutoMod Raid] Event geloggt: ${eventType} für Guild ${guildId}`);
            return result.insertId;
        } catch (error) {
            Logger.error('[AutoMod Raid] Fehler beim Loggen des Events:', error);
            throw error;
        }
    }

    /**
     * Holt die letzten N Raid-Events für eine Guild
     * 
     * @param {string} guildId - Discord Guild ID
     * @param {number} [limit=50] - Anzahl Events
     * @returns {Promise<Array>} Events
     */
    static async getRecentEvents(guildId, limit = 50) {
        const dbService = ServiceManager.get('dbService');
        
        try {
            const rows = await dbService.query(
                `SELECT * FROM automod_raid_events 
                WHERE guild_id = ? 
                ORDER BY created_at DESC 
                LIMIT ?`,
                [guildId, limit]
            );
            
            // Metadata JSON parsen
            return rows.map(row => {
                if (row.metadata && typeof row.metadata === 'string') {
                    try {
                        row.metadata = JSON.parse(row.metadata);
                    } catch {
                        row.metadata = null;
                    }
                }
                return row;
            });
        } catch (error) {
            const Logger = ServiceManager.get('Logger');
            Logger.error('[AutoMod Raid] Fehler beim Laden der Events:', error);
            throw error;
        }
    }

    /**
     * Zählt Events nach Typ für Statistiken
     * 
     * @param {string} guildId - Discord Guild ID
     * @param {Date} [since] - Seit Datum (optional)
     * @returns {Promise<Object>} Event-Zähler nach Typ
     */
    static async getEventStats(guildId, since = null) {
        const dbService = ServiceManager.get('dbService');
        
        try {
            let query = `
                SELECT event_type, COUNT(*) as count 
                FROM automod_raid_events 
                WHERE guild_id = ?
            `;
            const params = [guildId];
            
            if (since) {
                query += ` AND created_at >= ?`;
                params.push(since);
            }
            
            query += ` GROUP BY event_type`;
            
            const rows = await dbService.query(query, params);
            
            // Array zu Object konvertieren
            const stats = {};
            rows.forEach(row => {
                stats[row.event_type] = row.count;
            });
            
            return stats;
        } catch (error) {
            const Logger = ServiceManager.get('Logger');
            Logger.error('[AutoMod Raid] Fehler beim Laden der Statistiken:', error);
            throw error;
        }
    }

    /**
     * Löscht alte Events (Cleanup)
     * 
     * @param {string} guildId - Discord Guild ID
     * @param {number} [daysToKeep=30] - Tage die behalten werden sollen
     * @returns {Promise<number>} Anzahl gelöschter Events
     */
    static async cleanupOldEvents(guildId, daysToKeep = 30) {
        const dbService = ServiceManager.get('dbService');
        const Logger = ServiceManager.get('Logger');
        
        try {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
            
            const result = await dbService.query(
                `DELETE FROM automod_raid_events 
                WHERE guild_id = ? AND created_at < ?`,
                [guildId, cutoffDate]
            );
            
            Logger.debug(`[AutoMod Raid] ${result.affectedRows} alte Events gelöscht für Guild ${guildId}`);
            return result.affectedRows;
        } catch (error) {
            Logger.error('[AutoMod Raid] Fehler beim Cleanup:', error);
            throw error;
        }
    }
}

module.exports = AutoModRaidEvents;
