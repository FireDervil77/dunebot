const { ServiceManager } = require('dunebot-core');

/**
 * Model für AutoMod Settings
 * Verwaltet Guild-spezifische AutoMod-Konfiguration
 * 
 * @author FireBot Team
 */
class AutoModSettings {
    /**
     * Lädt Settings für eine Guild
     * Erstellt automatisch Default-Settings falls keine vorhanden
     * 
     * @param {string} guildId - Discord Guild ID
     * @returns {Promise<Object>} Settings-Objekt
     */
    static async getSettings(guildId) {
        const dbService = ServiceManager.get('dbService');
        
        try {
            const rows = await dbService.query(
                'SELECT * FROM automod_settings WHERE guild_id = ?',
                [guildId]
            );
            
            if (rows.length === 0) {
                // Keine Settings vorhanden -> Default erstellen
                return await this.createDefaultSettings(guildId);
            }
            
            const settings = rows[0];
            
            // JSON-Felder parsen: whitelisted_channels
            if (settings.whitelisted_channels && typeof settings.whitelisted_channels === 'string') {
                try {
                    settings.whitelisted_channels = JSON.parse(settings.whitelisted_channels);
                } catch {
                    settings.whitelisted_channels = [];
                }
            }
            
            // Sicherstellen dass es ein Array ist
            if (!Array.isArray(settings.whitelisted_channels)) {
                settings.whitelisted_channels = [];
            }
            
            // JSON-Felder parsen: raid_trusted_invites
            if (settings.raid_trusted_invites && typeof settings.raid_trusted_invites === 'string') {
                try {
                    settings.raid_trusted_invites = JSON.parse(settings.raid_trusted_invites);
                } catch {
                    settings.raid_trusted_invites = [];
                }
            }
            
            // Sicherstellen dass es ein Array ist
            if (!Array.isArray(settings.raid_trusted_invites)) {
                settings.raid_trusted_invites = [];
            }

            // JSON-Felder parsen: active_keyword_lists
            if (settings.active_keyword_lists && typeof settings.active_keyword_lists === 'string') {
                try {
                    settings.active_keyword_lists = JSON.parse(settings.active_keyword_lists);
                } catch {
                    settings.active_keyword_lists = [];
                }
            }

            if (!Array.isArray(settings.active_keyword_lists)) {
                settings.active_keyword_lists = [];
            }
            
            return settings;
        } catch (error) {
            const Logger = ServiceManager.get('Logger');
            Logger.error('[AutoMod] Fehler beim Laden der Settings:', error);
            throw error;
        }
    }

    /**
     * Erstellt Default-Settings für eine Guild
     * 
     * @param {string} guildId - Discord Guild ID
     * @returns {Promise<Object>} Erstellte Settings
     */
    static async createDefaultSettings(guildId) {
        const dbService = ServiceManager.get('dbService');
        const Logger = ServiceManager.get('Logger');
        
        try {
            await dbService.query(
                `INSERT INTO automod_settings (guild_id) VALUES (?)`,
                [guildId]
            );
            
            Logger.debug(`[AutoMod] Default-Settings für Guild ${guildId} erstellt`);
            return await this.getSettings(guildId);
        } catch (error) {
            Logger.error('[AutoMod] Fehler beim Erstellen der Default-Settings:', error);
            throw error;
        }
    }

    /**
     * Aktualisiert Settings für eine Guild
     * Nutzt Object mit Key-Value-Pairs
     * 
     * @param {string} guildId - Discord Guild ID
     * @param {Object} updates - Object mit Settings-Updates (z.B. {max_strikes: 5, action: 'KICK'})
     * @returns {Promise<void>}
     */
    static async updateSettings(guildId, updates) {
        const dbService = ServiceManager.get('dbService');
        const Logger = ServiceManager.get('Logger');
        
        try {
            // JSON-Felder stringifizieren
            if (updates.whitelisted_channels !== undefined) {
                updates.whitelisted_channels = JSON.stringify(updates.whitelisted_channels);
            }
            if (updates.raid_trusted_invites !== undefined) {
                updates.raid_trusted_invites = JSON.stringify(updates.raid_trusted_invites);
            }
            if (updates.active_keyword_lists !== undefined && Array.isArray(updates.active_keyword_lists)) {
                updates.active_keyword_lists = JSON.stringify(updates.active_keyword_lists);
            }

            // Dynamisches UPDATE-Statement bauen
            const fields = Object.keys(updates).map(key => `${key} = ?`).join(', ');
            const values = [...Object.values(updates), guildId];

            await dbService.query(
                `UPDATE automod_settings SET ${fields} WHERE guild_id = ?`,
                values
            );
            
            Logger.debug(`[AutoMod] Settings für Guild ${guildId} aktualisiert:`, Object.keys(updates).join(', '));
        } catch (error) {
            Logger.error('[AutoMod] Fehler beim Aktualisieren der Settings:', error);
            throw error;
        }
    }

    /**
     * Löscht Settings für eine Guild (z.B. bei Plugin-Deaktivierung)
     * 
     * @param {string} guildId - Discord Guild ID
     * @returns {Promise<void>}
     */
    static async deleteSettings(guildId) {
        const dbService = ServiceManager.get('dbService');
        const Logger = ServiceManager.get('Logger');
        
        try {
            await dbService.query(
                'DELETE FROM automod_settings WHERE guild_id = ?',
                [guildId]
            );
            
            Logger.debug(`[AutoMod] Settings für Guild ${guildId} gelöscht`);
        } catch (error) {
            Logger.error('[AutoMod] Fehler beim Löschen der Settings:', error);
            throw error;
        }
    }
}

module.exports = AutoModSettings;
