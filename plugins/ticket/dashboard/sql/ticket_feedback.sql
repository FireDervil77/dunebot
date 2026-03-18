CREATE TABLE IF NOT EXISTS `ticket_feedback` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `guild_id` VARCHAR(20) NOT NULL,
  `ticket_id` INT UNSIGNED NOT NULL,
  `user_id` VARCHAR(20) NOT NULL,
  `rating` TINYINT UNSIGNED NOT NULL,
  `comment` TEXT DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_ticket_feedback` (`ticket_id`),
  KEY `idx_guild` (`guild_id`),
  CONSTRAINT `fk_feedback_ticket` FOREIGN KEY (`ticket_id`) REFERENCES `tickets` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
