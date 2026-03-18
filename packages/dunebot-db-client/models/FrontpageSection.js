/**
 * FrontpageSection Model
 * CRUD-Operationen für die frontpage_sections Tabelle
 *
 * @author firedervil
 */

const { ServiceManager } = require('dunebot-core');

class FrontpageSection {

    /**
     * Alle Sektionen (sortiert nach Position)
     * @returns {Promise<Array>}
     */
    static async getAll() {
        const db = ServiceManager.get('dbService');
        const rows = await db.query(
            'SELECT * FROM frontpage_sections ORDER BY position ASC'
        );
        return rows.map(FrontpageSection._parseConfig);
    }

    /**
     * Nur sichtbare Sektionen (für Frontend)
     * @returns {Promise<Array>}
     */
    static async getVisible() {
        const db = ServiceManager.get('dbService');
        const rows = await db.query(
            'SELECT * FROM frontpage_sections WHERE visible = 1 ORDER BY position ASC'
        );
        return rows.map(FrontpageSection._parseConfig);
    }

    /**
     * Einzelne Sektion nach ID
     * @param {number} id
     * @returns {Promise<Object|null>}
     */
    static async getById(id) {
        const db = ServiceManager.get('dbService');
        const rows = await db.query(
            'SELECT * FROM frontpage_sections WHERE id = ?',
            [id]
        );
        return rows.length ? FrontpageSection._parseConfig(rows[0]) : null;
    }

    /**
     * Einzelne Sektion nach Typ
     * @param {string} sectionType
     * @returns {Promise<Object|null>}
     */
    static async getByType(sectionType) {
        const db = ServiceManager.get('dbService');
        const rows = await db.query(
            'SELECT * FROM frontpage_sections WHERE section_type = ?',
            [sectionType]
        );
        return rows.length ? FrontpageSection._parseConfig(rows[0]) : null;
    }

    /**
     * Reihenfolge aller Sektionen aktualisieren
     * @param {Array<{id: number, position: number}>} order
     */
    static async updateOrder(order) {
        const db = ServiceManager.get('dbService');
        for (const item of order) {
            await db.query(
                'UPDATE frontpage_sections SET position = ? WHERE id = ?',
                [item.position, item.id]
            );
        }
    }

    /**
     * Sichtbarkeit einer Sektion umschalten
     * @param {number} id
     * @returns {Promise<boolean>} Neue Sichtbarkeit
     */
    static async toggleVisibility(id) {
        const db = ServiceManager.get('dbService');
        await db.query(
            'UPDATE frontpage_sections SET visible = NOT visible WHERE id = ?',
            [id]
        );
        const section = await FrontpageSection.getById(id);
        return section ? !!section.visible : false;
    }

    /**
     * Konfiguration einer Sektion aktualisieren
     * @param {number} id
     * @param {Object} updates - {title?, config?, css_class?, visible?, divider_before?, custom_html?}
     * @returns {Promise<Object|null>}
     */
    static async update(id, updates) {
        const db = ServiceManager.get('dbService');
        const allowed = ['title', 'config', 'css_class', 'visible', 'divider_before', 'custom_html'];
        const sets = [];
        const values = [];

        for (const key of allowed) {
            if (updates[key] !== undefined) {
                sets.push(`${key} = ?`);
                values.push(key === 'config' ? JSON.stringify(updates[key]) : updates[key]);
            }
        }

        if (sets.length === 0) return FrontpageSection.getById(id);

        values.push(id);
        await db.query(
            `UPDATE frontpage_sections SET ${sets.join(', ')} WHERE id = ?`,
            values
        );
        return FrontpageSection.getById(id);
    }

    /**
     * Neue Sektion erstellen
     * @param {Object} data
     * @returns {Promise<Object>}
     */
    static async create(data) {
        const db = ServiceManager.get('dbService');
        // Nächste Position ermitteln
        const rows = await db.query('SELECT COALESCE(MAX(position), 0) + 1 AS next_pos FROM frontpage_sections');
        const nextPos = rows[0].next_pos;

        const result = await db.query(
            `INSERT INTO frontpage_sections (section_type, title, position, visible, config, css_class, divider_before, custom_html)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                data.section_type || 'custom',
                data.title || 'Neue Sektion',
                nextPos,
                data.visible !== undefined ? data.visible : 1,
                data.config ? JSON.stringify(data.config) : '{}',
                data.css_class || '',
                data.divider_before || 'auto',
                data.custom_html || null
            ]
        );
        return FrontpageSection.getById(result.insertId);
    }

    /**
     * Sektion löschen
     * @param {number} id
     */
    static async delete(id) {
        const db = ServiceManager.get('dbService');
        await db.query('DELETE FROM frontpage_sections WHERE id = ?', [id]);
    }

    /**
     * JSON-config Feld parsen
     * @private
     */
    static _parseConfig(row) {
        if (row && typeof row.config === 'string') {
            try { row.config = JSON.parse(row.config); } catch { row.config = {}; }
        }
        if (row && row.config === null) row.config = {};
        return row;
    }
}

module.exports = FrontpageSection;
