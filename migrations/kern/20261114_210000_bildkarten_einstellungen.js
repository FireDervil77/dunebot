'use strict';

/**
 * Eigene Karten je Guild (G-22, F-G11, K382, 2026-11-14).
 *
 * `guild_bildkarten`: eine Zeile je Guild, Plugin und Karte. `karte` ist die
 * Karte, die das Plugin in seiner package.json unter `bildkarten` erklärt
 * (`greeting:willkommen`), `vorlage` die gewählte Schablone (NULL = die
 * erklärte). `werte` hält nur, was von der Vorgabe der Vorlage abweicht:
 * Farben als #rrggbb, Texte, Bilder als `guild_media.id` derselben Guild.
 * Geprüft wird beim Speichern (`Bildkarte.speichereEinstellung`), beim Lesen
 * fällt Unpassendes auf die Vorgabe.
 *
 * Keine Discord-ID eines Mitglieds, keine Frist. Geht mit der Guild
 * (`plugins/core/package.json` `guildInhalte`).
 */
module.exports = {
    description: 'Einstellungen der Bildkarten je Guild (G-22)',

    async up(db) {
        await db.query(`
            CREATE TABLE IF NOT EXISTS guild_bildkarten (
                guild_id      VARCHAR(20)  NOT NULL,
                plugin        VARCHAR(32)  NOT NULL,
                karte         VARCHAR(81)  NOT NULL,
                vorlage       VARCHAR(81)  NULL,
                werte         LONGTEXT     CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(werte)),
                geaendert_am  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
                PRIMARY KEY (guild_id, plugin, karte)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
    },

    async down(db) {
        await db.query('DROP TABLE IF EXISTS guild_bildkarten');
    }
};
