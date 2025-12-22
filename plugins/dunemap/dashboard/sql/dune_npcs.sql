-- =====================================================
-- Tabelle: dune_npcs
-- NPC-Datenbank mit präzisen Locations
-- Erstellt: 9. November 2025
-- =====================================================

CREATE TABLE IF NOT EXISTS dune_npcs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  
  npc_name VARCHAR(100) UNIQUE NOT NULL COMMENT 'NPC-Name',
  npc_slug VARCHAR(100) UNIQUE NOT NULL COMMENT 'URL-freundlicher Identifier',
  
  npc_type ENUM(
    'quest_giver',
    'class_trainer',
    'trader',
    'service_worker',
    'lore_character',
    'boss',
    'companion'
  ) NOT NULL DEFAULT 'quest_giver' COMMENT 'NPC-Typ',
  
  faction ENUM('neutral', 'atreides', 'harkonnen', 'imperial', 'fremen', 'guild', 'bene_gesserit') DEFAULT 'neutral',
  
  -- Haupt-Location
  primary_location VARCHAR(255) DEFAULT NULL COMMENT 'Haupt-Location des NPCs',
  primary_region VARCHAR(100) DEFAULT NULL COMMENT 'Haupt-Region',
  
  -- Koordinaten
  map_x DECIMAL(10,6) DEFAULT NULL COMMENT 'X-Koordinate',
  map_y DECIMAL(10,6) DEFAULT NULL COMMENT 'Y-Koordinate',
  
  -- Präzise Location (aus deutschem Wiki!)
  location_detail_en VARCHAR(255) DEFAULT NULL COMMENT 'Präzise Location-Beschreibung (Englisch)',
  location_detail_de VARCHAR(255) DEFAULT NULL COMMENT 'Präzise Location-Beschreibung (Deutsch, z.B. "hinten in der Bar")',
  
  -- Zusätzliche Locations (manche NPCs bewegen sich!)
  additional_locations JSON DEFAULT NULL COMMENT 'Weitere Locations als Array von Objekten',
  
  description_en TEXT DEFAULT NULL COMMENT 'NPC-Beschreibung (Englisch)',
  description_de TEXT DEFAULT NULL COMMENT 'NPC-Beschreibung (Deutsch)',
  
  -- Bilder
  portrait_url VARCHAR(255) DEFAULT NULL COMMENT 'Portrait-Bild URL',
  
  -- Meta
  is_killable BOOLEAN DEFAULT TRUE COMMENT 'Kann getötet werden?',
  is_trainer BOOLEAN DEFAULT FALSE COMMENT 'Ist Klassenlehrer?',
  trainer_class VARCHAR(50) DEFAULT NULL COMMENT 'Klasse die trainiert wird (Planetologist, Trooper, etc.)',
  trainer_tier ENUM('basic', 'advanced') DEFAULT NULL COMMENT 'Trainer-Stufe',
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  INDEX idx_npc_type (npc_type),
  INDEX idx_npc_faction (faction),
  INDEX idx_trainer (is_trainer, trainer_class),
  INDEX idx_npc_slug (npc_slug)
  
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='NPC-Datenbank';
