-- ============================================================================
-- User Feedback - Bug Reports & Feature Requests
-- Kern-Feature: Feedback wird direkt an DuneBot-Entwickler gesendet
-- ============================================================================
CREATE TABLE IF NOT EXISTS `user_feedback` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `guild_id` VARCHAR(20) NOT NULL,
  `user_id` VARCHAR(20) NOT NULL,
  `type` ENUM('bug', 'feature') NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `description` TEXT NOT NULL,
  `category` VARCHAR(50) DEFAULT NULL,
  `priority` ENUM('low', 'medium', 'high', 'critical') DEFAULT 'medium',
  `status` ENUM('open', 'in_progress', 'resolved', 'closed', 'wontfix') DEFAULT 'open',
  `upvotes` INT UNSIGNED DEFAULT 0,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_guild_type` (`guild_id`, `type`),
  INDEX `idx_status` (`status`),
  INDEX `idx_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
