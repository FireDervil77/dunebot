const { ServiceManager } = require('dunebot-core');

class TicketCategories {
    static _parseJsonFields(row) {
        if (!row) return row;
        for (const field of ['staff_roles', 'member_roles', 'form_fields']) {
            if (row[field] && typeof row[field] === 'string') {
                try { row[field] = JSON.parse(row[field]); } catch { row[field] = []; }
            }
            if (!Array.isArray(row[field])) row[field] = [];
        }
        return row;
    }

    static async getAll(guildId) {
        const dbService = ServiceManager.get('dbService');
        try {
            const rows = await dbService.query(
                'SELECT * FROM ticket_categories WHERE guild_id = ? ORDER BY created_at ASC',
                [guildId]
            );
            return rows.map(r => this._parseJsonFields(r));
        } catch (error) {
            const Logger = ServiceManager.get('Logger');
            Logger.error('[Ticket] Fehler beim Laden der Kategorien:', error);
            throw error;
        }
    }

    static async getActive(guildId) {
        const dbService = ServiceManager.get('dbService');
        try {
            const rows = await dbService.query(
                'SELECT * FROM ticket_categories WHERE guild_id = ? AND is_active = 1 ORDER BY created_at ASC',
                [guildId]
            );
            return rows.map(r => this._parseJsonFields(r));
        } catch (error) {
            const Logger = ServiceManager.get('Logger');
            Logger.error('[Ticket] Fehler beim Laden der aktiven Kategorien:', error);
            throw error;
        }
    }

    static async getById(id, guildId) {
        const dbService = ServiceManager.get('dbService');
        try {
            const rows = await dbService.query(
                'SELECT * FROM ticket_categories WHERE id = ? AND guild_id = ?',
                [id, guildId]
            );
            return this._parseJsonFields(rows[0] || null);
        } catch (error) {
            const Logger = ServiceManager.get('Logger');
            Logger.error('[Ticket] Fehler beim Laden der Kategorie:', error);
            throw error;
        }
    }

    static async getByName(guildId, name) {
        const dbService = ServiceManager.get('dbService');
        try {
            const rows = await dbService.query(
                'SELECT * FROM ticket_categories WHERE guild_id = ? AND name = ?',
                [guildId, name]
            );
            return this._parseJsonFields(rows[0] || null);
        } catch (error) {
            const Logger = ServiceManager.get('Logger');
            Logger.error('[Ticket] Fehler beim Laden der Kategorie:', error);
            throw error;
        }
    }

    static async create(guildId, data) {
        const dbService = ServiceManager.get('dbService');
        try {
            const result = await dbService.query(
                `INSERT INTO ticket_categories 
                 (guild_id, name, description, parent_id, channel_style, staff_roles, member_roles,
                  open_msg_title, open_msg_description, open_msg_footer, button_label, button_emoji, button_color, max_open_per_user, form_fields) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    guildId,
                    data.name,
                    data.description || null,
                    data.parent_id || null,
                    data.channel_style || 'NUMBER',
                    JSON.stringify(data.staff_roles || []),
                    JSON.stringify(data.member_roles || []),
                    data.open_msg_title || null,
                    data.open_msg_description || null,
                    data.open_msg_footer || null,
                    data.button_label || 'Ticket erstellen',
                    data.button_emoji || '🎫',
                    data.button_color || 'PRIMARY',
                    data.max_open_per_user || 1,
                    data.form_fields ? JSON.stringify(data.form_fields) : null
                ]
            );
            return result.insertId;
        } catch (error) {
            const Logger = ServiceManager.get('Logger');
            Logger.error('[Ticket] Fehler beim Erstellen der Kategorie:', error);
            throw error;
        }
    }

    static async update(id, guildId, updates) {
        const dbService = ServiceManager.get('dbService');
        try {
            // JSON-Felder stringifizieren
            if (updates.staff_roles !== undefined) updates.staff_roles = JSON.stringify(updates.staff_roles);
            if (updates.member_roles !== undefined) updates.member_roles = JSON.stringify(updates.member_roles);
            if (updates.form_fields !== undefined) updates.form_fields = JSON.stringify(updates.form_fields);

            const fields = Object.keys(updates).map(key => `${key} = ?`).join(', ');
            const values = [...Object.values(updates), id, guildId];
            const result = await dbService.query(
                `UPDATE ticket_categories SET ${fields} WHERE id = ? AND guild_id = ?`,
                values
            );
            return result.affectedRows > 0;
        } catch (error) {
            const Logger = ServiceManager.get('Logger');
            Logger.error('[Ticket] Fehler beim Aktualisieren der Kategorie:', error);
            throw error;
        }
    }

    static async delete(id, guildId) {
        const dbService = ServiceManager.get('dbService');
        try {
            const result = await dbService.query(
                'DELETE FROM ticket_categories WHERE id = ? AND guild_id = ?',
                [id, guildId]
            );
            return result.affectedRows > 0;
        } catch (error) {
            const Logger = ServiceManager.get('Logger');
            Logger.error('[Ticket] Fehler beim Löschen der Kategorie:', error);
            throw error;
        }
    }
}

module.exports = TicketCategories;
