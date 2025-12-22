-- =====================================================
-- Tabelle: dune_quest_chains
-- Quest-Ketten (z.B. Counter-Insurgency 5-Quest-Chain)
-- Erstellt: 9. November 2025
-- =====================================================

CREATE TABLE IF NOT EXISTS dune_quest_chains (
  id INT AUTO_INCREMENT PRIMARY KEY,
  
  chain_name_en VARCHAR(255) NOT NULL COMMENT 'Englischer Ketten-Name',
  chain_name_de VARCHAR(255) DEFAULT NULL COMMENT 'Deutscher Ketten-Name',
  chain_slug VARCHAR(100) UNIQUE NOT NULL COMMENT 'URL-freundlicher Identifier',
  
  description_en TEXT DEFAULT NULL COMMENT 'Beschreibung (Englisch)',
  description_de TEXT DEFAULT NULL COMMENT 'Beschreibung (Deutsch)',
  
  quest_type ENUM(
    'main_story',
    'journey',
    'side_quest',
    'trial',
    'class_trainer',
    'faction',
    'exploration',
    'assassination'
  ) NOT NULL COMMENT 'Quest-Typ der Kette',
  
  faction ENUM('neutral', 'atreides', 'harkonnen', 'imperial', 'fremen', 'guild', 'bene_gesserit') DEFAULT 'neutral',
  
  total_quests INT DEFAULT 0 COMMENT 'Anzahl Quests in der Kette',
  
  -- Gesamt-Belohnungen
  total_xp INT DEFAULT 0 COMMENT 'Gesamt-XP der Kette',
  total_solari INT DEFAULT 0 COMMENT 'Gesamt-Solari der Kette',
  final_rewards JSON DEFAULT NULL COMMENT 'Spezielle Belohnungen am Ende der Kette',
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  INDEX idx_chain_type (quest_type),
  INDEX idx_chain_faction (faction),
  INDEX idx_chain_slug (chain_slug)
  
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Quest-Ketten';

-- Foreign Key für quest_chain_id (nach Erstellung von dune_quests)
-- ALTER TABLE dune_quests ADD CONSTRAINT fk_quest_chain FOREIGN KEY (quest_chain_id) REFERENCES dune_quest_chains(id) ON DELETE SET NULL;
