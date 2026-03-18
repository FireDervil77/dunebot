-- 19_frontend_footer: CMS-Style Footer-Verwaltung
-- Spalten und Links im Footer der öffentlichen Seite.

CREATE TABLE IF NOT EXISTS `frontend_footer_columns` (
    `id`            INT           NOT NULL AUTO_INCREMENT,
    `title`         VARCHAR(255)  NOT NULL COMMENT 'Spalten-Überschrift',
    `col_width`     VARCHAR(20)   NOT NULL DEFAULT 'col-lg-3' COMMENT 'Bootstrap-Spaltenbreite',
    `position`      INT           NOT NULL DEFAULT 0,
    `visible`       TINYINT(1)    NOT NULL DEFAULT 1,
    `column_type`   VARCHAR(30)   NOT NULL DEFAULT 'links' COMMENT 'links, about, social, custom',
    `content`       TEXT          NULL     COMMENT 'Freitext/HTML für about/custom Typ',
    `created_at`    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_position` (`position`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `frontend_footer_links` (
    `id`            INT           NOT NULL AUTO_INCREMENT,
    `column_id`     INT           NOT NULL,
    `label`         VARCHAR(255)  NOT NULL,
    `url`           VARCHAR(500)  NOT NULL DEFAULT '#',
    `icon`          VARCHAR(100)  NULL,
    `target`        VARCHAR(20)   NOT NULL DEFAULT '_self',
    `position`      INT           NOT NULL DEFAULT 0,
    `visible`       TINYINT(1)    NOT NULL DEFAULT 1,
    `created_at`    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_column` (`column_id`),
    KEY `idx_position` (`position`),
    CONSTRAINT `fk_footer_link_column`
        FOREIGN KEY (`column_id`) REFERENCES `frontend_footer_columns` (`id`)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
