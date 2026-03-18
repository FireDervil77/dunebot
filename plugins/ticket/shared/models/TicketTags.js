const { ServiceManager } = require('dunebot-core');

class TicketTags {
    static async getAll(guildId) {
        const dbService = ServiceManager.get('dbService');
        const rows = await dbService.query(
            'SELECT * FROM ticket_tags WHERE guild_id = ? ORDER BY name ASC',
            [guildId]
        );
        return rows;
    }

    static async getByName(guildId, name) {
        const dbService = ServiceManager.get('dbService');
        const rows = await dbService.query(
            'SELECT * FROM ticket_tags WHERE guild_id = ? AND name = ?',
            [guildId, name]
        );
        return rows[0] || null;
    }

    static async create(guildId, name, content, createdBy) {
        const dbService = ServiceManager.get('dbService');
        await dbService.query(
            'INSERT INTO ticket_tags (guild_id, name, content, created_by) VALUES (?, ?, ?, ?)',
            [guildId, name, content, createdBy]
        );
    }

    static async update(guildId, name, content) {
        const dbService = ServiceManager.get('dbService');
        await dbService.query(
            'UPDATE ticket_tags SET content = ? WHERE guild_id = ? AND name = ?',
            [content, guildId, name]
        );
    }

    static async delete(guildId, name) {
        const dbService = ServiceManager.get('dbService');
        await dbService.query(
            'DELETE FROM ticket_tags WHERE guild_id = ? AND name = ?',
            [guildId, name]
        );
    }

    static async deleteById(id, guildId) {
        const dbService = ServiceManager.get('dbService');
        await dbService.query(
            'DELETE FROM ticket_tags WHERE id = ? AND guild_id = ?',
            [id, guildId]
        );
    }
}

module.exports = TicketTags;
