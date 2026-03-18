const { ServiceManager } = require('dunebot-core');

class TicketFeedback {
    static async create(guildId, ticketId, userId, rating, comment) {
        const dbService = ServiceManager.get('dbService');
        await dbService.query(
            'INSERT INTO ticket_feedback (guild_id, ticket_id, user_id, rating, comment) VALUES (?, ?, ?, ?, ?)',
            [guildId, ticketId, userId, rating, comment || null]
        );
    }

    static async getByTicketId(ticketId) {
        const dbService = ServiceManager.get('dbService');
        const rows = await dbService.query(
            'SELECT * FROM ticket_feedback WHERE ticket_id = ?',
            [ticketId]
        );
        return rows[0] || null;
    }

    static async getAll(guildId, limit = 50, offset = 0) {
        const dbService = ServiceManager.get('dbService');
        return dbService.query(
            `SELECT tf.*, t.ticket_id AS ticket_short_id, t.category_name, t.claimed_by
             FROM ticket_feedback tf
             JOIN tickets t ON tf.ticket_id = t.id
             WHERE tf.guild_id = ?
             ORDER BY tf.created_at DESC
             LIMIT ? OFFSET ?`,
            [guildId, limit, offset]
        );
    }

    static async getAverageRating(guildId) {
        const dbService = ServiceManager.get('dbService');
        const rows = await dbService.query(
            'SELECT AVG(rating) as avg_rating, COUNT(*) as total FROM ticket_feedback WHERE guild_id = ?',
            [guildId]
        );
        return rows[0] || { avg_rating: 0, total: 0 };
    }
}

module.exports = TicketFeedback;
