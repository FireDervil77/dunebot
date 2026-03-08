-- ============================================================================
-- User Feedback Votes - Upvoting-System für Feedback-Einträge
-- ============================================================================
CREATE TABLE IF NOT EXISTS `user_feedback_votes` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `feedback_id` INT UNSIGNED NOT NULL,
  `user_id` VARCHAR(20) NOT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_vote` (`feedback_id`, `user_id`),
  FOREIGN KEY (`feedback_id`) REFERENCES `user_feedback`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
