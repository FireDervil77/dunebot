'use strict';

module.exports = {
    description: 'allow null member_id in moderation_logs for purge actions',

    async up(db) {
        await db.query(`
            ALTER TABLE moderation_logs
            MODIFY COLUMN member_id VARCHAR(255) DEFAULT NULL
        `);
    },

    async down(db) {
        await db.query(`
            ALTER TABLE moderation_logs
            MODIFY COLUMN member_id VARCHAR(255) NOT NULL
        `);
    }
};
