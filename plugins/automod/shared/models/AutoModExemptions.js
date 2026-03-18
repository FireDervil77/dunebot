const { ServiceManager } = require('dunebot-core');

/**
 * Model für AutoMod Exemptions
 * Verwaltet Rollen und Channels die vom AutoMod ausgenommen sind
 * 
 * @author FireBot Team
 */
class AutoModExemptions {
    /**
     * Lädt alle Exemptions für eine Guild
     * 
     * @param {string} guildId - Discord Guild ID
     * @returns {Promise<Array>} Array von {id, guild_id, type, target_id, created_at}
     */
    static async getAll(guildId) {
        const dbService = ServiceManager.get('dbService');

        try {
            const rows = await dbService.query(
                'SELECT * FROM automod_exemptions WHERE guild_id = ? ORDER BY type, created_at',
                [guildId]
            );
            return rows;
        } catch (error) {
            const Logger = ServiceManager.get('Logger');
            Logger.error('[AutoMod] Fehler beim Laden der Exemptions:', error);
            throw error;
        }
    }

    /**
     * Lädt Exemptions nach Typ
     * 
     * @param {string} guildId - Discord Guild ID
     * @param {string} type - 'role' oder 'channel'
     * @returns {Promise<Array>} Array von Exemption-Objekten
     */
    static async getByType(guildId, type) {
        const dbService = ServiceManager.get('dbService');

        try {
            const rows = await dbService.query(
                'SELECT * FROM automod_exemptions WHERE guild_id = ? AND type = ?',
                [guildId, type]
            );
            return rows;
        } catch (error) {
            const Logger = ServiceManager.get('Logger');
            Logger.error('[AutoMod] Fehler beim Laden der Exemptions:', error);
            throw error;
        }
    }

    /**
     * Prüft ob ein Channel oder eine Rolle exempt ist
     * 
     * @param {string} guildId - Discord Guild ID
     * @param {string} type - 'role' oder 'channel'
     * @param {string} targetId - Role/Channel ID
     * @returns {Promise<boolean>} true wenn exempt
     */
    static async isExempt(guildId, type, targetId) {
        const dbService = ServiceManager.get('dbService');

        try {
            const rows = await dbService.query(
                'SELECT id FROM automod_exemptions WHERE guild_id = ? AND type = ? AND target_id = ?',
                [guildId, type, targetId]
            );
            return rows.length > 0;
        } catch (error) {
            const Logger = ServiceManager.get('Logger');
            Logger.error('[AutoMod] Fehler beim Prüfen der Exemption:', error);
            return false;
        }
    }

    /**
     * Prüft ob ein Member durch eine seiner Rollen exempt ist
     * 
     * @param {string} guildId - Discord Guild ID
     * @param {Array<string>} roleIds - Array von Role-IDs des Members
     * @returns {Promise<boolean>} true wenn mindestens eine Rolle exempt ist
     */
    static async isMemberExempt(guildId, roleIds) {
        if (!roleIds || roleIds.length === 0) return false;
        const dbService = ServiceManager.get('dbService');

        try {
            const placeholders = roleIds.map(() => '?').join(',');
            const rows = await dbService.query(
                `SELECT id FROM automod_exemptions 
                 WHERE guild_id = ? AND type = 'role' AND target_id IN (${placeholders}) 
                 LIMIT 1`,
                [guildId, ...roleIds]
            );
            return rows.length > 0;
        } catch (error) {
            const Logger = ServiceManager.get('Logger');
            Logger.error('[AutoMod] Fehler beim Prüfen der Member-Exemption:', error);
            return false;
        }
    }

    /**
     * Fügt eine Exemption hinzu
     * 
     * @param {string} guildId - Discord Guild ID
     * @param {string} type - 'role' oder 'channel'
     * @param {string} targetId - Role/Channel ID
     * @returns {Promise<number>} Insert-ID
     */
    static async add(guildId, type, targetId) {
        const dbService = ServiceManager.get('dbService');

        try {
            const result = await dbService.query(
                `INSERT INTO automod_exemptions (guild_id, type, target_id) VALUES (?, ?, ?)
                 ON DUPLICATE KEY UPDATE id = id`,
                [guildId, type, targetId]
            );
            return result.insertId;
        } catch (error) {
            const Logger = ServiceManager.get('Logger');
            Logger.error('[AutoMod] Fehler beim Hinzufügen der Exemption:', error);
            throw error;
        }
    }

    /**
     * Entfernt eine Exemption
     * 
     * @param {number} id - Exemption-ID
     * @param {string} guildId - Discord Guild ID (Sicherheitscheck)
     * @returns {Promise<boolean>} Ob Löschung erfolgreich war
     */
    static async remove(id, guildId) {
        const dbService = ServiceManager.get('dbService');

        try {
            const result = await dbService.query(
                'DELETE FROM automod_exemptions WHERE id = ? AND guild_id = ?',
                [id, guildId]
            );
            return result.affectedRows > 0;
        } catch (error) {
            const Logger = ServiceManager.get('Logger');
            Logger.error('[AutoMod] Fehler beim Entfernen der Exemption:', error);
            throw error;
        }
    }

    /**
     * Entfernt Exemption anhand von Typ und Target-ID
     * 
     * @param {string} guildId - Discord Guild ID
     * @param {string} type - 'role' oder 'channel'
     * @param {string} targetId - Role/Channel ID
     * @returns {Promise<boolean>} Ob Löschung erfolgreich war
     */
    static async removeByTarget(guildId, type, targetId) {
        const dbService = ServiceManager.get('dbService');

        try {
            const result = await dbService.query(
                'DELETE FROM automod_exemptions WHERE guild_id = ? AND type = ? AND target_id = ?',
                [guildId, type, targetId]
            );
            return result.affectedRows > 0;
        } catch (error) {
            const Logger = ServiceManager.get('Logger');
            Logger.error('[AutoMod] Fehler beim Entfernen der Exemption:', error);
            throw error;
        }
    }
}

module.exports = AutoModExemptions;
