'use strict';

module.exports = {
    description: 'add dm_embed_description template',

    async up(db) {
        await db.query(`
            ALTER TABLE moderation_settings
            ADD COLUMN IF NOT EXISTS dm_embed_description TEXT DEFAULT NULL
        `);
    },

    async down(db) {
        await db.query(`ALTER TABLE moderation_settings DROP COLUMN IF EXISTS dm_embed_description`);
    }
};
