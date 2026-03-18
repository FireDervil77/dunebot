-- ============================================================
-- Giveaway Plugin – Basis-Tabelle: Giveaways
-- ============================================================
CREATE TABLE IF NOT EXISTS giveaways (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    guild_id        VARCHAR(20) NOT NULL,
    channel_id      VARCHAR(20) NOT NULL,
    message_id      VARCHAR(20) NULL,
    title           VARCHAR(255) NOT NULL DEFAULT 'Giveaway',
    description     TEXT NULL,
    prize           VARCHAR(255) NOT NULL,
    winner_count    INT NOT NULL DEFAULT 1,
    starts_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ends_at         TIMESTAMP NOT NULL,
    ended_at        TIMESTAMP NULL,
    status          ENUM('active','paused','ended','cancelled') NOT NULL DEFAULT 'active',
    created_by      VARCHAR(20) NOT NULL,
    hosted_by       VARCHAR(20) NULL,
    embed_color     VARCHAR(7) NOT NULL DEFAULT '#f59e0b',
    button_emoji    VARCHAR(50) CHARACTER SET utf8mb4 NOT NULL DEFAULT 'gift',
    allowed_roles   JSON NULL COMMENT 'Array of role IDs that can enter',
    metadata        JSON NULL COMMENT 'Erweiterungen Phase 2+',
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_guild_status (guild_id, status),
    INDEX idx_ends_at (ends_at),
    INDEX idx_message (message_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
