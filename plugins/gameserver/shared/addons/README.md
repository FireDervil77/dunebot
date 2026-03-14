# Official Game Addons

Dieses Verzeichnis enthält die offiziellen Game-Addons (Game Configs) im Pterodactyl PTDL_v2-Format.

## Verfügbare Addons

| Addon | Kategorie | Komplexität | Templates | Variablen | RAM Min | Disk Min |
|-------|-----------|-------------|-----------|-----------|---------|----------|
| **cs2.json** | FPS | Mittel | 4 | 8 | 2 GB | 35 GB |
| **valheim.json** | Survival | Einfach | 2 | 6 | 2 GB | 5 GB |
| **ark.json** | Survival | Komplex | 3 | 15 | 6 GB | 30 GB |
| **rust.json** | Survival | Komplex | 3 | 15 | 8 GB | 20 GB |
| **7days.json** | Survival | Komplex | 3 | 19 | 4 GB | 15 GB |

---

## Addon-Struktur (game_data JSON)

### 1. Meta-Informationen
```json
{
  "meta": {
    "version": "PTDL_v2",
    "author": "DuneBot Official",
    "update_url": null
  }
}
```

### 2. Steam-Integration
```json
{
  "steam": {
    "app_id": 730,           // Client-App-ID (für Spieler)
    "server_app_id": 730,    // Server-App-ID (für SteamCMD)
    "install_dir": "csgo"    // Installationsverzeichnis
  }
}
```

### 3. Installation
```json
{
  "installation": {
    "method": "steamcmd",    // steamcmd | git_clone | download_extract | custom_image
    "app_id": "730",
    "validate": true,
    "script": "#!/bin/bash\n..."  // Bash-Script für Installation
  }
}
```

**Verfügbare Methoden:**
- `steamcmd`: Steam-Games (automatisch via SteamCMD)
- `git_clone`: GitHub-Repos (whitelistete Domains)
- `download_extract`: Direkte Downloads (SHA256-Verification)
- `custom_image`: Phase 3 (Non-Steam Games, Superadmin-only)

### 4. Startup
```json
{
  "startup": {
    "command": "./cs2 -game csgo +map {{MAP}} +maxplayers {{MAX_PLAYERS}}",
    "done": "Server is listening",  // String der signalisiert: Server ready
    "stop": "quit"                   // Command zum Stoppen
  }
}
```

**Platzhalter:**
- `{{VARIABLE_NAME}}` wird durch Wert aus `variables[]` oder `env_variables` JSON ersetzt
- Beispiel: `{{SERVER_PORT}}` → `27015`

### 5. Config-Dateien
```json
{
  "config": {
    "files": {
      "csgo/cfg/server.cfg": {
        "parser": "file",           // file | ini | xml | json
        "find": {
          "hostname": "hostname \"{{SERVER_NAME}}\"",
          "sv_password": "sv_password \"{{SERVER_PASSWORD}}\""
        }
      }
    }
  }
}
```

**Parser-Typen:**
- `file`: Einfache Find/Replace (Source-Engine CFG, Config-Dateien)
- `ini`: INI-Format mit Sections (ARK: GameUserSettings.ini)
- `xml`: XML-Parser (7 Days to Die: serverconfig.xml)
- `json`: JSON-Config-Dateien

### 6. Variables (User-Inputs)
```json
{
  "variables": [
    {
      "name": "Server Name",
      "description": "Der Name deines Servers",
      "env_variable": "SERVER_NAME",
      "default_value": "My Server",
      "user_viewable": true,
      "user_editable": true,
      "rules": "required|string|max:100",
      "field_type": "text"
    }
  ]
}
```

**Field Types:**
- `text`: Normales Textfeld
- `password`: Passwort-Feld (masked)
- `textarea`: Mehrzeilig (für Descriptions)
- `number`: Numerischer Input mit Min/Max
- `boolean`: Checkbox (true/false, 1/0)
- `select`: Dropdown mit `select_options`

**Validation Rules:**
- `required` - Pflichtfeld
- `nullable` - Optional
- `string` - String-Typ
- `integer` / `numeric` - Zahlen
- `min:X` / `max:X` - Länge/Wert-Limits
- `in:val1,val2` - Erlaubte Werte (Enum)
- `url` - URL-Validierung
- `alpha_dash` - Nur a-z, 0-9, _, - (für Identifier)

**Spezialwert:**
- `"AUTOGENERATE"` → System generiert automatisch sicheres Passwort (z.B. RCON_PASSWORD)

### 7. Templates (Pre-Configured Variants)
```json
{
  "templates": [
    {
      "name": "competitive",
      "label": "Competitive 5v5",
      "description": "Standard Competitive Mode",
      "icon": "fa-trophy",
      "variables": {
        "MAX_PLAYERS": "10",
        "MAP": "de_dust2"
      },
      "config_overrides": {
        "csgo/cfg/server.cfg": {
          "mp_roundtime": "1.92",
          "mp_maxrounds": "30"
        }
      }
    }
  ]
}
```

**Template-Flow:**
1. User wählt Template beim Server-Erstellen
2. `variables` werden als Default-Werte übernommen
3. `config_overrides` werden in Config-Dateien geschrieben
4. User kann Werte noch anpassen vor Final-Creation

### 8. Ports
```json
{
  "ports": {
    "game": {
      "default": 27015,
      "protocol": "udp",
      "description": "Game Port"
    },
    "query": {
      "default": 27016,
      "protocol": "udp"
    }
  }
}
```

**Port-Allocation:**
- System weist automatisch freie Ports zu (checked against daemon_servers resource limits)
- `default` wird als Startpunkt genommen, dann hochzählen bis freier Port gefunden

### 9. Requirements (Resource Limits)
```json
{
  "requirements": {
    "ram_min_mb": 2048,
    "ram_recommended_mb": 4096,
    "cpu_cores_min": 2,
    "disk_min_gb": 35,
    "disk_recommended_gb": 50
  }
}
```

**Verwendung:**
- Dashboard zeigt Requirements vor Server-Erstellung an
- System prüft ob Virtual Server (daemon_server) genug freie Resources hat
- Warning wenn nur `_min` verfügbar, Error wenn nicht mal das

---

## Template-Beispiele

### CS2: 4 Templates
1. **Competitive 5v5**: Standard MR15, 10 Spieler, Dust2
2. **Casual 10v10**: 20 Spieler, entspannte Regeln
3. **Deathmatch**: 16 Spieler, Instant Respawn
4. **Surf**: 24 Spieler, Custom-Physics für Surf-Maps

### Valheim: 2 Templates
1. **Vanilla**: Reiner Vanilla-Server
2. **Modded**: Vorbereitet für Valheim Plus (BepInEx)

### ARK: 3 Templates
1. **PvP**: 50 Spieler, 5x Rates, The Island
2. **PvE**: 30 Spieler, Vanilla Rates, kooperativ
3. **Boosted (10x)**: 40 Spieler, 10x Taming/Harvest/XP

### Rust: 3 Templates
1. **Vanilla PvP**: Standard Rust ohne Oxide
2. **Modded (Oxide)**: Mit Oxide für Plugins (Kits, TP, Clans)
3. **PvE**: Kooperativ mit reduziertem Decay

### 7 Days to Die: 3 Templates
1. **PvE Co-Op**: Kein PvP, Normal Difficulty
2. **PvP**: Alle können sich töten, Hard Difficulty
3. **Hardcore**: Insane Difficulty, 32 Blood Moon Zombies, reduzierter Loot

---

## Installation in Datenbank

Das SQL-Script `seed_official_addons.sql` fügt alle 5 Addons in die `addon_marketplace`-Tabelle ein:

```bash
# MySQL-Login
mysql -u dunebot -p dunebot_dev

# Script ausführen
source /home/firedervil/dunebot_dev/plugins/gameserver/dashboard/sql/seed_official_addons.sql;

# Verification
SELECT id, slug, name, trust_level, status FROM addon_marketplace WHERE trust_level = 'official';
```

**Erwartetes Ergebnis:**
```
+----+--------+------------------------+-------------+----------+
| id | slug   | name                   | trust_level | status   |
+----+--------+------------------------+-------------+----------+
|  1 | cs2    | Counter-Strike 2       | official    | approved |
|  2 | valheim| Valheim                | official    | approved |
|  3 | ark    | ARK: Survival Evolved  | official    | approved |
|  4 | rust   | Rust                   | official    | approved |
|  5 | 7days  | 7 Days to Die          | official    | approved |
+----+--------+------------------------+-------------+----------+
```

---

## Frozen Game Data Konzept

Wenn ein Gameserver erstellt wird:

1. User wählt Addon: `cs2` (Version 1.0.0)
2. System kopiert **kompletten** `game_data` JSON → `gameservers.frozen_game_data`
3. User füllt Variables aus (SERVER_NAME, RCON_PASSWORD, etc.) → `gameservers.env_variables`
4. Gameserver wird installiert mit `frozen_game_data` + `env_variables`

**Später:** Addon-Autor updated CS2 zu Version 1.1.0
- Bestehende Server nutzen weiterhin `frozen_game_data` (Version 1.0.0)
- System zeigt "Update verfügbar" Flag → User kann updaten (optional)
- Bei Update: Neuer `frozen_game_data` Snapshot, `env_variables` werden migriert

**Vorteil:**
- Reproduzierbarkeit: Server bleibt stabil, auch wenn Addon sich ändert
- Breaking Changes betreffen nur neue Server
- User entscheidet selbst wann er updatet

---

## Community Addons (Später)

Wenn Community-User eigene Addons erstellen:

1. JSON-Datei wie oben erstellen (z.B. `minecraft-java.json`)
2. Upload über Dashboard → `addon_marketplace` INSERT mit:
   - `trust_level: 'unverified'`
   - `visibility: 'unlisted'`
   - `status: 'pending_review'`
3. DuneBot Team reviewed → Freigabe als `'verified'`
4. Nach 5 approved Addons → Auto-Upgrade zu `'trusted'`

**Trust-Level-Rechte:**
- `unverified`: Nur Templates installieren (kein Custom-Script)
- `verified`: Full Installation-Scripts, Auto-Approve
- `trusted`: Community Moderator, kann andere Addons reviewen
- `official`: DuneBot Team, unrestricted

---

## Addon-Erstellung (Für Community-Autoren)

### Einfaches Addon (Valheim-Style)

1. Minimale `variables[]` (6 statt 15+)
2. Keine Config-Dateien (alles über Startup-Command)
3. 2 Templates (Vanilla, Modded)
4. Einfache Resource-Requirements

### Komplexes Addon (ARK-Style)

1. Viele `variables[]` (15+) mit allen Gameplay-Settings
2. Config-File-Parsing (INI/XML)
3. 3+ Templates für verschiedene Spielmodi
4. Template-spezifische `config_overrides`

### Best Practices

- **Immer `AUTOGENERATE` für Passwörter** (RCON, Admin)
- **`user_editable: false`** für Ports (System weist zu)
- **`required|string|alpha_dash`** für Identifiers (WORLD_NAME, SERVER_IDENTITY)
- **`min:X|max:Y`** für Zahlenwerte (Spieler, World-Size)
- **`select_options`** für Enums (MAP-Auswahl, Difficulty)
- **Screenshots in `assets.screenshots`** (für Marketplace-UI)

---

## Nächste Schritte

1. ✅ Addons erstellt (CS2, Valheim, ARK, Rust, 7DTD)
2. ✅ SQL-Seed-Script erstellt
3. ⏳ SQL ausführen und Datenbank befüllen
4. ⏳ Lokalisierung (NAV.*, MARKETPLACE.*, SERVER.*)
5. ⏳ Routes (marketplace.js, servers.js)
6. ⏳ Views (marketplace.ejs, addon-detail.ejs)
7. ⏳ IPC-Events (gameserverInstall, gameserverStart, gameserverStop)

---

## Troubleshooting

**JSON-Syntax-Error bei Import:**
- MySQL JSON-Validierung sehr strikt
- Prüfen: `mysql> SELECT JSON_VALID('...');`
- Alternative: JSON in `game_data` als Longtext speichern, erst beim Abruf JSON_EXTRACT()

**Port bereits belegt:**
- System muss freie Ports automatisch allokieren
- Query gegen `gameservers.ports` JSON für alle Server auf demselben `daemon_server_id`

**Installation schlägt fehl:**
- SteamCMD-Credentials prüfen (anonymous login für öffentliche Server)
- Disk-Space auf Virtual Server prüfen (daemon_servers.disk_limit_gb)
- Installation-Script-Logs in `logs/gameserver-install-{id}.log`

---

**Autor:** DuneBot Official  
**Datum:** 2025-10-19  
**Version:** 1.0.0
