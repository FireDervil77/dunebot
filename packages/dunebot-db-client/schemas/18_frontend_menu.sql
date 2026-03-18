-- 18_frontend_menu: CMS-Style Frontend-Navigation
-- Verwaltung der Menüpunkte in der öffentlichen Navigation.

CREATE TABLE IF NOT EXISTS `frontend_menu_items` (
    `id`            INT           NOT NULL AUTO_INCREMENT,
    `parent_id`     INT           NULL     COMMENT 'NULL = Top-Level, ID = Dropdown-Kind',
    `label`         VARCHAR(255)  NOT NULL COMMENT 'Angezeigter Menütext',
    `url`           VARCHAR(500)  NOT NULL DEFAULT '#' COMMENT 'Link-Ziel (URL oder Anker)',
    `icon`          VARCHAR(100)  NULL     COMMENT 'Optionale Icon-Klasse (z.B. bi bi-house)',
    `target`        VARCHAR(20)   NOT NULL DEFAULT '_self' COMMENT '_self oder _blank',
    `position`      INT           NOT NULL DEFAULT 0 COMMENT 'Sortier-Reihenfolge',
    `visible`       TINYINT(1)    NOT NULL DEFAULT 1,
    `css_class`     VARCHAR(100)  NULL     COMMENT 'Optionale CSS-Klasse',
    `created_at`    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_parent` (`parent_id`),
    KEY `idx_position` (`position`),
    CONSTRAINT `fk_menu_parent`
        FOREIGN KEY (`parent_id`) REFERENCES `frontend_menu_items` (`id`)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
