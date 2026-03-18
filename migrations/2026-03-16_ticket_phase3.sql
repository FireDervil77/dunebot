-- Migration: Ticket System Phase 3
-- Erstellt: ticket_settings, ticket_categories, tickets, ticket_transcripts

CREATE TABLE IF NOT EXISTS ticket_settings (
    guild_id VARCHAR(20) NOT NULL PRIMARY KEY,
    log_channel VARCHAR(20) DEFAULT NULL,
    ticket_limit INT UNSIGNED DEFAULT 10,
    embed_color_create VARCHAR(7) DEFAULT '#068ADD',
    embed_color_close VARCHAR(7) DEFAULT '#068ADD',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ticket_categories (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    guild_id VARCHAR(20) NOT NULL,
    name VARCHAR(100) NOT NULL,
    description TEXT DEFAULT NULL,
    parent_id VARCHAR(20) DEFAULT NULL COMMENT 'Discord Category ID (null = auto-create)',
    channel_style ENUM('NUMBER', 'NAME', 'ID') DEFAULT 'NUMBER',
    staff_roles JSON DEFAULT NULL,
    member_roles JSON DEFAULT NULL,
    open_msg_title VARCHAR(256) DEFAULT NULL,
    open_msg_description TEXT DEFAULT NULL,
    open_msg_footer VARCHAR(256) DEFAULT NULL,
    button_label VARCHAR(80) DEFAULT 'Ticket erstellen',
    button_emoji VARCHAR(50) DEFAULT '🎫',
    button_color ENUM('PRIMARY', 'SECONDARY', 'SUCCESS', 'DANGER') DEFAULT 'PRIMARY',
    max_open_per_user INT UNSIGNED DEFAULT 1,
    is_active TINYINT(1) DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_guild_name (guild_id, name),
    INDEX idx_guild (guild_id),
    INDEX idx_guild_active (guild_id, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tickets (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    guild_id VARCHAR(20) NOT NULL,
    category_id INT UNSIGNED DEFAULT NULL,
    channel_id VARCHAR(20) NOT NULL,
    ticket_id VARCHAR(20) NOT NULL COMMENT 'Unique short ID',
    ticket_number INT UNSIGNED NOT NULL,
    created_by VARCHAR(20) NOT NULL,
    claimed_by VARCHAR(20) DEFAULT NULL,
    status ENUM('open', 'closed') DEFAULT 'open',
    close_reason TEXT DEFAULT NULL,
    closed_by VARCHAR(20) DEFAULT NULL,
    category_name VARCHAR(100) DEFAULT NULL,
    opened_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    closed_at TIMESTAMP NULL DEFAULT NULL,
    UNIQUE KEY uk_guild_ticket_id (guild_id, ticket_id),
    INDEX idx_guild (guild_id),
    INDEX idx_guild_status (guild_id, status),
    INDEX idx_guild_user (guild_id, created_by),
    INDEX idx_channel (channel_id),
    CONSTRAINT fk_ticket_category FOREIGN KEY (category_id) 
        REFERENCES ticket_categories(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ticket_transcripts (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    ticket_id INT UNSIGNED NOT NULL,
    guild_id VARCHAR(20) NOT NULL,
    messages JSON NOT NULL,
    message_count INT UNSIGNED DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_ticket (ticket_id),
    INDEX idx_guild (guild_id),
    CONSTRAINT fk_transcript_ticket FOREIGN KEY (ticket_id) 
        REFERENCES tickets(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
