-- =============================================================================
-- Schema 15: Guild Widget Configuration
-- 
-- Speichert guild-spezifische Overrides für Widget-Bereiche, Reihenfolge
-- und Sichtbarkeit (WordPress-Stil Widget-Customization).
-- =============================================================================

CREATE TABLE IF NOT EXISTS `guild_widget_config` (
    `id`         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `guild_id`   VARCHAR(20) NOT NULL COMMENT 'Discord Guild ID',
    `widget_id`  VARCHAR(100) NOT NULL COMMENT 'Widget-Bezeichner (z.B. server-info)',
    `area`       VARCHAR(100) DEFAULT NULL COMMENT 'Override Widget-Bereich (NULL = Standard)',
    `position`   INT DEFAULT NULL COMMENT 'Override Reihenfolge im Bereich (NULL = Standard)',
    `visible`    TINYINT(1) DEFAULT NULL COMMENT 'Override Sichtbarkeit (NULL = Standard)',
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY `uq_guild_widget` (`guild_id`, `widget_id`),
    CONSTRAINT `fk_gwc_guild` FOREIGN KEY (`guild_id`)
        REFERENCES `guilds` (`_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Guild-spezifische Widget-Konfiguration (Bereich, Position, Sichtbarkeit)';
