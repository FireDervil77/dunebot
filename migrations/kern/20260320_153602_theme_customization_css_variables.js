'use strict';

module.exports = {
    description: 'theme_customization_css_variables',

    async up(db) {
        await db.query(`
            ALTER TABLE guild_themes
            ADD COLUMN IF NOT EXISTS custom_css TEXT DEFAULT NULL AFTER theme_name,
            ADD COLUMN IF NOT EXISTS custom_variables JSON DEFAULT NULL AFTER custom_css
        `);
    },

    async down(db) {
        await db.query(`
            ALTER TABLE guild_themes
            DROP COLUMN IF EXISTS custom_css,
            DROP COLUMN IF EXISTS custom_variables
        `);
    }
};
