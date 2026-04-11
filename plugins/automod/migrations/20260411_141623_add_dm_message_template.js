'use strict';

module.exports = {
    description: 'add dm_message template',

    async up(db) {
        await db.query(`
            ALTER TABLE automod_settings
            ADD COLUMN IF NOT EXISTS dm_message TEXT DEFAULT NULL
        `);
    },

    async down(db) {
        await db.query(`ALTER TABLE automod_settings DROP COLUMN IF EXISTS dm_message`);
    }
};
