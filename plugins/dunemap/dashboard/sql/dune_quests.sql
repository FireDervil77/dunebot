-- =====================================================
-- Tabelle: dune_quests
-- Haupt-Tabelle für alle Quests
-- Erstellt: 9. November 2025
-- =====================================================

CREATE TABLE IF NOT EXISTS dune_quests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  
  -- Quest Identifikation
  quest_slug VARCHAR(100) UNIQUE NOT NULL COMMENT 'URL-freundlicher Identifier (z.B. counter-insurgency-1)',
  quest_name_en VARCHAR(255) NOT NULL COMMENT 'Englischer Quest-Name',
  quest_name_de VARCHAR(255) DEFAULT NULL COMMENT 'Deutscher Quest-Name',
  
  -- Kategorisierung
  quest_type ENUM(
    'main_story',           -- Hauptstory
    'journey',              -- Journey Quest
    'side_quest',           -- Nebenquest
    'trial',                -- Trial of Aql
    'class_trainer',        -- Klassenlehrer-Quest
    'faction',              -- Fraktions-Quest
    'exploration',          -- Erkundungs-Quest
    'assassination',        -- Assassinen-Handbuch
    'repeatable'            -- Wiederholbar
  ) NOT NULL DEFAULT 'side_quest' COMMENT 'Quest-Typ',
  
  quest_category VARCHAR(50) DEFAULT NULL COMMENT 'Quest-Kategorie (z.B. Find the Fremen, Counter-Insurgency)',
  
  -- Fraktion
  faction ENUM(
    'neutral',
    'atreides',
    'harkonnen',
    'imperial',
    'fremen',
    'guild',
    'bene_gesserit'
  ) DEFAULT 'neutral' COMMENT 'Zugehörige Fraktion',
  
  -- Quest-Geber
  quest_giver_npc VARCHAR(100) DEFAULT NULL COMMENT 'NPC der die Quest vergibt (NPC-Slug)',
  quest_giver_location VARCHAR(255) DEFAULT NULL COMMENT 'Location des Quest-Gebers',
  quest_giver_region VARCHAR(100) DEFAULT NULL COMMENT 'Region des Quest-Gebers',
  
  -- Location (wo Quest stattfindet)
  quest_location VARCHAR(255) DEFAULT NULL COMMENT 'Wo die Quest durchgeführt wird',
  quest_region VARCHAR(100) DEFAULT NULL COMMENT 'Region der Quest',
  
  -- Koordinaten (für Map-Integration)
  map_x DECIMAL(10,6) DEFAULT NULL COMMENT 'X-Koordinate auf der Karte',
  map_y DECIMAL(10,6) DEFAULT NULL COMMENT 'Y-Koordinate auf der Karte',
  
  -- Quest-Details
  description_en TEXT DEFAULT NULL COMMENT 'Quest-Beschreibung (Englisch)',
  description_de TEXT DEFAULT NULL COMMENT 'Quest-Beschreibung (Deutsch)',
  
  objectives_en JSON DEFAULT NULL COMMENT 'Quest-Ziele als Array (Englisch)',
  objectives_de JSON DEFAULT NULL COMMENT 'Quest-Ziele als Array (Deutsch)',
  
  quest_mechanic VARCHAR(100) DEFAULT NULL COMMENT 'Haupt-Spielmechanik (stealth, combat, puzzle, fetch, platforming)',
  difficulty ENUM('easy', 'medium', 'hard', 'very_hard') DEFAULT 'medium' COMMENT 'Schwierigkeitsgrad',
  
  -- Belohnungen
  reward_xp INT DEFAULT 0 COMMENT 'XP-Belohnung',
  reward_solari INT DEFAULT 0 COMMENT 'Solari-Belohnung (Währung)',
  reward_items JSON DEFAULT NULL COMMENT 'Item-Belohnungen als Array von Objekten',
  reward_skills JSON DEFAULT NULL COMMENT 'Skill-Belohnungen (z.B. Klassenfreischaltung)',
  
  -- Quest-Ketten
  quest_chain_id INT DEFAULT NULL COMMENT 'ID der Quest-Kette (FK zu dune_quest_chains)',
  quest_chain_position INT DEFAULT NULL COMMENT 'Position in der Kette (1, 2, 3...)',
  previous_quest_id INT DEFAULT NULL COMMENT 'Vorgänger-Quest (FK zu dune_quests)',
  next_quest_id INT DEFAULT NULL COMMENT 'Nachfolger-Quest (FK zu dune_quests)',
  
  -- Anforderungen
  required_level INT DEFAULT 1 COMMENT 'Benötigtes Level',
  required_skills JSON DEFAULT NULL COMMENT 'Benötigte Skills als Array',
  required_quests JSON DEFAULT NULL COMMENT 'Benötigte abgeschlossene Quests (IDs)',
  
  -- Lore & Story
  dialogue_en MEDIUMTEXT DEFAULT NULL COMMENT 'Vollständige NPC-Dialoge (Englisch)',
  dialogue_de MEDIUMTEXT DEFAULT NULL COMMENT 'Vollständige NPC-Dialoge (Deutsch)',
  story_context_en TEXT DEFAULT NULL COMMENT 'Story-Kontext/Hintergrund (Englisch)',
  story_context_de TEXT DEFAULT NULL COMMENT 'Story-Kontext/Hintergrund (Deutsch)',
  
  -- Bilder
  image_url VARCHAR(255) DEFAULT NULL COMMENT 'Location-Screenshot URL',
  icon_url VARCHAR(255) DEFAULT NULL COMMENT 'Quest-Icon URL',
  
  -- Meta-Daten
  source_primary ENUM('awakening.wiki', 'duneawakeningwiki.de', 'ign.com') NOT NULL COMMENT 'Primäre Datenquelle',
  source_confidence DECIMAL(3,2) DEFAULT 0.80 COMMENT 'Vertrauenswürdigkeit (0.00-1.00)',
  last_verified TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT 'Letztes Verifikations-Datum',
  
  -- Flags
  is_repeatable BOOLEAN DEFAULT FALSE COMMENT 'Quest wiederholbar?',
  is_daily BOOLEAN DEFAULT FALSE COMMENT 'Daily Quest?',
  is_weekly BOOLEAN DEFAULT FALSE COMMENT 'Weekly Quest?',
  has_spoilers BOOLEAN DEFAULT FALSE COMMENT 'Enthält Story-Spoiler?',
  is_beta_content BOOLEAN DEFAULT FALSE COMMENT 'Stammt aus Beta?',
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  -- Indizes für schnelle Suche
  INDEX idx_quest_type (quest_type),
  INDEX idx_faction (faction),
  INDEX idx_quest_giver (quest_giver_npc),
  INDEX idx_location (quest_location),
  INDEX idx_region (quest_region),
  INDEX idx_category (quest_category),
  INDEX idx_chain (quest_chain_id, quest_chain_position),
  INDEX idx_slug (quest_slug),
  
  -- Foreign Keys (werden nach Erstellung aller Tabellen hinzugefügt)
  CONSTRAINT fk_previous_quest FOREIGN KEY (previous_quest_id) REFERENCES dune_quests(id) ON DELETE SET NULL,
  CONSTRAINT fk_next_quest FOREIGN KEY (next_quest_id) REFERENCES dune_quests(id) ON DELETE SET NULL
  
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Dune: Awakening Quest-Datenbank';
