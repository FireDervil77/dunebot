# Plugin System Redesign - Proposal

## Problem mit aktuellem System

**configs Tabelle:**
```sql
config_value = '["core","dunemap","superadmin"]'  -- JSON in einer Spalte
```

**Nachteile:**
- Kein echtes Relational Model
- Schwer zu querien (JSON_SEARCH, JSON_CONTAINS)
- Keine Plugin-Metadaten (Version, installed_at, etc.)
- Keine Foreign Keys möglich
- Fehleranfällig

---

## Vorschlag 1: WordPress-ähnlich (Hybrid)

### Neue Tabellen:

```sql
-- Plugin Registry (global)
CREATE TABLE plugins (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) UNIQUE NOT NULL,
    display_name VARCHAR(255),
    version VARCHAR(20),
    author VARCHAR(100),
    repository VARCHAR(255),
    requires_owner BOOLEAN DEFAULT 0,
    is_installed BOOLEAN DEFAULT 0,
    installed_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_name (name),
    INDEX idx_installed (is_installed)
) ENGINE=InnoDB;

-- Guild <-> Plugin Relation (Many-to-Many)
CREATE TABLE guild_plugins (
    id INT AUTO_INCREMENT PRIMARY KEY,
    guild_id VARCHAR(255) NOT NULL,
    plugin_name VARCHAR(100) NOT NULL,
    is_enabled BOOLEAN DEFAULT 1,
    enabled_at DATETIME,
    disabled_at DATETIME,
    config JSON,  -- Plugin-spezifische Settings für diese Guild
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    UNIQUE KEY unique_guild_plugin (guild_id, plugin_name),
    FOREIGN KEY (guild_id) REFERENCES guilds(_id) ON DELETE CASCADE,
    INDEX idx_guild_enabled (guild_id, is_enabled),
    INDEX idx_plugin_enabled (plugin_name, is_enabled)
) ENGINE=InnoDB;
```

**Vorteile:**
- ✅ Echte Relationen mit Foreign Keys
- ✅ Schnelle Queries: `SELECT plugin_name FROM guild_plugins WHERE guild_id = ? AND is_enabled = 1`
- ✅ Plugin-Metadaten (Version, Installation Date)
- ✅ History tracking (enabled_at, disabled_at)
- ✅ Guild-spezifische Plugin-Config in JSON-Spalte
- ✅ Indizes für Performance

**Migration:**
```sql
-- Daten aus configs übernehmen:
INSERT INTO guild_plugins (guild_id, plugin_name, is_enabled, enabled_at)
SELECT 
    guild_id,
    JSON_UNQUOTE(JSON_EXTRACT(plugin_name, '$[*]')) AS plugin,
    1,
    NOW()
FROM configs
WHERE config_key = 'ENABLED_PLUGINS'
AND context = 'shared';
```

---

## Vorschlag 2: PrestaShop-Style (Voll normalisiert)

```sql
-- Plugins Tabelle (global)
CREATE TABLE plugins (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) UNIQUE NOT NULL,
    display_name VARCHAR(255),
    version VARCHAR(20),
    author VARCHAR(100),
    type ENUM('core', 'official', 'third-party') DEFAULT 'third-party',
    requires_owner BOOLEAN DEFAULT 0,
    installed BOOLEAN DEFAULT 0,
    active_globally BOOLEAN DEFAULT 0,
    installed_at DATETIME,
    INDEX idx_name (name),
    INDEX idx_installed (installed)
);

-- Guild-Plugin Aktivierung
CREATE TABLE guild_plugins (
    id INT AUTO_INCREMENT PRIMARY KEY,
    guild_id VARCHAR(255) NOT NULL,
    plugin_id INT NOT NULL,
    is_enabled BOOLEAN DEFAULT 1,
    enabled_at DATETIME,
    FOREIGN KEY (guild_id) REFERENCES guilds(_id) ON DELETE CASCADE,
    FOREIGN KEY (plugin_id) REFERENCES plugins(id) ON DELETE CASCADE,
    UNIQUE KEY unique_guild_plugin (guild_id, plugin_id)
);

-- Plugin Settings (separate von guild_plugins)
CREATE TABLE plugin_settings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    guild_id VARCHAR(255) NOT NULL,
    plugin_id INT NOT NULL,
    setting_key VARCHAR(100) NOT NULL,
    setting_value TEXT,
    context ENUM('bot', 'dashboard', 'shared') DEFAULT 'shared',
    FOREIGN KEY (guild_id) REFERENCES guilds(_id) ON DELETE CASCADE,
    FOREIGN KEY (plugin_id) REFERENCES plugins(id) ON DELETE CASCADE,
    UNIQUE KEY unique_setting (guild_id, plugin_id, setting_key, context)
);

-- Plugin Permissions (für Owner-Only Features)
CREATE TABLE plugin_permissions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    plugin_id INT NOT NULL,
    user_id VARCHAR(255) NOT NULL,
    permission ENUM('install', 'uninstall', 'configure', 'view') NOT NULL,
    granted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (plugin_id) REFERENCES plugins(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(_id) ON DELETE CASCADE
);
```

**Vorteile:**
- ✅ Maximal normalisiert (3NF)
- ✅ Granulare Permissions
- ✅ Settings in eigener Tabelle (statt JSON)
- ✅ Plugin-ID als Foreign Key überall

**Nachteil:**
- ⚠️ Mehr JOINs nötig (Performance?)

---

## Vorschlag 3: Hybrid (Bestes aus beiden Welten) ✅ EMPFOHLEN

**Kombination:**

```sql
-- NEUE Tabelle: guild_plugins (ersetzt configs.ENABLED_PLUGINS)
CREATE TABLE guild_plugins (
    id INT AUTO_INCREMENT PRIMARY KEY,
    guild_id VARCHAR(255) NOT NULL,
    plugin_name VARCHAR(100) NOT NULL,
    is_enabled BOOLEAN DEFAULT 1,
    
    -- Version Tracking (WICHTIG für Updates!)
    plugin_version VARCHAR(20),                  -- Installierte Version (z.B. '1.2.0')
    
    -- Audit Trail (Wer hat was wann gemacht?)
    enabled_at DATETIME,                         -- Wann aktiviert?
    enabled_by VARCHAR(255),                     -- User-ID: Wer hat aktiviert?
    disabled_at DATETIME,                        -- Wann deaktiviert?
    disabled_by VARCHAR(255),                    -- User-ID: Wer hat deaktiviert?
    
    -- Timestamps
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    -- Constraints & Indizes
    UNIQUE KEY unique_guild_plugin (guild_id, plugin_name),
    FOREIGN KEY (guild_id) REFERENCES guilds(_id) ON DELETE CASCADE,
    INDEX idx_guild_enabled (guild_id, is_enabled),
    INDEX idx_plugin (plugin_name),
    INDEX idx_enabled_by (enabled_by),
    INDEX idx_version (plugin_name, plugin_version)
) ENGINE=InnoDB;

-- BEHALTEN: configs Tabelle für Plugin-Settings
-- Aber NUR für echte Config-Werte, NICHT für ENABLED_PLUGINS!
-- configs bleibt unverändert und wird weiter genutzt:
configs:
- plugin_name      -- z.B. 'dunemap'
- config_key       -- z.B. 'API_KEY', 'MAX_MARKERS'
- config_value     -- z.B. 'xyz123', '50'
- context          -- 'bot', 'dashboard', 'shared'
- guild_id         -- Guild-spezifisch
```

**Warum Hybrid?**
1. ✅ **guild_plugins** = Saubere Plugin-Aktivierung (normalisiert) + Version Tracking
2. ✅ **configs** = Bleiben für Plugin-Settings (bewährtes System, keine Änderung!)
3. ✅ Minimale Änderungen am Code (backwards compatible)
4. ✅ Beste Performance (keine JOINs für Settings)
5. ✅ Audit Trail (Wer hat wann aktiviert/deaktiviert)
6. ✅ Update-Tracking (plugin_version Spalte)

**configs braucht KEINE Änderung!**
- ❌ RAUS: Nur `ENABLED_PLUGINS` Einträge werden gelöscht
- ✅ BLEIBT: Alle anderen Config-Keys bleiben in configs
- ✅ NUTZEN: DBService.getConfig() / setConfig() funktioniert weiter

---

## Query-Vergleich

### AKTUELL (JSON in configs):
```javascript
// Aktivierte Plugins holen
const config = await dbService.getConfig('core', 'ENABLED_PLUGINS', 'shared', guildId);
let plugins = JSON.parse(config);  // ← Parsing jedes Mal!

// Plugin aktivieren
plugins.push('newplugin');
await dbService.setConfig('core', 'ENABLED_PLUGINS', JSON.stringify(plugins), 'shared', guildId);
```

### NEU (guild_plugins Tabelle):
```javascript
// Aktivierte Plugins holen
const plugins = await dbService.query(`
    SELECT plugin_name 
    FROM guild_plugins 
    WHERE guild_id = ? AND is_enabled = 1
`, [guildId]);

// Plugin aktivieren
await dbService.query(`
    INSERT INTO guild_plugins (guild_id, plugin_name, is_enabled, enabled_at)
    VALUES (?, ?, 1, NOW())
    ON DUPLICATE KEY UPDATE is_enabled = 1, enabled_at = NOW()
`, [guildId, 'newplugin']);
```

**Performance-Gewinn:**
- ✅ Kein JSON-Parsing
- ✅ Index-basierte Suche
- ✅ Atomic Operations (keine Race Conditions)

---

## Migration Strategy

### Phase 1: Neue Tabelle erstellen
```sql
CREATE TABLE guild_plugins (...);
```

### Phase 2: Daten migrieren
```javascript
// Migration Script
const guilds = await dbService.query('SELECT DISTINCT guild_id FROM configs WHERE config_key = "ENABLED_PLUGINS"');

for (const {guild_id} of guilds) {
    const config = await dbService.getConfig('core', 'ENABLED_PLUGINS', 'shared', guild_id);
    const plugins = JSON.parse(config);
    
    for (const plugin of plugins) {
        await dbService.query(`
            INSERT INTO guild_plugins (guild_id, plugin_name, is_enabled, enabled_at)
            VALUES (?, ?, 1, NOW())
        `, [guild_id, plugin]);
    }
}
```

### Phase 3: Code anpassen
- `PluginManager.enableInGuild()` → Nutzt guild_plugins
- `PluginManager.isPluginEnabledForGuild()` → Query auf guild_plugins
- Backwards compatibility für alte configs (fallback)

### Phase 4: Alte ENABLED_PLUGINS löschen
```sql
DELETE FROM configs WHERE config_key = 'ENABLED_PLUGINS';
```

---

## Empfehlung

**Ich empfehle: Vorschlag 3 (Hybrid)**

**Warum?**
1. ✅ Löst das ENABLED_PLUGINS Problem komplett
2. ✅ Minimaler Refactoring-Aufwand
3. ✅ configs bleiben für Settings (bewährt)
4. ✅ Echte Relationen für Plugin-Aktivierung
5. ✅ Bessere Performance und Lesbarkeit
6. ✅ Einfacher zu debuggen

**Nächster Schritt:**
- Migration Script schreiben
- DBService Methoden erweitern:
  - `enablePluginForGuild(guildId, pluginName)`
  - `disablePluginForGuild(guildId, pluginName)`
  - `getEnabledPlugins(guildId)`
  - `isPluginEnabled(guildId, pluginName)`
- PluginManager umstellen
- Tests schreiben

---

## Fragen für Diskussion

1. **Brauchen wir Plugin-Versionierung?** (z.B. Update von v1.0 → v2.0)
2. **Plugin-Dependencies tracken?** (DuneMap requires Core v2.0+)
3. **Rollback-Funktion?** (Plugin deaktivieren + alte Config wiederherstellen)
4. **Audit Log?** (Wer hat wann welches Plugin aktiviert?)

---

**Was denkst du?** Hybrid-Ansatz sinnvoll oder lieber voll normalisiert wie PrestaShop?
