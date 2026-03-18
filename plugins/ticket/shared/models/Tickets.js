const { ServiceManager } = require('dunebot-core');

class Tickets {
    static async create(guildId, data) {
        const dbService = ServiceManager.get('dbService');
        try {
            // Nächste Ticket-Nummer ermitteln
            const [countRow] = await dbService.query(
                'SELECT COALESCE(MAX(ticket_number), 0) + 1 AS next_number FROM tickets WHERE guild_id = ?',
                [guildId]
            );
            const ticketNumber = countRow.next_number;

            const result = await dbService.query(
                `INSERT INTO tickets 
                 (guild_id, category_id, channel_id, ticket_id, ticket_number, created_by, category_name, form_responses) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    guildId,
                    data.category_id || null,
                    data.channel_id,
                    data.ticket_id,
                    ticketNumber,
                    data.created_by,
                    data.category_name || 'Default',
                    data.form_responses ? JSON.stringify(data.form_responses) : null
                ]
            );
            return { id: result.insertId, ticket_number: ticketNumber };
        } catch (error) {
            const Logger = ServiceManager.get('Logger');
            Logger.error('[Ticket] Fehler beim Erstellen des Tickets:', error);
            throw error;
        }
    }

    static async close(guildId, ticketId, closedBy, reason, transcript) {
        const dbService = ServiceManager.get('dbService');
        try {
            // Ticket-Datensatz finden
            const rows = await dbService.query(
                'SELECT id, category_name FROM tickets WHERE guild_id = ? AND ticket_id = ?',
                [guildId, ticketId]
            );
            if (rows.length === 0) return null;
            const ticket = rows[0];

            // Ticket schließen
            await dbService.query(
                `UPDATE tickets SET status = 'closed', closed_by = ?, close_reason = ?, closed_at = CURRENT_TIMESTAMP WHERE id = ?`,
                [closedBy, reason || null, ticket.id]
            );

            // Transkript speichern
            if (transcript && transcript.length > 0) {
                await dbService.query(
                    `INSERT INTO ticket_transcripts (ticket_id, guild_id, messages, message_count) VALUES (?, ?, ?, ?)`,
                    [ticket.id, guildId, JSON.stringify(transcript), transcript.length]
                );
            }

            return ticket;
        } catch (error) {
            const Logger = ServiceManager.get('Logger');
            Logger.error('[Ticket] Fehler beim Schließen des Tickets:', error);
            throw error;
        }
    }

    static async getByTicketId(guildId, ticketId) {
        const dbService = ServiceManager.get('dbService');
        try {
            const rows = await dbService.query(
                'SELECT * FROM tickets WHERE guild_id = ? AND ticket_id = ?',
                [guildId, ticketId]
            );
            return rows[0] || null;
        } catch (error) {
            const Logger = ServiceManager.get('Logger');
            Logger.error('[Ticket] Fehler beim Laden des Tickets:', error);
            throw error;
        }
    }

    static async getByChannelId(channelId) {
        const dbService = ServiceManager.get('dbService');
        try {
            const rows = await dbService.query(
                'SELECT * FROM tickets WHERE channel_id = ?',
                [channelId]
            );
            return rows[0] || null;
        } catch (error) {
            const Logger = ServiceManager.get('Logger');
            Logger.error('[Ticket] Fehler beim Laden des Tickets:', error);
            throw error;
        }
    }

    static async getOpenByUser(guildId, userId) {
        const dbService = ServiceManager.get('dbService');
        try {
            const rows = await dbService.query(
                "SELECT * FROM tickets WHERE guild_id = ? AND created_by = ? AND status = 'open'",
                [guildId, userId]
            );
            return rows;
        } catch (error) {
            const Logger = ServiceManager.get('Logger');
            Logger.error('[Ticket] Fehler beim Laden der offenen Tickets:', error);
            throw error;
        }
    }

    static async getOpenCount(guildId) {
        const dbService = ServiceManager.get('dbService');
        try {
            const rows = await dbService.query(
                "SELECT COUNT(*) as count FROM tickets WHERE guild_id = ? AND status = 'open'",
                [guildId]
            );
            return rows[0].count;
        } catch (error) {
            return 0;
        }
    }

    static async getAll(guildId, options = {}) {
        const dbService = ServiceManager.get('dbService');
        try {
            const { status, limit = 50, offset = 0 } = options;
            let query = 'SELECT * FROM tickets WHERE guild_id = ?';
            const params = [guildId];

            if (status) {
                query += ' AND status = ?';
                params.push(status);
            }

            query += ' ORDER BY opened_at DESC LIMIT ? OFFSET ?';
            params.push(limit, offset);

            return await dbService.query(query, params);
        } catch (error) {
            const Logger = ServiceManager.get('Logger');
            Logger.error('[Ticket] Fehler beim Laden der Tickets:', error);
            throw error;
        }
    }

    static async getCount(guildId, status) {
        const dbService = ServiceManager.get('dbService');
        try {
            let query = 'SELECT COUNT(*) as count FROM tickets WHERE guild_id = ?';
            const params = [guildId];
            if (status) {
                query += ' AND status = ?';
                params.push(status);
            }
            const rows = await dbService.query(query, params);
            return rows[0].count;
        } catch (error) {
            return 0;
        }
    }

    static async getTranscript(ticketDbId) {
        const dbService = ServiceManager.get('dbService');
        try {
            const rows = await dbService.query(
                'SELECT * FROM ticket_transcripts WHERE ticket_id = ?',
                [ticketDbId]
            );
            if (rows.length === 0) return null;
            const row = rows[0];
            if (row.messages && typeof row.messages === 'string') {
                try { row.messages = JSON.parse(row.messages); } catch { row.messages = []; }
            }
            return row;
        } catch (error) {
            const Logger = ServiceManager.get('Logger');
            Logger.error('[Ticket] Fehler beim Laden des Transkripts:', error);
            throw error;
        }
    }

    static async claim(guildId, ticketId, claimedBy) {
        const dbService = ServiceManager.get('dbService');
        try {
            const result = await dbService.query(
                `UPDATE tickets SET claimed_by = ?, claimed_at = CURRENT_TIMESTAMP WHERE guild_id = ? AND ticket_id = ? AND status = 'open'`,
                [claimedBy, guildId, ticketId]
            );
            return result.affectedRows > 0;
        } catch (error) {
            const Logger = ServiceManager.get('Logger');
            Logger.error('[Ticket] Fehler beim Claimen des Tickets:', error);
            throw error;
        }
    }

    static async unclaim(guildId, ticketId) {
        const dbService = ServiceManager.get('dbService');
        try {
            const result = await dbService.query(
                `UPDATE tickets SET claimed_by = NULL, claimed_at = NULL WHERE guild_id = ? AND ticket_id = ? AND status = 'open'`,
                [guildId, ticketId]
            );
            return result.affectedRows > 0;
        } catch (error) {
            const Logger = ServiceManager.get('Logger');
            Logger.error('[Ticket] Fehler beim Unclaimen des Tickets:', error);
            throw error;
        }
    }

    static async reopen(guildId, ticketId, reopenedBy, newChannelId) {
        const dbService = ServiceManager.get('dbService');
        try {
            const result = await dbService.query(
                `UPDATE tickets SET status = 'open', channel_id = ?, reopened_by = ?, reopened_at = CURRENT_TIMESTAMP, 
                 reopen_count = reopen_count + 1, closed_by = NULL, closed_at = NULL, close_reason = NULL
                 WHERE guild_id = ? AND ticket_id = ? AND status = 'closed'`,
                [newChannelId, reopenedBy, guildId, ticketId]
            );
            return result.affectedRows > 0;
        } catch (error) {
            const Logger = ServiceManager.get('Logger');
            Logger.error('[Ticket] Fehler beim Reopening des Tickets:', error);
            throw error;
        }
    }
}

module.exports = Tickets;
