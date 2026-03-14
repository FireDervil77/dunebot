# Gameserver Plugin - Database Schema Overview

> Erstellt: 19. Oktober 2025  
> Aktualisiert: 7. November 2025  
> Plugin: gameserver  
> Abhängigkeiten: masterserver (daemon_servers)

---

## 🚀 Quick Start - Alle Tabellen erstellen

**Option 1: Master-Script (EMPFOHLEN)**

```bash
cd /home/firedervil/dunebot_dev/plugins/gameserver/dashboard/sql
mysql -u firedervil -p'D3l$br@ck$' -D dunebot_dev < 00_create_all_tables.sql
```

**Option 2: Einzeln ausführen**

```bash
cd /home/firedervil/dunebot_dev/plugins/gameserver/dashboard/sql
mysql -u firedervil -p'D3l$br@ck$' -D dunebot_dev < 01_addon_marketplace.sql
mysql -u firedervil -p'D3l$br@ck$' -D dunebot_dev < 02_addon_ratings.sql
mysql -u firedervil -p'D3l$br@ck$' -D dunebot_dev < 03_addon_comments.sql
mysql -u firedervil -p'D3l$br@ck$' -D dunebot_dev < 04_addon_favorites.sql
mysql -u firedervil -p'D3l$br@ck$' -D dunebot_dev < 05_addon_versions.sql
mysql -u firedervil -p'D3l$br@ck$' -D dunebot_dev < 06_gameservers.sql
mysql -u firedervil -p'D3l$br@ck$' -D dunebot_dev < 07_addon_image_builds.sql
```

**Option 3: Official Addons seeden**

```bash
cd /home/firedervil/dunebot_dev/plugins/gameserver/dashboard
mysql -u firedervil -p'D3l$br@ck$' -D dunebot_dev < seed_official_addons.sql
```

➡️ Fügt 5 Eggs ein: CS2, Valheim, ARK, Rust, 7 Days to Die

---

## 📊 Tabellen-Übersicht

### **1. addon_marketplace** - Addon-Katalog (wie Pterodactyl Eggs)

Speichert alle verfügbaren Game-Addons (Steam-Games, Custom-Games, Community-Addons)

**Wichtige Spalten:**

- `slug` - URL-freundlicher Identifier (z.B. "cs2", "valheim")
- `game_data` - JSON mit kompletter Egg-Struktur (variables, startup, config, installation)
- `visibility` - official/public/unlisted/private
- `trust_level` - unverified/verified/trusted/official
- `steam_app_id` / `steam_server_app_id` - Steam-Integration
- `image_url` / `image_hash` - Custom-Image-Support (Non-Steam-Games)

**Beziehungen:**

- → `gameservers` (1:n)
- → `addon_ratings` (1:n)
- → `addon_comments` (1:n)
- → `addon_favorites` (1:n)
- → `addon_versions` (1:n)

---

### **2. gameservers** - Erstellte Gameserver-Instanzen

Speichert alle erstellten Gameserver (CS2, ARK, Rust, etc.)

**Wichtige Spalten:**

- `daemon_server_id` - FK zu `masterserver.daemon_servers.server_id` (WICHTIG!)
- `addon_marketplace_id` - Welches Addon wurde genutzt?
- `template_name` - Welches Template? (z.B. "competitive", "casual")
- `frozen_game_data` - Snapshot der game_data bei Erstellung (Reproduzierbarkeit!)
- `env_variables` - Runtime-Config (aus game_data.variables + User-Input)
- `addon_version` - Version bei Erstellung (für Update-Checks)
- `status` - installing/installed/starting/online/stopping/offline/error/updating

**Beziehungen:**

- → `guilds` (n:1)
- → `addon_marketplace` (n:1)
- → `masterserver.daemon_servers` (n:1) - **Referenz zum virtuellen Server!**

**Flow:**

1. User wählt Addon (z.B. CS2)
2. User wählt daemon_server (z.B. "rootserver0001")
3. System erstellt Gameserver-Instanz
4. Daemon installiert Game auf diesem virtuellen Server
5. Status-Updates: installing → installed → online

---

### **3. addon_ratings** - Bewertungen

User können Addons bewerten (1-5 Sterne)

**Anti-Spam:**

- `usage_hours` - User muss Addon ≥1h genutzt haben
- `UNIQUE(addon_id, user_id)` - Nur 1 Bewertung pro User

---

### **4. addon_comments** - Kommentare

Kommentar-System mit Reply-Support

**Features:**

- `parent_id` - Für Replies/Threads
- Soft-Delete (`is_deleted`) für Moderation

---

### **5. addon_favorites** - Favoriten

User können Addons favorisieren (Bookmark-System)

---

### **6. addon_versions** - Version-History

Speichert alle Versionen eines Addons

**Features:**

- `is_latest` - Markiert aktuelle Version
- `game_data` - Snapshot für diese Version
- Update-Check: Vergleich mit `gameservers.addon_version`

---

### **7. addon_image_builds** - Image-Builder-Sessions (Phase 3)

Für Non-Steam-Games (Minecraft, FiveM, etc.)

**Nur für Superadmins!**

---

## 🔗 Beziehungen zu anderen Plugins

### **Masterserver-Plugin:**

```
masterserver.daemon_servers (virtuelle Server)
    ↓ (1:n)
gameserver.gameservers (Gameserver-Instanzen)
```

**Wichtig:**

- Ein `daemon_server` kann VIELE `gameservers` hosten
- Ressourcen-Limits werden in `daemon_servers` definiert
- Gameserver-Plugin prüft vor Erstellung: "Hat daemon_server genug RAM/CPU/Disk?"

---

## 📋 Installations-Reihenfolge

Beim Plugin-Enable werden Tabellen in dieser Reihenfolge erstellt:

1. `addon_marketplace` (Basis)
2. `addon_ratings`
3. `addon_comments`
4. `addon_favorites`
5. `addon_versions`
6. `gameservers` (benötigt addon_marketplace + masterserver.daemon_servers)
7. `addon_image_builds` (optional, Phase 3)

---

## 🎯 Typischer Workflow

### **Addon erstellen (Community-User):**

```sql
INSERT INTO addon_marketplace
(name, slug, game_data, author_user_id, visibility, status, trust_level)
VALUES
('My ARK Mod', 'my-ark-mod', '{"..."}', '123456', 'public', 'pending_review', 'unverified');
```

### **Gameserver erstellen:**

```sql
-- 1. Prüfe Ressourcen von daemon_server (rootserver0001)
SELECT ram_limit_gb, ram_usage_gb, disk_limit_gb, disk_usage_gb
FROM daemon_servers WHERE server_id = 'abc-123-def';

-- 2. Erstelle Gameserver
INSERT INTO gameservers
(guild_id, user_id, addon_marketplace_id, daemon_server_id, name, env_variables, frozen_game_data, addon_version)
VALUES
('guild123', 'user456', 1, 'abc-123-def', 'My CS2 Server', '{"SERVER_NAME": "..."}', '{"..."}', '1.0.0');
```

### **Update-Check (Cronjob):**

```sql
-- Finde Server mit veralteten Addons
SELECT gs.id, gs.name, gs.addon_version, am.version AS latest_version
FROM gameservers gs
JOIN addon_marketplace am ON gs.addon_marketplace_id = am.id
WHERE gs.addon_version != am.version;

-- Markiere als update_available
UPDATE gameservers SET update_available = TRUE WHERE id = 123;
```

---

## 🚀 Erweiterungen (später)

### **Backup-System:**

```sql
CREATE TABLE gameserver_backups (
    id INT AUTO_INCREMENT PRIMARY KEY,
    gameserver_id INT UNSIGNED NOT NULL,
    backup_path VARCHAR(500),
    size_mb INT,
    created_at TIMESTAMP,
    FOREIGN KEY (gameserver_id) REFERENCES gameservers(id) ON DELETE CASCADE
);
```

### **Mod-System:**

```sql
CREATE TABLE gameserver_mods (
    id INT AUTO_INCREMENT PRIMARY KEY,
    gameserver_id INT UNSIGNED NOT NULL,
    mod_name VARCHAR(100),
    workshop_id BIGINT,
    enabled BOOLEAN DEFAULT TRUE,
    FOREIGN KEY (gameserver_id) REFERENCES gameservers(id) ON DELETE CASCADE
);
```

---

## 🔍 Wichtige Queries

### **Addon-Marketplace durchsuchen:**

```sql
SELECT * FROM addon_marketplace
WHERE visibility = 'public'
  AND status = 'approved'
  AND category = 'fps'
ORDER BY rating_avg DESC, install_count DESC;
```

### **Gameserver eines Users:**

```sql
SELECT gs.*, am.name AS addon_name, ds.server_name
FROM gameservers gs
JOIN addon_marketplace am ON gs.addon_marketplace_id = am.id
JOIN daemon_servers ds ON gs.daemon_server_id = ds.server_id
WHERE gs.guild_id = 'guild123' AND gs.status = 'online';
```

### **Ressourcen-Auslastung eines daemon_servers:**

```sql
SELECT
    ds.server_name,
    ds.ram_total_gb,
    ds.ram_usage_gb,
    ds.ram_limit_gb,
    COUNT(gs.id) AS gameserver_count,
    SUM(JSON_EXTRACT(gs.env_variables, '$.RAM')) / 1024 AS allocated_ram_gb
FROM daemon_servers ds
LEFT JOIN gameservers gs ON ds.server_id = gs.daemon_server_id
WHERE ds.server_id = 'abc-123'
GROUP BY ds.server_id;
```

---

## 📝 JSON-Struktur Beispiele

### **addon_marketplace.game_data:**

```json
{
  "meta": { "version": "PTDL_v2" },
  "name": "Counter-Strike 2",
  "installation": {
    "method": "steamcmd",
    "app_id": "730"
  },
  "startup": "./cs2 -game csgo +map {{MAP}} +maxplayers {{MAX_PLAYERS}}",
  "config": {
    "files": {
      "csgo/cfg/server.cfg": {
        "find": {
          "hostname": "{{SERVER_NAME}}",
          "rcon_password": "{{RCON_PASSWORD}}"
        }
      }
    }
  },
  "variables": [
    {
      "name": "Server Name",
      "env_variable": "SERVER_NAME",
      "default_value": "My CS2 Server",
      "user_editable": true,
      "field_type": "text"
    }
  ],
  "templates": [
    {
      "name": "competitive",
      "label": "Competitive 5v5",
      "variables": { "MAX_PLAYERS": "10", "MAP": "de_dust2" }
    }
  ]
}
```

### **gameservers.env_variables:**

```json
{
  "SERVER_NAME": "My Awesome CS2 Server",
  "MAX_PLAYERS": "10",
  "MAP": "de_dust2",
  "RCON_PASSWORD": "Xy8#kL2p9!mQ",
  "RAM": "4096"
}
```

### **gameservers.ports:**

```json
{
  "game": 27015,
  "query": 27016,
  "rcon": 27017
}
```

---

**Stand:** 19. Oktober 2025  
**Status:** ✅ Schemas erstellt, bereit für Implementation
