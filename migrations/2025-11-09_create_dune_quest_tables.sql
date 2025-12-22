-- =====================================================
-- Dune: Awakening Quest Database Schema
-- Erstellt: 9. November 2025
-- Zweck: Quest-System für Bot & Dashboard
-- =====================================================

-- =====================================================
-- Tabelle: dune_quests
-- Haupt-Tabelle für alle Quests
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
  quest_giver_npc VARCHAR(100) DEFAULT NULL COMMENT 'NPC der die Quest vergibt',
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


-- =====================================================
-- Tabelle: dune_quest_chains
-- Quest-Ketten (z.B. Counter-Insurgency 5-Quest-Chain)
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


-- =====================================================
-- Tabelle: dune_npcs
-- NPC-Datenbank mit präzisen Locations
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


-- =====================================================
-- Tabelle: dune_quest_tags
-- Flexible Tags für Quests (sandfly, stealth, spice, etc.)
-- =====================================================

CREATE TABLE IF NOT EXISTS dune_quest_tags (
  id INT AUTO_INCREMENT PRIMARY KEY,
  quest_id INT NOT NULL COMMENT 'Quest-ID (FK)',
  tag VARCHAR(50) NOT NULL COMMENT 'Tag-Name (sandfly, sardaukar, spice, stealth, combat, etc.)',
  
  FOREIGN KEY (quest_id) REFERENCES dune_quests(id) ON DELETE CASCADE,
  UNIQUE KEY unique_quest_tag (quest_id, tag),
  INDEX idx_tag (tag)
  
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Quest-Tags';


-- =====================================================
-- Foreign Key für quest_chain_id (nach Chain-Tabelle)
-- =====================================================

ALTER TABLE dune_quests 
ADD CONSTRAINT fk_quest_chain 
FOREIGN KEY (quest_chain_id) REFERENCES dune_quest_chains(id) ON DELETE SET NULL;


-- =====================================================
-- TEST-DATEN: Counter-Insurgency Quest-Kette
-- =====================================================

-- Quest-Kette anlegen
INSERT INTO dune_quest_chains (
  chain_name_en, 
  chain_name_de, 
  chain_slug, 
  description_en,
  description_de,
  quest_type, 
  faction, 
  total_quests, 
  total_xp, 
  total_solari,
  final_rewards
) VALUES (
  'Counter-Insurgency',
  'Gegenaufstand',
  'counter-insurgency',
  'Imperial Sardaukar mission to eliminate the Sandfly rebel movement',
  'Imperiale Sardaukar-Mission zur Eliminierung der Sandfly-Rebellen-Bewegung',
  'journey',
  'imperial',
  5,
  2100,
  43000,
  JSON_ARRAY(
    JSON_OBJECT('item', 'Sentinel Jacket', 'unique', true),
    JSON_OBJECT('item', 'Sandfly Heavy Armor Set Variant', 'unique', false),
    JSON_OBJECT('item', 'Native Stillsuit Set Variant', 'unique', false)
  )
);

-- NPC anlegen
INSERT INTO dune_npcs (
  npc_name,
  npc_slug,
  npc_type,
  faction,
  primary_location,
  primary_region,
  location_detail_en,
  location_detail_de,
  description_en,
  description_de,
  is_killable,
  is_trainer
) VALUES (
  'Sub-Prefect Ramash',
  'sub-prefect-ramash',
  'quest_giver',
  'imperial',
  'Eastern Shield Wall',
  'Eastern Shield Wall',
  'Near the Stone Sentinel observation post',
  'Nahe dem Stone Sentinel Beobachtungsposten',
  'Imperial Sardaukar officer commanding operations against the Sandfly rebel movement',
  'Imperialer Sardaukar-Offizier der Operationen gegen die Sandfly-Rebellen-Bewegung kommandiert',
  FALSE,
  FALSE
);

-- Quest 1: Scouting the Enemy
INSERT INTO dune_quests (
  quest_slug,
  quest_name_en,
  quest_name_de,
  quest_type,
  quest_category,
  faction,
  quest_giver_npc,
  quest_giver_location,
  quest_giver_region,
  quest_location,
  quest_region,
  description_en,
  description_de,
  objectives_en,
  objectives_de,
  quest_mechanic,
  difficulty,
  reward_xp,
  reward_solari,
  quest_chain_id,
  quest_chain_position,
  source_primary,
  source_confidence,
  has_spoilers
) VALUES (
  'counter-insurgency-1',
  'Counter-Insurgency: Scouting the Enemy',
  'Gegenaufstand: Feind auskundschaften',
  'journey',
  'Counter-Insurgency',
  'imperial',
  'Sub-Prefect Ramash',
  'Eastern Shield Wall',
  'Eastern Shield Wall',
  'Stone Sentinel',
  'Eastern Shield Wall',
  'Sardaukar aerial observers have detected significant activity at an abandoned spicing station beneath the Stone Sentinel. Your task is to infiltrate and observe the Sandfly rebels from a safe distance.',
  'Sardaukar-Luftbeobachter haben signifikante Aktivitäten bei einer verlassenen Gewürzstation unter dem Stone Sentinel entdeckt. Deine Aufgabe ist es, die Sandfly-Rebellen aus sicherer Entfernung zu infiltrieren und zu beobachten.',
  JSON_ARRAY(
    'Approach the Stone Sentinel',
    'Contact Issuer'
  ),
  JSON_ARRAY(
    'Nähere dich dem Stone Sentinel',
    'Kontaktiere den Auftraggeber'
  ),
  'stealth',
  'medium',
  350,
  8500,
  1, -- Counter-Insurgency Chain
  1,
  'awakening.wiki',
  0.98,
  FALSE
);

-- Quest 2: Engage the Enemy
INSERT INTO dune_quests (
  quest_slug,
  quest_name_en,
  quest_name_de,
  quest_type,
  quest_category,
  faction,
  quest_giver_npc,
  quest_giver_location,
  quest_giver_region,
  quest_location,
  quest_region,
  description_en,
  description_de,
  objectives_en,
  objectives_de,
  quest_mechanic,
  difficulty,
  reward_xp,
  reward_solari,
  quest_chain_id,
  quest_chain_position,
  previous_quest_id,
  source_primary,
  source_confidence,
  has_spoilers
) VALUES (
  'counter-insurgency-2',
  'Counter-Insurgency: Engage the Enemy',
  'Gegenaufstand: Feind bekämpfen',
  'journey',
  'Counter-Insurgency',
  'imperial',
  'Sub-Prefect Ramash',
  'Eastern Shield Wall',
  'Eastern Shield Wall',
  'Stone Sentinel Area',
  'Eastern Shield Wall',
  'Test the combat capabilities of the Sandfly rebels. Engage them with lethal force and assess their resistance.',
  'Teste die Kampffähigkeiten der Sandfly-Rebellen. Bekämpfe sie mit tödlicher Gewalt und beurteile ihren Widerstand.',
  JSON_ARRAY(
    'Eliminate Sandflies',
    'Contact Issuer'
  ),
  JSON_ARRAY(
    'Eliminiere Sandflies',
    'Kontaktiere den Auftraggeber'
  ),
  'combat',
  'medium',
  350,
  5500,
  1,
  2,
  1, -- Vorgänger: Quest 1
  'awakening.wiki',
  0.98,
  FALSE
);

-- Quest 3: Gather Intelligence
INSERT INTO dune_quests (
  quest_slug,
  quest_name_en,
  quest_name_de,
  quest_type,
  quest_category,
  faction,
  quest_giver_npc,
  quest_giver_location,
  quest_giver_region,
  quest_location,
  quest_region,
  description_en,
  description_de,
  objectives_en,
  objectives_de,
  quest_mechanic,
  difficulty,
  reward_xp,
  reward_solari,
  quest_chain_id,
  quest_chain_position,
  previous_quest_id,
  source_primary,
  source_confidence,
  has_spoilers
) VALUES (
  'counter-insurgency-3',
  'Counter-Insurgency: Gather Intelligence',
  'Gegenaufstand: Informationen sammeln',
  'journey',
  'Counter-Insurgency',
  'imperial',
  'Sub-Prefect Ramash',
  'Eastern Shield Wall',
  'Eastern Shield Wall',
  'Southern Comms Station',
  'Eastern Shield Wall',
  'Infiltrate the Sandfly base and search for intelligence documents. Find "The Guerilla in the Desert" and "The Red Scorpion" documents.',
  'Infiltriere die Sandfly-Basis und suche nach Geheimdienstdokumenten. Finde die Dokumente "Der Guerillakämpfer in der Wüste" und "Der Rote Skorpion".',
  JSON_ARRAY(
    'Investigate first location',
    'Search the Southern Comms Station',
    'Deliver "The Guerilla in the Desert"',
    'Deliver "The Red Scorpion"',
    'Contact Issuer'
  ),
  JSON_ARRAY(
    'Untersuche die erste Location',
    'Durchsuche die Southern Comms Station',
    'Liefere "Der Guerillakämpfer in der Wüste"',
    'Liefere "Der Rote Skorpion"',
    'Kontaktiere den Auftraggeber'
  ),
  'fetch',
  'medium',
  350,
  8500,
  1,
  3,
  2,
  'awakening.wiki',
  0.98,
  FALSE
);

-- Quest 4: Breaking Training
INSERT INTO dune_quests (
  quest_slug,
  quest_name_en,
  quest_name_de,
  quest_type,
  quest_category,
  faction,
  quest_giver_npc,
  quest_giver_location,
  quest_giver_region,
  quest_location,
  quest_region,
  description_en,
  description_de,
  objectives_en,
  objectives_de,
  quest_mechanic,
  difficulty,
  reward_xp,
  reward_solari,
  reward_items,
  quest_chain_id,
  quest_chain_position,
  previous_quest_id,
  source_primary,
  source_confidence,
  has_spoilers
) VALUES (
  'counter-insurgency-4',
  'Counter-Insurgency: Breaking Training',
  'Gegenaufstand: Training unterbrechen',
  'journey',
  'Counter-Insurgency',
  'imperial',
  'Sub-Prefect Ramash',
  'Eastern Shield Wall',
  'Eastern Shield Wall',
  'Imperial Testing Station No. 17',
  'Eastern Shield Wall',
  'The Sandflies are training to become a formidable force. Disrupt their training camp inside Imperial Testing Station No. 17 before they become organized.',
  'Die Sandflies trainieren um eine gefährliche Streitmacht zu werden. Störe ihr Trainingscamp in der Imperial Testing Station No. 17 bevor sie organisiert werden.',
  JSON_ARRAY(
    'Enter Imperial Testing Station No. 17',
    'Locate the training camp inside the testing station',
    'Eliminate Sandflies',
    'Contact Issuer'
  ),
  JSON_ARRAY(
    'Betrete Imperial Testing Station No. 17',
    'Lokalisiere das Trainingscamp in der Station',
    'Eliminiere Sandflies',
    'Kontaktiere den Auftraggeber'
  ),
  'combat',
  'hard',
  350,
  8500,
  JSON_ARRAY(
    JSON_OBJECT('item', 'Sandfly Heavy Armor Set Variant', 'unique', false)
  ),
  1,
  4,
  3,
  'awakening.wiki',
  0.98,
  FALSE
);

-- Quest 5: Target the Top (FINALE)
INSERT INTO dune_quests (
  quest_slug,
  quest_name_en,
  quest_name_de,
  quest_type,
  quest_category,
  faction,
  quest_giver_npc,
  quest_giver_location,
  quest_giver_region,
  quest_location,
  quest_region,
  description_en,
  description_de,
  objectives_en,
  objectives_de,
  quest_mechanic,
  difficulty,
  reward_xp,
  reward_solari,
  reward_items,
  quest_chain_id,
  quest_chain_position,
  previous_quest_id,
  source_primary,
  source_confidence,
  has_spoilers
) VALUES (
  'counter-insurgency-5',
  'Counter-Insurgency: Target the Top',
  'Gegenaufstand: Anführer eliminieren',
  'journey',
  'Counter-Insurgency',
  'imperial',
  'Sub-Prefect Ramash',
  'Eastern Shield Wall',
  'Eastern Shield Wall',
  'Imperial Testing Station No. 142',
  'Eastern Shield Wall',
  'Find and eliminate the Red Scorpion, the leader pulling the strings of the Sandfly movement. Intelligence suggests he is located at Imperial Testing Station No. 142 on the Shield Wall.',
  'Finde und eliminiere den Roten Skorpion, den Anführer der Sandfly-Bewegung. Geheimdienste vermuten dass er sich in Imperial Testing Station No. 142 am Shield Wall befindet.',
  JSON_ARRAY(
    'Enter Imperial Testing Station No. 142',
    'Kill the Red Scorpion',
    'Contact Issuer'
  ),
  JSON_ARRAY(
    'Betrete Imperial Testing Station No. 142',
    'Töte den Roten Skorpion',
    'Kontaktiere den Auftraggeber'
  ),
  'combat',
  'very_hard',
  700,
  11500,
  JSON_ARRAY(
    JSON_OBJECT('item', 'Sentinel Jacket', 'unique', true),
    JSON_OBJECT('item', 'Native Stillsuit Set Variant', 'unique', false)
  ),
  1,
  5,
  4,
  'awakening.wiki',
  0.98,
  TRUE
);

-- Update previous/next quest references
UPDATE dune_quests SET next_quest_id = 2 WHERE id = 1;
UPDATE dune_quests SET next_quest_id = 3 WHERE id = 2;
UPDATE dune_quests SET next_quest_id = 4 WHERE id = 3;
UPDATE dune_quests SET next_quest_id = 5 WHERE id = 4;

-- Tags hinzufügen
INSERT INTO dune_quest_tags (quest_id, tag) VALUES
(1, 'sandfly'),
(1, 'stealth'),
(1, 'sardaukar'),
(2, 'sandfly'),
(2, 'combat'),
(2, 'sardaukar'),
(3, 'sandfly'),
(3, 'intelligence'),
(3, 'fetch'),
(4, 'sandfly'),
(4, 'combat'),
(4, 'training'),
(5, 'sandfly'),
(5, 'boss'),
(5, 'red-scorpion'),
(5, 'finale');


-- =====================================================
-- DONE! ✅
-- =====================================================
-- 
-- Was wurde erstellt:
-- ✅ dune_quests (Haupt-Tabelle)
-- ✅ dune_quest_chains (Quest-Ketten)
-- ✅ dune_npcs (NPC-Datenbank)
-- ✅ dune_quest_tags (Flexible Tags)
-- ✅ Test-Daten: Counter-Insurgency 5-Quest-Chain
-- ✅ Test-NPC: Sub-Prefect Ramash
-- ✅ Tags für alle Test-Quests
--
-- Test-Queries:
-- SELECT * FROM dune_quests;
-- SELECT * FROM dune_quest_chains;
-- SELECT * FROM dune_npcs;
-- SELECT * FROM dune_quest_tags;
--
-- SELECT * FROM dune_quests WHERE faction = 'imperial';
-- SELECT * FROM dune_quests WHERE quest_chain_id = 1 ORDER BY quest_chain_position;
-- SELECT q.*, GROUP_CONCAT(t.tag) as tags FROM dune_quests q LEFT JOIN dune_quest_tags t ON q.id = t.quest_id WHERE q.quest_slug = 'counter-insurgency-5' GROUP BY q.id;
--
-- =====================================================
