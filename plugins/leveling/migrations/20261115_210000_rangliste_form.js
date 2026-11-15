'use strict';

/**
 * Leveling: Form der Rangliste wählbar (LV-2c, K382, 2026-11-15).
 *
 * `level_einstellungen.rangliste_form`:
 *   liste  Discord-Nachricht (Components V2) mit dem Banner der Guild als Kopf
 *   bild   Bildkarte `leveling:rangliste` (zehn Plätze mit Avatar), Aussehen
 *          im Kern-Bereich „Bildkarten“
 * Vorgabe `liste`. Bis hier war `/leaderboard` ein Embed.
 */
module.exports = {
    description: 'Leveling: Form der Rangliste (rangliste_form)',

    async up(db) {
        const spalten = await db.query(
            "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'level_einstellungen' AND COLUMN_NAME = 'rangliste_form'");
        if (!spalten.length) {
            await db.query("ALTER TABLE level_einstellungen ADD COLUMN rangliste_form ENUM('liste','bild') NOT NULL DEFAULT 'liste' AFTER rangkarte_anhaengen");
        }
    },

    async down(db) {
        await db.query('ALTER TABLE level_einstellungen DROP COLUMN rangliste_form');
    }
};
