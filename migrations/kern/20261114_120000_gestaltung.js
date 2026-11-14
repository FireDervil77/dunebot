'use strict';

/**
 * Gestaltung je Guild (G-09, K382, 2026-11-14).
 *
 * `guild_gestaltung`: eine Zeile je Guild und Ebene.
 *   - `plugin = ''`: die Palette der Guild (Einstellungen → Gestaltung) mit
 *     Logo und Banner. Eine Farbe NULL heißt „Vorgabe“.
 *   - `plugin = 'music'` usw.: eigene Farben dieses Plugins (Schalter
 *     „Farben der Guild nutzen“ aus). Ohne Zeile nutzt das Plugin die Farben
 *     der Guild. Logo und Banner bleiben dort NULL.
 * Logo und Banner zeigen auf `guild_media.id` derselben Guild. Wird das Bild
 * in der Medienablage gelöscht, findet die Abfrage nichts mehr, und die
 * Bot-Ausgaben sind wieder ohne.
 *
 * Keine Discord-ID eines Mitglieds. Geht mit der Guild
 * (`plugins/core/package.json` `guildInhalte`). Auflösung in
 * `packages/dunebot-sdk/lib/Gestaltung.js`.
 */
module.exports = {
    description: 'Gestaltung je Guild: Palette, Logo, Banner, Farben je Plugin (G-09)',

    async up(db) {
        await db.query(`
            CREATE TABLE IF NOT EXISTS guild_gestaltung (
                guild_id         VARCHAR(20)  NOT NULL,
                plugin           VARCHAR(32)  NOT NULL DEFAULT '',
                akzent           CHAR(7)      DEFAULT NULL,
                erfolg           CHAR(7)      DEFAULT NULL,
                hinweis          CHAR(7)      DEFAULT NULL,
                warnung          CHAR(7)      DEFAULT NULL,
                gefahr           CHAR(7)      DEFAULT NULL,
                logo_media_id    INT(11)      DEFAULT NULL,
                banner_media_id  INT(11)      DEFAULT NULL,
                geaendert_am     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
                PRIMARY KEY (guild_id, plugin)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
    },

    async down(db) {
        await db.query('DROP TABLE IF EXISTS guild_gestaltung');
    }
};
