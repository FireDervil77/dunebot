'use strict';

module.exports = {
    description: 'cronjob-run-once',

    async up(db) {
        await db.query(`
            ALTER TABLE gameserver_cronjobs
            ADD COLUMN IF NOT EXISTS run_once TINYINT(1) NOT NULL DEFAULT 0
                COMMENT 'Einmalig ausführen: nach Ausführung wird enabled=0 gesetzt'
        `);
    },

    async down(db) {
        await db.query(`ALTER TABLE gameserver_cronjobs DROP COLUMN IF EXISTS run_once`);
    }
};
