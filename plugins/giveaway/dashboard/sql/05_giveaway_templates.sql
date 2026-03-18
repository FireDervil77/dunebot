-- ============================================================
-- Giveaway Plugin – Basis-Tabelle: Vorlagen (Templates)
-- ============================================================
CREATE TABLE IF NOT EXISTS giveaway_templates (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    guild_id        VARCHAR(20) NOT NULL,
    name            VARCHAR(100) NOT NULL,
    config          JSON NOT NULL COMMENT '{"prize","duration","winner_count","embed_color","button_emoji","requirements":[]}',
    created_by      VARCHAR(20) NOT NULL,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_template (guild_id, name),
    INDEX idx_template_guild (guild_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
