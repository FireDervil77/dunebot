'use strict';

module.exports = {
    description: 'add_addons_frontpage_section',

    async up(db) {
        // Prüfe ob Section bereits existiert
        const [existing] = await db.query(
            "SELECT id FROM frontpage_sections WHERE section_type = 'addons' LIMIT 1"
        );
        if (existing) return;

        // Nächste Position ermitteln
        const [maxPos] = await db.query(
            "SELECT COALESCE(MAX(position), 0) + 1 AS next_pos FROM frontpage_sections"
        );
        const nextPos = maxPos?.next_pos || 99;

        await db.query(`
            INSERT INTO frontpage_sections (section_type, title, position, visible, config, css_class, divider_before)
            VALUES ('addons', 'Unterstützte Spiele', ?, 1, '{}', 'dark-background', 'auto')
        `, [nextPos]);
    },

    async down(db) {
        await db.query("DELETE FROM frontpage_sections WHERE section_type = 'addons'");
    }
};
