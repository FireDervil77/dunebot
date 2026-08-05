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
        const baum = topLevel.map(item => ({
            ...item,
            children: rows.filter(r => r.parent_id === item.id)
                .sort((a, b) => a.position - b.position)
        }));

        return baum.concat(await this._seitenFuersMenue(db, rows));
    }

    /**
     * Veröffentlichte Seiten, die ins Menü gehören.
     *
     * `frontend_pages` hat seit jeher ein Feld `visible_in_menu`. Es wird im
     * Seiten-Editor als Schalter angeboten, gespeichert und in der Seitenliste
     * als Abzeichen angezeigt — gelesen hat es beim Aufbau des Menüs aber
     * niemand. Wer eine Seite anlegte und den Schalter setzte, wartete
     * vergeblich; sichtbar wurde sie erst, wenn man zusätzlich von Hand einen
     * Menüpunkt anlegte. Genau das ist mit den vorhandenen Seiten passiert.
     *
     * Ab hier trägt der Schalter. Ein von Hand angelegter Menüpunkt hat
     * weiterhin Vorrang: Zeigt bereits einer auf dieselbe Adresse, kommt die
     * Seite nicht zusätzlich dazu — sonst stünde sie nach dem Umlegen des
     * Schalters doppelt im Menü.
     *
     * @private
     * @param {object} db
     * @param {Array} vorhandene - bereits geladene Menüpunkte
     * @returns {Promise<Array>}
     */
    static async _seitenFuersMenue(db, vorhandene) {
        let seiten;
        try {
            seiten = await db.query(
                `SELECT title, slug, position FROM frontend_pages
                 WHERE status = 'published' AND visible_in_menu = 1
                 ORDER BY position ASC`
            );
        } catch (_) {
            // Tabelle gibt es erst nach der Migration — kein Grund, das
            // gesamte Menü zu verlieren.
            return [];
        }

        const belegt = new Set((vorhandene || []).map(m => m.url));

        return (seiten || [])
            .map(s => ({ ...s, url: `/page/${s.slug}` }))
            .filter(s => !belegt.has(s.url))
            .map(s => ({
                id:        `seite-${s.slug}`,
                parent_id: null,
                label:     s.title,
                url:       s.url,
                icon:      null,
                target:    '_self',
                position:  s.position || 0,
                visible:   1,
                css_class: null,
                children:  []
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
