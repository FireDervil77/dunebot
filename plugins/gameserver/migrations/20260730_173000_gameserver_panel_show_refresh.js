'use strict';

/**
 * Trennt "Neu laden" von "Starten/Stoppen".
 *
 * Bisher schaltete `show_controls` alle drei Buttons gemeinsam. Damit gab es nur
 * ganz oder gar nicht: Ein öffentliches Panel, auf dem jeder den Status frisch
 * abrufen darf, ohne dass jemand den Server durchschalten kann, war nicht
 * baubar – obwohl genau das die naheliegende Aufteilung ist. Aktualisieren ist
 * lesend, Starten und Stoppen sind es nicht.
 *
 * `show_controls` bedeutet ab hier nur noch Start/Stop. Bestandspanels bekommen
 * `show_refresh = TRUE`, behalten also genau die Buttons, die sie heute zeigen.
 */
module.exports = {
    description: 'gameserver-panel-show-refresh',

    async up(db) {
        const [existing] = await db.query(`
            SELECT COUNT(*) AS n
            FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'gameserver_status_panels'
              AND COLUMN_NAME = 'show_refresh'
        `);

        if (Number(existing?.n) > 0) return;

        await db.query(`
            ALTER TABLE gameserver_status_panels
            ADD COLUMN show_refresh BOOLEAN NOT NULL DEFAULT TRUE
                COMMENT 'Neu-laden-Button, getrennt von Start/Stop'
                AFTER show_controls
        `);
    },

    async down(db) {
        await db.query('ALTER TABLE gameserver_status_panels DROP COLUMN show_refresh');
    }
};
