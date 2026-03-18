-- ============================================================
-- Giveaway Plugin – Basis-Tabelle: Teilnahme-Anforderungen
-- ============================================================
CREATE TABLE IF NOT EXISTS giveaway_requirements (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    giveaway_id     INT NOT NULL,
    type            ENUM('role','min_account_age','min_server_age') NOT NULL,
    value           VARCHAR(255) NOT NULL COMMENT 'z.B. role_id oder Tage als Zahl',
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_req_giveaway FOREIGN KEY (giveaway_id)
        REFERENCES giveaways(id) ON DELETE CASCADE,
    INDEX idx_req_giveaway (giveaway_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
