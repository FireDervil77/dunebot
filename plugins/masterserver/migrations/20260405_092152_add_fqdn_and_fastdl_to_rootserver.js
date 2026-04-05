'use strict';

module.exports = {
    description: 'add_fqdn_and_fastdl_to_rootserver',

    async up(db) {
        await db.query(`
            ALTER TABLE rootserver
            ADD COLUMN IF NOT EXISTS fqdn VARCHAR(255) DEFAULT NULL AFTER hostname,
            ADD COLUMN IF NOT EXISTS fastdl_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER fqdn,
            ADD COLUMN IF NOT EXISTS fastdl_url VARCHAR(512) DEFAULT NULL AFTER fastdl_enabled
        `);
    },

    async down(db) {
        await db.query(`
            ALTER TABLE rootserver
            DROP COLUMN IF EXISTS fqdn,
            DROP COLUMN IF EXISTS fastdl_enabled,
            DROP COLUMN IF EXISTS fastdl_url
        `);
    }
};
