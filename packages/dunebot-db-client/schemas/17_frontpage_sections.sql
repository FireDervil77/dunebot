-- 17_frontpage_sections: CMS-Style Frontpage-Sektionen
-- Globale Konfiguration der Sektions-Reihenfolge und Sichtbarkeit auf der Landing Page.

CREATE TABLE IF NOT EXISTS `frontpage_sections` (
    `id`              INT           NOT NULL AUTO_INCREMENT,
    `section_type`    VARCHAR(50)   NOT NULL COMMENT 'Typ: hero, features, news, changelogs, plugins, documentation, stats, skills, custom',
    `title`           VARCHAR(255)  NOT NULL COMMENT 'Anzeige-Titel der Sektion',
    `position`        INT           NOT NULL DEFAULT 0 COMMENT 'Sortier-Reihenfolge (aufsteigend)',
    `visible`         TINYINT(1)    NOT NULL DEFAULT 1 COMMENT '1=sichtbar, 0=ausgeblendet',
    `config`          JSON          NULL     COMMENT 'Sektions-spezifische Konfiguration (JSON)',
    `css_class`       VARCHAR(100)  NOT NULL DEFAULT '' COMMENT 'CSS-Klasse (dark-background, light-background)',
    `divider_before`  VARCHAR(50)   NOT NULL DEFAULT 'auto' COMMENT 'Divider vor Sektion: auto, light-to-dark, dark-to-light, none',
    `custom_html`     TEXT          NULL     COMMENT 'HTML-Inhalt für custom Sektionen',
    `created_at`      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_section_type` (`section_type`),
    KEY `idx_position` (`position`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
