-- 16_guild_media: WordPress-Style Medien-Manager
-- Speichert hochgeladene Dateien (Bilder, Icons) pro Guild.

CREATE TABLE IF NOT EXISTS `guild_media` (
    `id`            INT           NOT NULL AUTO_INCREMENT,
    `guild_id`      VARCHAR(20)   NOT NULL,
    `uploaded_by`   VARCHAR(20)   NOT NULL COMMENT 'Discord User-ID des Uploaders',
    `filename`      VARCHAR(255)  NOT NULL COMMENT 'Original-Dateiname',
    `stored_name`   VARCHAR(255)  NOT NULL COMMENT 'Generierter Dateiname auf Disk',
    `mime_type`     VARCHAR(100)  NOT NULL,
    `file_size`     INT UNSIGNED  NOT NULL COMMENT 'Dateigröße in Bytes',
    `width`         INT UNSIGNED  NULL     COMMENT 'Bildbreite in px (nur Bilder)',
    `height`        INT UNSIGNED  NULL     COMMENT 'Bildhöhe in px (nur Bilder)',
    `alt_text`      VARCHAR(255)  NULL     COMMENT 'Alt-Text für Barrierefreiheit',
    `title`         VARCHAR(255)  NULL     COMMENT 'Optionaler Titel',
    `folder`        VARCHAR(100)  NOT NULL DEFAULT 'general' COMMENT 'Logischer Ordner (general, icons, banners, ...)',
    `created_at`    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_guild_media_guild` (`guild_id`),
    KEY `idx_guild_media_folder` (`guild_id`, `folder`),
    KEY `idx_guild_media_mime` (`guild_id`, `mime_type`),
    CONSTRAINT `fk_guild_media_guild`
        FOREIGN KEY (`guild_id`) REFERENCES `guilds` (`_id`)
        ON DELETE CASCADE
        ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
