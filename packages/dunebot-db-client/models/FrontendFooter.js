/**
 * FrontendFooter Model
 * CRUD für frontend_footer_columns + frontend_footer_links
 *
 * @author firedervil
 */

const { ServiceManager } = require('dunebot-core');

class FrontendFooter {

    // ── Spalten ──

    static async getColumns() {
        const db = ServiceManager.get('dbService');
        return db.query('SELECT * FROM frontend_footer_columns ORDER BY position ASC');
    }

    static async getVisibleColumnsWithLinks() {
        const db = ServiceManager.get('dbService');
        const columns = await db.query(
            'SELECT * FROM frontend_footer_columns WHERE visible = 1 ORDER BY position ASC'
        );
        const links = await db.query(
            'SELECT * FROM frontend_footer_links WHERE visible = 1 ORDER BY position ASC'
        );
        return columns.map(col => ({
            ...col,
            links: links.filter(l => l.column_id === col.id)
        }));
    }

    static async getColumnsWithLinks() {
        const db = ServiceManager.get('dbService');
        const columns = await db.query(
            'SELECT * FROM frontend_footer_columns ORDER BY position ASC'
        );
        const links = await db.query(
            'SELECT * FROM frontend_footer_links ORDER BY position ASC'
        );
        return columns.map(col => ({
            ...col,
            links: links.filter(l => l.column_id === col.id)
        }));
    }

    static async getColumnById(id) {
        const db = ServiceManager.get('dbService');
        const rows = await db.query('SELECT * FROM frontend_footer_columns WHERE id = ?', [id]);
        return rows.length ? rows[0] : null;
    }

    static async createColumn(data) {
        const db = ServiceManager.get('dbService');
        const posRows = await db.query('SELECT COALESCE(MAX(position), 0) + 1 AS np FROM frontend_footer_columns');
        const result = await db.query(
            `INSERT INTO frontend_footer_columns (title, col_width, position, visible, column_type, content)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [data.title, data.col_width || 'col-lg-3', posRows[0].np, data.visible ?? 1, data.column_type || 'links', data.content || null]
        );
        return FrontendFooter.getColumnById(result.insertId);
    }

    static async updateColumn(id, data) {
        const db = ServiceManager.get('dbService');
        const allowed = ['title', 'col_width', 'position', 'visible', 'column_type', 'content'];
        const sets = [];
        const values = [];
        for (const key of allowed) {
            if (data[key] !== undefined) { sets.push(`${key} = ?`); values.push(data[key]); }
        }
        if (sets.length === 0) return FrontendFooter.getColumnById(id);
        values.push(id);
        await db.query(`UPDATE frontend_footer_columns SET ${sets.join(', ')} WHERE id = ?`, values);
        return FrontendFooter.getColumnById(id);
    }

    static async deleteColumn(id) {
        const db = ServiceManager.get('dbService');
        await db.query('DELETE FROM frontend_footer_columns WHERE id = ?', [id]);
    }

    static async updateColumnOrder(order) {
        const db = ServiceManager.get('dbService');
        for (const item of order) {
            await db.query('UPDATE frontend_footer_columns SET position = ? WHERE id = ?', [item.position, item.id]);
        }
    }

    // ── Links ──

    static async getLinkById(id) {
        const db = ServiceManager.get('dbService');
        const rows = await db.query('SELECT * FROM frontend_footer_links WHERE id = ?', [id]);
        return rows.length ? rows[0] : null;
    }

    static async createLink(data) {
        const db = ServiceManager.get('dbService');
        const posRows = await db.query(
            'SELECT COALESCE(MAX(position), 0) + 1 AS np FROM frontend_footer_links WHERE column_id = ?',
            [data.column_id]
        );
        const result = await db.query(
            `INSERT INTO frontend_footer_links (column_id, label, url, icon, target, position, visible)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [data.column_id, data.label, data.url || '#', data.icon || null, data.target || '_self', posRows[0].np, data.visible ?? 1]
        );
        return FrontendFooter.getLinkById(result.insertId);
    }

    static async updateLink(id, data) {
        const db = ServiceManager.get('dbService');
        const allowed = ['column_id', 'label', 'url', 'icon', 'target', 'position', 'visible'];
        const sets = [];
        const values = [];
        for (const key of allowed) {
            if (data[key] !== undefined) { sets.push(`${key} = ?`); values.push(data[key]); }
        }
        if (sets.length === 0) return FrontendFooter.getLinkById(id);
        values.push(id);
        await db.query(`UPDATE frontend_footer_links SET ${sets.join(', ')} WHERE id = ?`, values);
        return FrontendFooter.getLinkById(id);
    }

    static async deleteLink(id) {
        const db = ServiceManager.get('dbService');
        await db.query('DELETE FROM frontend_footer_links WHERE id = ?', [id]);
    }
}

module.exports = FrontendFooter;
