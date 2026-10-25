'use strict';

/**
 * Discord-Panel: Beitrittspasswort zeigen (Stufe 9 S5, 2026-10-25).
 *
 * Der Besitzer entscheidet je Panel, ob das Passwort mit drinsteht — als
 * Discord-Spoiler, verdeckt bis zum Klick. Vorgabe AUS: Bestandspanels zeigen
 * weiter genau das, was sie heute zeigen. Welche Einstellung das Passwort ist,
 * sagt das Paket (`join_password`), nie eine Vermutung — das erste Passwort
 * wäre bei Minecraft der RCON-Zugang gewesen.
 */
module.exports = {
    description: 'gameserver-panel-show-password',

    async up(db) {
        const [existing] = await db.query(`
            SELECT COUNT(*) AS n
            FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'gameserver_status_panels'
              AND COLUMN_NAME = 'show_password'
        `);

        if (Number(existing?.n) > 0) return;

        await db.query(`
            ALTER TABLE gameserver_status_panels
            ADD COLUMN show_password BOOLEAN NOT NULL DEFAULT FALSE
                COMMENT 'Beitrittspasswort als Spoiler im Panel (Paket: join_password)'
                AFTER show_refresh
        `);
    },

    async down(db) {
        await db.query('ALTER TABLE gameserver_status_panels DROP COLUMN show_password');
    }
};
