const { ServiceManager } = require('dunebot-core');

class TicketSettings {
    static async getSettings(guildId) {
        const dbService = ServiceManager.get('dbService');
        try {
            const rows = await dbService.query(
                'SELECT * FROM ticket_settings WHERE guild_id = ?',
                [guildId]
            );
            if (rows.length === 0) {
                return await this.createDefaults(guildId);
            }
            return rows[0];
        } catch (error) {
            const Logger = ServiceManager.get('Logger');
            Logger.error('[Ticket] Fehler beim Laden der Settings:', error);
            throw error;
        }
    }

    static async createDefaults(guildId) {
        const dbService = ServiceManager.get('dbService');
        try {
            await dbService.query(
                'INSERT INTO ticket_settings (guild_id) VALUES (?)',
                [guildId]
            );
            return await this.getSettings(guildId);
        } catch (error) {
            const Logger = ServiceManager.get('Logger');
            Logger.error('[Ticket] Fehler beim Erstellen der Default-Settings:', error);
            throw error;
        }
    }

    static async updateSettings(guildId, updates) {
        const dbService = ServiceManager.get('dbService');
        try {
            const fields = Object.keys(updates).map(key => `${key} = ?`).join(', ');
            const values = [...Object.values(updates), guildId];
            await dbService.query(
                `UPDATE ticket_settings SET ${fields} WHERE guild_id = ?`,
                values
            );
        } catch (error) {
            const Logger = ServiceManager.get('Logger');
            Logger.error('[Ticket] Fehler beim Speichern der Settings:', error);
            throw error;
        }
    }
}

module.exports = TicketSettings;
