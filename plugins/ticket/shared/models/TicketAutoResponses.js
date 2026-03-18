const { ServiceManager } = require('dunebot-core');

class TicketAutoResponses {
    static async getActive(guildId) {
        const dbService = ServiceManager.get('dbService');
        const rows = await dbService.query(
            'SELECT * FROM ticket_auto_responses WHERE guild_id = ? AND is_active = 1',
            [guildId]
        );
        return rows.map(r => {
            if (r.keywords && typeof r.keywords === 'string') {
                try { r.keywords = JSON.parse(r.keywords); } catch { r.keywords = []; }
            }
            return r;
        });
    }

    static async getAll(guildId) {
        const dbService = ServiceManager.get('dbService');
        const rows = await dbService.query(
            'SELECT * FROM ticket_auto_responses WHERE guild_id = ? ORDER BY created_at ASC',
            [guildId]
        );
        return rows.map(r => {
            if (r.keywords && typeof r.keywords === 'string') {
                try { r.keywords = JSON.parse(r.keywords); } catch { r.keywords = []; }
            }
            return r;
        });
    }

    static async create(guildId, keywords, response) {
        const dbService = ServiceManager.get('dbService');
        await dbService.query(
            'INSERT INTO ticket_auto_responses (guild_id, keywords, response) VALUES (?, ?, ?)',
            [guildId, JSON.stringify(keywords), response]
        );
    }

    static async update(id, guildId, data) {
        const dbService = ServiceManager.get('dbService');
        const sets = [];
        const values = [];
        if (data.keywords !== undefined) {
            sets.push('keywords = ?');
            values.push(JSON.stringify(data.keywords));
        }
        if (data.response !== undefined) {
            sets.push('response = ?');
            values.push(data.response);
        }
        if (data.is_active !== undefined) {
            sets.push('is_active = ?');
            values.push(data.is_active ? 1 : 0);
        }
        if (sets.length === 0) return;
        values.push(id, guildId);
        await dbService.query(
            `UPDATE ticket_auto_responses SET ${sets.join(', ')} WHERE id = ? AND guild_id = ?`,
            values
        );
    }

    static async delete(id, guildId) {
        const dbService = ServiceManager.get('dbService');
        await dbService.query(
            'DELETE FROM ticket_auto_responses WHERE id = ? AND guild_id = ?',
            [id, guildId]
        );
    }
}

module.exports = TicketAutoResponses;
