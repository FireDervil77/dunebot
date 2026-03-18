-- ============================================================
-- Giveaway Plugin – Basis-Tabelle: Einträge (Teilnahmen)
-- ============================================================
CREATE TABLE IF NOT EXISTS giveaway_entries (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    giveaway_id     INT NOT NULL,
    user_id         VARCHAR(20) NOT NULL,
    entry_count     INT NOT NULL DEFAULT 1,
    entered_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_entry (giveaway_id, user_id),
    CONSTRAINT fk_entry_giveaway FOREIGN KEY (giveaway_id)
        REFERENCES giveaways(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
