# DuneMap Plugin - SQL Schema Übersicht

Dieses Verzeichnis enthält alle SQL-Tabellendefinitionen für das DuneMap-Plugin.

## Tabellen-Übersicht

### 1. Map-System (DuneMap Core)

#### `dunemap_markers.sql`

- **Zweck:** Sektor-Marker für die Dune Map (A1-I9 Grid)
- **Features:**
  - Marker-Typen: Ressourcen (Titan, Spice, etc.), Strukturen, POIs
  - Max. 6 Marker pro Sektor (via Trigger)
  - Guild-spezifisch
  - Permanente Marker (z.B. Taxi-Standorte)

#### `dunemap_storm_timer.sql`

- **Zweck:** Coriolis Storm Timer pro Guild
- **Features:**
  - Speichert Storm Start-Zeit & Dauer
  - Unix Timestamp für präzise Berechnungen

### 2. Quest-System (Dune: Awakening Quests)

#### `dune_quests.sql`

- **Zweck:** Haupt-Tabelle für alle Quests
- **Features:**
  - Bilingual (EN/DE)
  - Quest-Typen: main_story, journey, trial, faction, etc.
  - Factions: Atreides, Harkonnen, Imperial, Fremen, etc.
  - Rewards: XP, Solari, Items (JSON), Skills (JSON)
  - Quest-Chains: previous_quest_id, next_quest_id, chain_position
  - Map-Koordinaten für Integration
  - Source-Tracking (awakening.wiki, duneawakeningwiki.de, ign.com)

#### `dune_quest_chains.sql`

- **Zweck:** Quest-Ketten (z.B. Counter-Insurgency 5-Quest-Chain)
- **Features:**
  - Gesamt-XP & Solari der Chain
  - Final Rewards (JSON)
  - Bilingual

#### `dune_npcs.sql`

- **Zweck:** NPC-Datenbank mit präzisen Locations
- **Features:**
  - NPC-Typen: quest_giver, class_trainer, trader, boss, etc.
  - Präzise Location-Details (z.B. "hinten in der Bar")
  - Map-Koordinaten
  - Trainer-Info (Klasse, Tier)
  - Bilingual

#### `dune_quest_tags.sql`

- **Zweck:** Flexible Tags für Quests
- **Features:**
  - Tag-Kategorien (enemy, gameplay, location, faction)
  - Beispiel-Tags: sandfly, stealth, combat, boss, sardaukar

## Installations-Reihenfolge

**WICHTIG:** Tabellen müssen in dieser Reihenfolge erstellt werden (wegen Foreign Keys):

1. `dunemap_markers.sql`
2. `dunemap_storm_timer.sql`
3. `dune_quest_chains.sql`
4. `dune_npcs.sql`
5. `dune_quests.sql` (FK zu chains + npcs)
6. `dune_quest_tags.sql` (FK zu quests)

## Installation

### Einzelne Tabelle:

```bash
mysql -u root -p dunebot_dev < plugins/dunemap/dashboard/sql/dune_quests.sql
```

### Alle Tabellen (in korrekter Reihenfolge):

```bash
cd plugins/dunemap/dashboard/sql
mysql -u root -p dunebot_dev < dunemap_markers.sql
mysql -u root -p dunebot_dev < dunemap_storm_timer.sql
mysql -u root -p dunebot_dev < dune_quest_chains.sql
mysql -u root -p dunebot_dev < dune_npcs.sql
mysql -u root -p dunebot_dev < dune_quests.sql
mysql -u root -p dunebot_dev < dune_quest_tags.sql
```

### Via Migration (empfohlen):

```bash
# Vollständige Migration mit Test-Daten
mysql -u root -p dunebot_dev < ../../../../migrations/2025-11-09_create_dune_quest_tables.sql
```

## Foreign Keys

### `dune_quests`

- `quest_chain_id` → `dune_quest_chains.id`
- `previous_quest_id` → `dune_quests.id` (self-referential)
- `next_quest_id` → `dune_quests.id` (self-referential)
- `quest_giver_npc` → `dune_npcs.npc_slug` (VARCHAR JOIN)

### `dune_quest_tags`

- `quest_id` → `dune_quests.id` (CASCADE DELETE)

## Indizes

Alle Tabellen haben optimierte Indizes für:

- Guild-basierte Queries (`guild_id`)
- Suche nach Quest-Typ, Faction, Location
- NPC-Lookups (via slug)
- Quest-Chain-Navigation

## Test-Daten

Die Migration `2025-11-09_create_dune_quest_tables.sql` enthält Test-Daten:

- **Counter-Insurgency Quest-Chain** (5 Quests)
- **Sub-Prefect Ramash NPC** (Imperial Sardaukar)
- **14 Quest-Tags** (sandfly, stealth, combat, boss, etc.)

## Hinweise

- **Triggers:** `dunemap_markers` hat einen Trigger für Max. 6 Marker/Sektor
- **JSON-Felder:** `reward_items`, `reward_skills`, `objectives_en/de`, `final_rewards`
- **Bilingual:** Alle Quest-Daten unterstützen EN + DE
- **Source-Tracking:** Quests haben `source_primary` + `source_confidence` für Data-Quality

## Zugehörige Dateien

- **Models:** `plugins/dunemap/dashboard/models/*.js`
- **Routes:** `plugins/dunemap/dashboard/routes/quests.js`
- **Migration:** `migrations/2025-11-09_create_dune_quest_tables.sql`
- **Docs:** `docs/dune_awakening_quest_database_schema.md`
