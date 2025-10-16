-- Donations-System Tabellen für Stripe-Integration
-- Autor: DuneBot Team
-- Datum: 2025-10-15

-- Tabelle für alle Donations (Stripe + Manuell)
CREATE TABLE IF NOT EXISTS donations (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id VARCHAR(20) NOT NULL COMMENT 'Discord User-ID des Spenders',
    guild_id VARCHAR(20) COMMENT 'Guild aus der gespendet wurde (optional)',
    amount DECIMAL(10,2) NOT NULL COMMENT 'Spendenbetrag in EUR',
    currency VARCHAR(3) DEFAULT 'EUR' COMMENT 'Währung (EUR, USD, etc.)',
    payment_provider ENUM('stripe', 'paypal', 'manual', 'other') DEFAULT 'stripe',
    payment_id VARCHAR(255) COMMENT 'Stripe Checkout Session ID oder Payment Intent ID',
    payment_status ENUM('pending', 'completed', 'failed', 'refunded', 'cancelled') DEFAULT 'pending',
    message TEXT COMMENT 'Optionale Nachricht vom Spender',
    is_recurring TINYINT(1) DEFAULT 0 COMMENT '0 = Einmalig, 1 = Monatlich (für zukünftige Subscription-Features)',
    recurring_until DATE COMMENT 'Bis wann läuft die recurring Donation',
    anonymous TINYINT(1) DEFAULT 0 COMMENT 'Anonyme Spende (Name nicht öffentlich anzeigen)',
    stripe_customer_id VARCHAR(255) COMMENT 'Stripe Customer-ID für Recurring Payments',
    metadata JSON COMMENT 'Zusätzliche Metadaten (Stripe-Details, etc.)',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_user (user_id),
    INDEX idx_guild (guild_id),
    INDEX idx_status (payment_status),
    INDEX idx_provider (payment_provider),
    INDEX idx_recurring (is_recurring),
    INDEX idx_created (created_at),
    INDEX idx_payment_id (payment_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Alle Donations (Stripe, PayPal, Manuell)';