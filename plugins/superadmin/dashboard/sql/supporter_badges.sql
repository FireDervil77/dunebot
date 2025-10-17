-- Tabelle für Supporter-Badges
CREATE TABLE IF NOT EXISTS supporter_badges (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id VARCHAR(20) UNIQUE NOT NULL COMMENT 'Discord User-ID',
    badge_level ENUM('bronze', 'silver', 'gold', 'platinum') DEFAULT 'bronze' COMMENT 'Badge-Level basierend auf Gesamt-Donations',
    total_donated DECIMAL(10,2) DEFAULT 0.00 COMMENT 'Gesamt-Betrag aller completed Donations',
    first_donation_at TIMESTAMP COMMENT 'Zeitpunkt der ersten Donation',
    last_donation_at TIMESTAMP COMMENT 'Zeitpunkt der letzten Donation',
    donation_count INT DEFAULT 0 COMMENT 'Anzahl der Donations',
    is_recurring TINYINT(1) DEFAULT 0 COMMENT 'Aktiver monatlicher Supporter (für zukünftige Features)',
    recurring_amount DECIMAL(10,2) DEFAULT 0.00 COMMENT 'Monatlicher Betrag bei Recurring',
    badge_visible TINYINT(1) DEFAULT 1 COMMENT 'Badge im Dashboard anzeigen',
    is_active TINYINT(1) DEFAULT 1 COMMENT 'Badge ist aktiv (nicht deaktiviert)',
    discord_role_synced TINYINT(1) DEFAULT 0 COMMENT 'Discord-Role wurde vergeben',
    last_role_sync TIMESTAMP NULL COMMENT 'Letzter Discord-Role-Sync',
    stripe_customer_id VARCHAR(255) COMMENT 'Stripe Customer-ID',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_level (badge_level),
    INDEX idx_recurring (is_recurring),
    INDEX idx_visible (badge_visible),
    INDEX idx_active (is_active),
    INDEX idx_total (total_donated),
    INDEX idx_stripe_customer (stripe_customer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Supporter-Badges für Spender';