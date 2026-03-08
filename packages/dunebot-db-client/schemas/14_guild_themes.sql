-- 14_guild_themes: Per-Guild Theme-Auswahl
-- Speichert welches Theme für eine Guild aktiv ist.
-- Fehlt ein Eintrag → globaler Default aus ENV (ACTIVE_THEME) wird genutzt.

CREATE TABLE IF NOT EXISTS `guild_themes` (
    `id`         INT          NOT NULL AUTO_INCREMENT,
    `guild_id`   VARCHAR(20)  NOT NULL,
    `theme_name` VARCHAR(100) NOT NULL DEFAULT 'default',
    `updated_at` TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_guild_themes_guild` (`guild_id`),
    CONSTRAINT `fk_guild_themes_guild`
        FOREIGN KEY (`guild_id`) REFERENCES `guilds` (`_id`)
        ON DELETE CASCADE
        ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
