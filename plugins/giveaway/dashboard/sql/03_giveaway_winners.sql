-- ============================================================
-- Giveaway Plugin – Basis-Tabelle: Gewinner
-- ============================================================
CREATE TABLE IF NOT EXISTS giveaway_winners (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    giveaway_id     INT NOT NULL,
    user_id         VARCHAR(20) NOT NULL,
    won_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    claimed_at      TIMESTAMP NULL,
    CONSTRAINT fk_winner_giveaway FOREIGN KEY (giveaway_id)
        REFERENCES giveaways(id) ON DELETE CASCADE,
    INDEX idx_giveaway_winners (giveaway_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
