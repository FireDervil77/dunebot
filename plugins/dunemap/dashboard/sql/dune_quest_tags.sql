-- =====================================================
-- Tabelle: dune_quest_tags
-- Flexible Tags für Quests
-- Erstellt: 9. November 2025
-- =====================================================

CREATE TABLE IF NOT EXISTS dune_quest_tags (
  id INT AUTO_INCREMENT PRIMARY KEY,
  quest_id INT NOT NULL COMMENT 'Quest-ID (FK zu dune_quests)',
  tag VARCHAR(50) NOT NULL COMMENT 'Tag-Name (sandfly, sardaukar, spice, stealth, combat, etc.)',
  
  FOREIGN KEY (quest_id) REFERENCES dune_quests(id) ON DELETE CASCADE,
  UNIQUE KEY unique_quest_tag (quest_id, tag),
  INDEX idx_tag (tag)
  
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Quest-Tags';
