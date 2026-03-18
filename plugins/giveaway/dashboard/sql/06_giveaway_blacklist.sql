-- ============================================================
-- Giveaway Plugin – Basis-Tabelle: Blacklist
-- ============================================================
CREATE TABLE IF NOT EXISTS giveaway_blacklist (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    guild_id        VARCHAR(20) NOT NULL,
    user_id         VARCHAR(20) NOT NULL,
    reason          TEXT NULL,
    blocked_by      VARCHAR(20) NOT NULL,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_blacklist (guild_id, user_id),
    INDEX idx_blacklist_guild (guild_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
