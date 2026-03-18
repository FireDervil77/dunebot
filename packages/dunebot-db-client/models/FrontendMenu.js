/**
 * FrontendMenu Model
 * CRUD für frontend_menu_items (öffentliche Navigation)
 *
 * @author firedervil
 */

const { ServiceManager } = require('dunebot-core');

class FrontendMenu {

    /**
     * Alle Menüpunkte als verschachtelte Struktur
     * @returns {Promise<Array>}
     */
    static async getTree() {
        const db = ServiceManager.get('dbService');
        const rows = await db.query(
            'SELECT * FROM frontend_menu_items ORDER BY position ASC'
        );

        // Baum aufbauen: Top-Level + Kinder
        const topLevel = rows.filter(r => !r.parent_id);
        return topLevel.map(item => ({
            ...item,
            children: rows.filter(r => r.parent_id === item.id)
                .sort((a, b) => a.position - b.position)
        }));
    }

    /**
     * Nur sichtbare Menüpunkte als Baum (für Frontend)
     * @returns {Promise<Array>}
     */
    static async getVisibleTree() {
        const db = ServiceManager.get('dbService');
        const rows = await db.query(
            'SELECT * FROM frontend_menu_items WHERE visible = 1 ORDER BY position ASC'
        );
        const topLevel = rows.filter(r => !r.parent_id);
        return topLevel.map(item => ({
            ...item,
            children: rows.filter(r => r.parent_id === item.id)
                .sort((a, b) => a.position - b.position)
        }));
    }

    /**
     * Alle flach (für Admin)
     * @returns {Promise<Array>}
     */
    static async getAll() {
        const db = ServiceManager.get('dbService');
        return db.query('SELECT * FROM frontend_menu_items ORDER BY position ASC');
    }

    static async getById(id) {
        const db = ServiceManager.get('dbService');
        const rows = await db.query('SELECT * FROM frontend_menu_items WHERE id = ?', [id]);
        return rows.length ? rows[0] : null;
    }

    static async create(data) {
        const db = ServiceManager.get('dbService');
        const rows = await db.query(
            'SELECT COALESCE(MAX(position), 0) + 1 AS next_pos FROM frontend_menu_items WHERE parent_id IS NULL'
        );
        const result = await db.query(
            `INSERT INTO frontend_menu_items (parent_id, label, url, icon, target, position, visible, css_class)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                data.parent_id || null,
                data.label,
                data.url || '#',
                data.icon || null,
                data.target || '_self',
                data.position || rows[0].next_pos,
                data.visible !== undefined ? data.visible : 1,
                data.css_class || null
            ]
        );
        return FrontendMenu.getById(result.insertId);
    }

    static async update(id, data) {
        const db = ServiceManager.get('dbService');
        const allowed = ['parent_id', 'label', 'url', 'icon', 'target', 'position', 'visible', 'css_class'];
        const sets = [];
        const values = [];

        for (const key of allowed) {
            if (data[key] !== undefined) {
                sets.push(`${key} = ?`);
                values.push(data[key]);
            }
        }
        if (sets.length === 0) return FrontendMenu.getById(id);

        values.push(id);
        await db.query(`UPDATE frontend_menu_items SET ${sets.join(', ')} WHERE id = ?`, values);
        return FrontendMenu.getById(id);
    }

    static async updateOrder(order) {
        const db = ServiceManager.get('dbService');
        for (const item of order) {
            await db.query(
                'UPDATE frontend_menu_items SET position = ?, parent_id = ? WHERE id = ?',
                [item.position, item.parent_id !== undefined ? item.parent_id : null, item.id]
            );
        }
    }

    static async delete(id) {
        const db = ServiceManager.get('dbService');
        await db.query('DELETE FROM frontend_menu_items WHERE id = ?', [id]);
    }
}

module.exports = FrontendMenu;
