/**
 * FrontendPage Model
 * CRUD für frontend_pages (statische CMS-Seiten)
 *
 * @author firedervil
 */

const { ServiceManager } = require('dunebot-core');

class FrontendPage {

    /**
     * Alle Seiten (sortiert nach Position)
     * @returns {Promise<Array>}
     */
    static async getAll() {
        const db = ServiceManager.get('dbService');
        return db.query('SELECT * FROM frontend_pages ORDER BY position ASC, created_at DESC');
    }

    /**
     * Nur veröffentlichte Seiten
     * @returns {Promise<Array>}
     */
    static async getPublished() {
        const db = ServiceManager.get('dbService');
        return db.query(
            "SELECT * FROM frontend_pages WHERE status = 'published' ORDER BY position ASC"
        );
    }

    /**
     * Seite nach ID
     * @param {number} id
     * @returns {Promise<Object|null>}
     */
    static async getById(id) {
        const db = ServiceManager.get('dbService');
        const rows = await db.query('SELECT * FROM frontend_pages WHERE id = ?', [id]);
        return rows.length ? rows[0] : null;
    }

    /**
     * Seite nach Slug (für Frontend-Rendering)
     * @param {string} slug
     * @returns {Promise<Object|null>}
     */
    static async getBySlug(slug) {
        const db = ServiceManager.get('dbService');
        const rows = await db.query(
            "SELECT * FROM frontend_pages WHERE slug = ? AND status = 'published'",
            [slug]
        );
        return rows.length ? rows[0] : null;
    }

    /**
     * Neue Seite erstellen
     * @param {Object} data
     * @returns {Promise<Object>}
     */
    static async create(data) {
        const db = ServiceManager.get('dbService');

        // Nächste Position
        const rows = await db.query('SELECT COALESCE(MAX(position), 0) + 1 AS next_pos FROM frontend_pages');
        const nextPos = rows[0].next_pos;

        const slug = FrontendPage.generateSlug(data.slug || data.title);

        const result = await db.query(
            `INSERT INTO frontend_pages (title, slug, content, status, template, meta_title, meta_description, position, visible_in_menu, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                data.title,
                slug,
                data.content || '',
                data.status || 'draft',
                data.template || 'default',
                data.meta_title || null,
                data.meta_description || null,
                data.position || nextPos,
                data.visible_in_menu ? 1 : 0,
                data.created_by || null
            ]
        );
        return FrontendPage.getById(result.insertId);
    }

    /**
     * Seite aktualisieren
     * @param {number} id
     * @param {Object} data
     * @returns {Promise<Object|null>}
     */
    static async update(id, data) {
        const db = ServiceManager.get('dbService');
        const allowed = ['title', 'slug', 'content', 'status', 'template', 'meta_title', 'meta_description', 'position', 'visible_in_menu'];
        const sets = [];
        const values = [];

        for (const key of allowed) {
            if (data[key] !== undefined) {
                sets.push(`${key} = ?`);
                if (key === 'slug') {
                    values.push(FrontendPage.generateSlug(data[key]));
                } else {
                    values.push(data[key]);
                }
            }
        }
        if (sets.length === 0) return FrontendPage.getById(id);

        values.push(id);
        await db.query(`UPDATE frontend_pages SET ${sets.join(', ')} WHERE id = ?`, values);
        return FrontendPage.getById(id);
    }

    /**
     * Seite löschen
     * @param {number} id
     */
    static async delete(id) {
        const db = ServiceManager.get('dbService');
        await db.query('DELETE FROM frontend_pages WHERE id = ?', [id]);
    }

    /**
     * Prüft ob ein Slug bereits existiert
     * @param {string} slug
     * @param {number|null} excludeId - ID ausschließen (für Updates)
     * @returns {Promise<boolean>}
     */
    static async slugExists(slug, excludeId = null) {
        const db = ServiceManager.get('dbService');
        const normalizedSlug = FrontendPage.generateSlug(slug);
        let rows;
        if (excludeId) {
            rows = await db.query('SELECT id FROM frontend_pages WHERE slug = ? AND id != ?', [normalizedSlug, excludeId]);
        } else {
            rows = await db.query('SELECT id FROM frontend_pages WHERE slug = ?', [normalizedSlug]);
        }
        return rows.length > 0;
    }

    /**
     * Slug aus Text generieren (URL-sicher)
     * @param {string} text
     * @returns {string}
     */
    static generateSlug(text) {
        return text
            .toLowerCase()
            .trim()
            .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
            .replace(/[^a-z0-9-]/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');
    }
}

module.exports = FrontendPage;
