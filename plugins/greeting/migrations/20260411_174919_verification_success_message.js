'use strict';

module.exports = {
    description: 'Konfigurierbare Erfolgs-Nachricht nach Verifizierung',

    async up(db) {
        await db.query(`
            ALTER TABLE greeting_settings
            ADD COLUMN IF NOT EXISTS verification_success_message TEXT DEFAULT NULL
            AFTER verification_emoji
        `);
    },

    async down(db) {
        await db.query(`ALTER TABLE greeting_settings DROP COLUMN IF EXISTS verification_success_message`);
    }
};
