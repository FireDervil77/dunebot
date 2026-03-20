-- =====================================================
-- Masterserver Plugin - Daemon Registration Tokens
-- =====================================================
-- One-time registration tokens for daemon setup
-- User generates token in dashboard, daemon uses it once
-- Token is marked as 'used' after successful registration
-- =====================================================

CREATE TABLE IF NOT EXISTS daemon_tokens (
    -- Primary Key
    id INT AUTO_INCREMENT PRIMARY KEY,
    
    -- Token Data
    token_hash VARCHAR(255) UNIQUE NOT NULL COMMENT 'bcrypt/argon2 hash of the registration token',
    guild_id VARCHAR(30) NOT NULL COMMENT 'Discord Guild ID this token belongs to',
    
    -- Metadata
    created_by VARCHAR(20) DEFAULT NULL COMMENT 'User ID who created this token',
    description VARCHAR(255) DEFAULT NULL COMMENT 'Optional description (e.g. "Production Server")',
    
    -- Expiry & Usage
    expires_at TIMESTAMP NOT NULL COMMENT 'Token expiration (default: +1 hour)',
    used TINYINT(1) DEFAULT 0 COMMENT 'Whether token has been used (0 = unused, 1 = used)',
    used_at TIMESTAMP NULL DEFAULT NULL COMMENT 'Timestamp when token was used',
    used_by_daemon_id VARCHAR(36) DEFAULT NULL COMMENT 'Daemon UUID that used this token',
    
    -- Timestamp
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT 'Token creation timestamp',
    
    -- Indexes
    INDEX idx_guild (guild_id),
    INDEX idx_expires (expires_at),
    INDEX idx_used (used),
    INDEX idx_token_hash (token_hash)
    
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='One-time registration tokens for daemon setup';
