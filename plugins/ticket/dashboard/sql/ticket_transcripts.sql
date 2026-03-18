CREATE TABLE IF NOT EXISTS ticket_transcripts (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    ticket_id INT UNSIGNED NOT NULL,
    guild_id VARCHAR(20) NOT NULL,
    messages JSON NOT NULL COMMENT 'Array of message objects',
    message_count INT UNSIGNED DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_ticket (ticket_id),
    INDEX idx_guild (guild_id),
    CONSTRAINT fk_transcript_ticket FOREIGN KEY (ticket_id) 
        REFERENCES tickets(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
