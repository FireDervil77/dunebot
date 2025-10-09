# Plugin-Update-System - Dokumentation

**Version:** 1.0.0  
**Datum:** 09.10.2025  
**Autor:** firedervil

---

## 📋 Inhaltsverzeichnis

1. [Übersicht](#übersicht)
2. [Systemarchitektur](#systemarchitektur)
3. [Plugin-Struktur für Updates](#plugin-struktur-für-updates)
4. [Update erstellen](#update-erstellen)
5. [Migrationen schreiben](#migrationen-schreiben)
6. [Update auslösen](#update-auslösen)
7. [Auto-Update-System](#auto-update-system)
8. [Beispiel: DuneMap v2.0.0](#beispiel-dunemap-v200)

---

## 🎯 Übersicht

Das Plugin-Update-System ermöglicht WordPress-ähnliche Updates für DuneBot-Plugins mit:

- ✅ **Versionsverwaltung** (semver)
- ✅ **Automatische Migrationen** (Datenbank-Schema-Änderungen)
- ✅ **Changelog-Anzeige** im Dashboard
- ✅ **Manuelle Updates** mit 5-Tage-Frist
- ✅ **Automatische Updates** nach Ablauf der Frist
- ✅ **Rollback-Fähigkeit** (down-Migrationen)
- ✅ **Dashboard-Widgets** für Update-Benachrichtigungen

---

## 🏗️ Systemarchitektur

### Backend-Komponenten

```
/apps/dashboard/helpers/PluginManager.js
├── loadPluginMeta(pluginName)              # Lädt plugin.json
├── checkPluginUpdate(pluginName, guildId)  # Prüft auf Updates
├── updatePlugin(pluginName, guildId)       # Führt Update durch
├── runMigration(pluginName, version)       # Führt Migration aus
├── processAutoUpdates()                    # Daily Cron (03:00)
└── getAvailableUpdates(guildId)            # Liste aller Updates

/migrations/
├── create_plugin_versions_table.sql        # DB-Schema für Versionstracking
└── add_plugin_update_config.sql            # SuperAdmin-Konfiguration

/plugins/{plugin}/
├── plugin.json                             # Versions-Metadaten (NEU!)
└── migrations/                             # Migrations-Verzeichnis (NEU!)
    ├── migrate_to_v2.js                    # Migration für v2.0.0
    └── migrate_to_v3.js                    # Migration für v3.0.0
```

### Frontend-Komponenten

```
/apps/dashboard/themes/default/views/guild/plugins.ejs
├── Update-Banner (oben)                    # Anzahl verfügbarer Updates
├── Update-Badges (auf Plugin-Cards)        # Orange "Update"-Badge
├── Changelog-Vorschau (3 Einträge)         # In Card-Body
└── "Jetzt aktualisieren"-Button            # AJAX-Update

/plugins/core/dashboard/views/widgets/plugin-updates.ejs
└── Dashboard-Widget                        # Zeigt bis zu 3 Updates

/apps/dashboard/themes/default/partials/guild/sidebar.ejs
└── Badge-Counter                           # Orange Badge im Menü
```

### Datenbank-Tabellen

```sql
-- Plugin-Versionstracking
CREATE TABLE plugin_versions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    plugin_name VARCHAR(100) NOT NULL,
    guild_id VARCHAR(50) NOT NULL,
    current_version VARCHAR(20) NOT NULL,
    available_version VARCHAR(20) NOT NULL,
    update_available_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    update_deadline_at TIMESTAMP NULL,
    auto_update_at TIMESTAMP NULL,
    update_status ENUM('up-to-date', 'available', 'pending', 'auto-updated', 'failed') DEFAULT 'available',
    changelog JSON,
    error_log TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_plugin_guild (plugin_name, guild_id)
);

-- SuperAdmin-Konfiguration
INSERT INTO superadmin_config (config_key, config_value, config_type, description)
VALUES 
    ('plugin_auto_update_enabled', 'true', 'boolean', 'Automatische Plugin-Updates aktivieren'),
    ('plugin_update_grace_days', '5', 'number', 'Tage bis zur automatischen Aktualisierung');
```

---

## 📦 Plugin-Struktur für Updates

### Minimale Struktur

```
plugins/mein-plugin/
├── package.json                    # Bestehend (wird NICHT geändert)
├── plugin.json                     # ⭐ NEU: Update-Metadaten
└── migrations/                     # ⭐ NEU: Migrations-Ordner
    └── migrate_to_v{version}.js    # Migration-Datei
```

### Vollständige Struktur (Beispiel)

```
plugins/dunemap/
├── package.json                    # Version: "1.0.0" (ändert sich NICHT!)
├── plugin.json                     # ⭐ Update-Metadaten
├── bot/
│   ├── index.js
│   ├── commands/
│   └── events/
├── dashboard/
│   ├── index.js
│   ├── routes/
│   └── views/
└── migrations/                     # ⭐ Migrations
    ├── migrate_to_v2.js
    └── migrate_to_v3.js
```

---

## 🆕 Update erstellen

### Schritt 1: `plugin.json` erstellen

Erstelle eine `plugin.json` im Root des Plugin-Verzeichnisses:

```json
{
  "name": "dunemap",
  "version": "2.0.0",
  "previousVersion": "1.0.0",
  "breaking": true,
  "changelog": [
    "🔄 Automatisches Coriolis-Sturm-Timer-System",
    "🌍 Unterstützung für 5 Regionen (EU/NA/SA/AS/OCE)",
    "⏰ Timer zählt bis Storm-ENDE (Reset-Zeit)",
    "🗑️ Entfernt: Manuelle Timer-Befehle /storm set/reset",
    "🎨 Neue Storm-Info-Box im Admin-Panel",
    "📊 Live-Countdown mit 1-Sekunden-Updates",
    "🔧 Neue Setting: Region-Auswahl",
    "🗄️ Migration: Automatische Datenbank-Aktualisierung"
  ],
  "migrations": {
    "2.0.0": "migrations/migrate_to_v2.js"
  }
}
```

**Wichtige Felder:**

- `name`: Plugin-Name (muss mit Verzeichnisnamen übereinstimmen)
- `version`: **Neue** Version (semver: `MAJOR.MINOR.PATCH`)
- `previousVersion`: Version, von der aktualisiert wird
- `breaking`: `true` wenn Breaking Changes vorhanden sind
- `changelog`: Array von Änderungen (wird im Dashboard angezeigt)
- `migrations`: Mapping von Version → Migration-Datei

### Schritt 2: Migration erstellen

Erstelle `migrations/migrate_to_v2.js`:

```javascript
const { ServiceManager } = require('dunebot-core');

/**
 * Migration von DuneMap v1.0.0 → v2.0.0
 * 
 * BREAKING CHANGES:
 * - Fügt coriolis_region Setting hinzu (Standard: 'EU')
 * - Entfernt alte Timer-Settings
 * - Markiert dunemap_storm_timer Tabelle als DEPRECATED
 * 
 * @author firedervil
 */
module.exports = {
    /**
     * Migration NACH OBEN (v1 → v2)
     * @param {string|null} guildId - Guild ID oder null für global
     * @returns {Promise<void>}
     */
    async up(guildId = null) {
        const Logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');
        
        Logger.info(`[DuneMap Migration v2.0.0] Starting UP migration${guildId ? ` for guild ${guildId}` : ' (global)'}`);
        
        try {
            // 1. Neue Region-Einstellung hinzufügen
            const context = guildId ? 'guild' : 'shared';
            
            await dbService.setConfig('dunemap', 'coriolis_region', 'EU', guildId, context);
            Logger.info('[DuneMap Migration v2.0.0] ✅ Added coriolis_region setting (default: EU)');
            
            // 2. Alte Timer-Einstellungen entfernen (optional)
            if (guildId) {
                const oldSettings = [
                    'storm_end_time',
                    'storm_active',
                    'last_updated',
                    'manual_override'
                ];
                
                for (const setting of oldSettings) {
                    await dbService.query(
                        'DELETE FROM configs WHERE plugin = ? AND config_key = ? AND guild_id = ?',
                        ['dunemap', setting, guildId]
                    );
                }
                Logger.info('[DuneMap Migration v2.0.0] ✅ Removed old timer settings');
            }
            
            // 3. Tabelle als deprecated markieren (optional - nur Schema-Hinweis)
            await dbService.query(`
                ALTER TABLE dunemap_storm_timer 
                COMMENT = 'DEPRECATED: Wird nicht mehr verwendet seit v2.0.0. Nutze stattdessen automatisches Timer-System.'
            `);
            Logger.info('[DuneMap Migration v2.0.0] ✅ Marked dunemap_storm_timer as deprecated');
            
            Logger.info('[DuneMap Migration v2.0.0] ✅ UP migration completed successfully');
            
        } catch (error) {
            Logger.error('[DuneMap Migration v2.0.0] ❌ UP migration failed:', error);
            throw error;
        }
    },
    
    /**
     * Migration NACH UNTEN (v2 → v1) - Rollback
     * @param {string|null} guildId - Guild ID oder null für global
     * @returns {Promise<void>}
     */
    async down(guildId = null) {
        const Logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');
        
        Logger.info(`[DuneMap Migration v2.0.0] Starting DOWN migration (rollback)${guildId ? ` for guild ${guildId}` : ' (global)'}`);
        
        try {
            // 1. Region-Einstellung entfernen
            if (guildId) {
                await dbService.query(
                    'DELETE FROM configs WHERE plugin = ? AND config_key = ? AND guild_id = ?',
                    ['dunemap', 'coriolis_region', guildId]
                );
            } else {
                await dbService.query(
                    'DELETE FROM configs WHERE plugin = ? AND config_key = ? AND context = ?',
                    ['dunemap', 'coriolis_region', 'shared']
                );
            }
            Logger.info('[DuneMap Migration v2.0.0] ✅ Removed coriolis_region setting');
            
            // 2. Alte Timer-Einstellungen wiederherstellen
            if (guildId) {
                await dbService.setConfig('dunemap', 'storm_end_time', null, guildId);
                await dbService.setConfig('dunemap', 'storm_active', 'false', guildId);
                Logger.info('[DuneMap Migration v2.0.0] ✅ Restored old timer settings');
            }
            
            // 3. Tabellen-Comment entfernen
            await dbService.query(`
                ALTER TABLE dunemap_storm_timer COMMENT = ''
            `);
            
            Logger.info('[DuneMap Migration v2.0.0] ✅ DOWN migration completed successfully');
            
        } catch (error) {
            Logger.error('[DuneMap Migration v2.0.0] ❌ DOWN migration failed:', error);
            throw error;
        }
    }
};
```

---

## 🔄 Migrationen schreiben

### Best Practices

1. **Idempotenz**: Migrationen sollten mehrfach ausführbar sein ohne Fehler
2. **Fehlerbehandlung**: Alle DB-Operationen in try-catch
3. **Logging**: Ausführliche Logs für Debugging
4. **Rollback**: Immer `down()` implementieren
5. **Testen**: Migration in DEV testen vor PROD

### Migration-Typen

#### Datenbank-Schema-Änderungen

```javascript
async up(guildId) {
    const dbService = ServiceManager.get('dbService');
    
    // Neue Spalte hinzufügen
    await dbService.query(`
        ALTER TABLE mein_plugin_tabelle 
        ADD COLUMN neue_spalte VARCHAR(100) DEFAULT NULL
    `);
    
    // Index erstellen
    await dbService.query(`
        CREATE INDEX idx_neue_spalte ON mein_plugin_tabelle(neue_spalte)
    `);
}

async down(guildId) {
    const dbService = ServiceManager.get('dbService');
    
    // Index entfernen
    await dbService.query(`
        DROP INDEX idx_neue_spalte ON mein_plugin_tabelle
    `);
    
    // Spalte entfernen
    await dbService.query(`
        ALTER TABLE mein_plugin_tabelle 
        DROP COLUMN neue_spalte
    `);
}
```

#### Config-Einstellungen

```javascript
async up(guildId) {
    const dbService = ServiceManager.get('dbService');
    const context = guildId ? 'guild' : 'shared';
    
    // Neue Setting hinzufügen
    await dbService.setConfig('mein-plugin', 'neue_option', 'default_wert', guildId, context);
    
    // Alte Setting umbenennen
    const altWert = await dbService.getConfig('mein-plugin', 'alte_option', guildId);
    if (altWert) {
        await dbService.setConfig('mein-plugin', 'neue_option', altWert, guildId, context);
        await dbService.query(
            'DELETE FROM configs WHERE plugin = ? AND config_key = ? AND guild_id = ?',
            ['mein-plugin', 'alte_option', guildId]
        );
    }
}

async down(guildId) {
    const dbService = ServiceManager.get('dbService');
    
    // Neue Setting entfernen
    await dbService.query(
        'DELETE FROM configs WHERE plugin = ? AND config_key = ? AND guild_id = ?',
        ['mein-plugin', 'neue_option', guildId]
    );
}
```

#### Daten-Migration

```javascript
async up(guildId) {
    const dbService = ServiceManager.get('dbService');
    
    // Alle Datensätze aktualisieren
    const rows = await dbService.query(
        'SELECT id, alte_spalte FROM mein_plugin_tabelle WHERE guild_id = ?',
        [guildId]
    );
    
    for (const row of rows) {
        const neuerWert = transformiereWert(row.alte_spalte);
        await dbService.query(
            'UPDATE mein_plugin_tabelle SET neue_spalte = ? WHERE id = ?',
            [neuerWert, row.id]
        );
    }
}
```

### Guild-Specific vs. Global Migrations

```javascript
async up(guildId = null) {
    if (guildId) {
        // Guild-spezifische Migration
        // Nur für eine bestimmte Guild
        await dbService.setConfig('plugin', 'key', 'value', guildId, 'guild');
    } else {
        // Globale Migration
        // Für alle Guilds oder shared context
        await dbService.setConfig('plugin', 'key', 'value', null, 'shared');
    }
}
```

---

## 🚀 Update auslösen

### Methode 1: Manuell per Dashboard (Standard)

1. **Plugin aktivieren/Update verfügbar machen**:

```javascript
// In irgendeinem Script oder beim Plugin-Enable
const pluginManager = ServiceManager.get('pluginManager');
await pluginManager.checkPluginUpdate('dunemap', guildId);
```

2. **Dashboard aufrufen**:
   - Navigiere zu `/guild/{guildId}/plugins`
   - Update-Banner wird angezeigt
   - Orange Badge auf Plugin-Card
   - Changelog-Vorschau (erste 3 Einträge)

3. **Update durchführen**:
   - Klick auf **"Jetzt aktualisieren"**
   - Bestätigungsdialog erscheint
   - Button zeigt Loading-State
   - Migration läuft im Hintergrund
   - Erfolgs-/Fehlermeldung
   - Seite lädt neu

### Methode 2: Programmatisch

```javascript
const { ServiceManager } = require('dunebot-core');

(async () => {
    const pluginManager = ServiceManager.get('pluginManager');
    const guildId = '1403034310172475416';
    
    try {
        // 1. Prüfe ob Update verfügbar ist
        await pluginManager.checkPluginUpdate('dunemap', guildId);
        
        // 2. Führe Update durch (isAutoUpdate = false)
        await pluginManager.updatePlugin('dunemap', guildId, false);
        
        console.log('✅ Update erfolgreich!');
    } catch (error) {
        console.error('❌ Update fehlgeschlagen:', error.message);
    }
})();
```

### Methode 3: Test-Script erstellen

Erstelle `test_plugin_update.js`:

```javascript
require('dotenv').config({ path: 'apps/dashboard/.env' });
const { ServiceManager } = require('dunebot-core');
const DBService = require('./packages/dunebot-db-client/lib/DBService');
const PluginManager = require('./apps/dashboard/helpers/PluginManager');
const pino = require('pino');

const logger = pino({
    level: 'debug',
    transport: { target: 'pino-pretty' }
});

(async () => {
    try {
        // Services initialisieren
        ServiceManager.register('Logger', logger);
        
        const dbService = new DBService();
        await dbService.connect();
        ServiceManager.register('dbService', dbService);
        
        const pluginManager = new PluginManager();
        ServiceManager.register('pluginManager', pluginManager);
        
        // Update erstellen
        const guildId = '1403034310172475416';
        const pluginName = 'dunemap';
        
        logger.info(`Creating update notice for ${pluginName}...`);
        await pluginManager.checkPluginUpdate(pluginName, guildId);
        
        logger.info('✅ Update notice created successfully!');
        logger.info('Open Dashboard → /guild/' + guildId + '/plugins');
        
        await dbService.disconnect();
        process.exit(0);
        
    } catch (error) {
        logger.error('❌ Error:', error);
        process.exit(1);
    }
})();
```

Ausführen:

```bash
cd /home/firedervil/dunebot_dev
node test_plugin_update.js
```

---

## ⏰ Auto-Update-System

### Konfiguration

SuperAdmin-Einstellungen in der Datenbank:

```sql
-- Auto-Updates aktivieren/deaktivieren
UPDATE superadmin_config 
SET config_value = 'true' 
WHERE config_key = 'plugin_auto_update_enabled';

-- Frist ändern (Standard: 5 Tage)
UPDATE superadmin_config 
SET config_value = '7' 
WHERE config_key = 'plugin_update_grace_days';
```

### Zeitplan

- **Daily Cron**: Läuft jeden Tag um **03:00 Uhr**
- **Grace Period**: 5 Tage (konfigurierbar)
- **Automatische Ausführung**: Nach Ablauf der Deadline

### Funktionsweise

1. **Update Notice erstellt** (z.B. 09.10.2025 12:00)
2. **Deadline berechnet** (09.10. + 5 Tage = 14.10.2025 12:00)
3. **User wird benachrichtigt** (Dashboard-Widget, Badge, Banner)
4. **Tag 1-5**: User kann manuell updaten
5. **Tag 6** (15.10.2025 03:00): Auto-Update läuft
6. **Bei Fehler**: Admin erhält IPC-Benachrichtigung

### Status-Übersicht

| Status | Beschreibung | User-Aktion möglich? |
|--------|--------------|----------------------|
| `up-to-date` | Plugin ist aktuell | ❌ |
| `available` | Update verfügbar, innerhalb Frist | ✅ Manuelles Update |
| `pending` | Update wird verarbeitet | ❌ |
| `auto-updated` | Automatisch aktualisiert | ❌ |
| `failed` | Update fehlgeschlagen | ✅ Erneuter Versuch |

---

## 📚 Beispiel: DuneMap v2.0.0

### Ausgangssituation

- **Aktuell**: DuneMap v1.0.0 (manuelles Timer-System)
- **Neu**: DuneMap v2.0.0 (automatisches Timer-System)
- **Breaking Changes**: Ja (entfernt /storm set/reset Commands)

### Dateien erstellt

```
plugins/dunemap/
├── plugin.json                     # ⭐ NEU
└── migrations/
    └── migrate_to_v2.js            # ⭐ NEU
```

### 1. `plugin.json`

```json
{
  "name": "dunemap",
  "version": "2.0.0",
  "previousVersion": "1.0.0",
  "breaking": true,
  "changelog": [
    "🔄 Automatisches Coriolis-Sturm-Timer-System",
    "🌍 Unterstützung für 5 Regionen (EU/NA/SA/AS/OCE)",
    "⏰ Timer zählt bis Storm-ENDE (Reset-Zeit)",
    "🗑️ Entfernt: Manuelle Timer-Befehle /storm set/reset",
    "🎨 Neue Storm-Info-Box im Admin-Panel",
    "📊 Live-Countdown mit 1-Sekunden-Updates",
    "🔧 Neue Setting: Region-Auswahl",
    "🗄️ Migration: Automatische Datenbank-Aktualisierung"
  ],
  "migrations": {
    "2.0.0": "migrations/migrate_to_v2.js"
  }
}
```

### 2. Migration ausführen

#### Test-Notice erstellen:

```javascript
// test_dunemap_update.js
require('dotenv').config({ path: 'apps/dashboard/.env' });
const { ServiceManager } = require('dunebot-core');
// ... (siehe Test-Script oben)

await pluginManager.checkPluginUpdate('dunemap', '1403034310172475416');
```

#### Ergebnis in DB:

```
plugin_name: dunemap
current_version: 1.0.0
available_version: 2.0.0
update_status: available
update_deadline_at: 2025-10-14 12:28:14
changelog: ["🔄 Automatisches...", "🌍 Unterstützung...", ...]
```

### 3. Dashboard-Anzeige

**Update-Banner:**
```
⚠️ 1 Plugin-Update(s) verfügbar
Es stehen Updates für installierte Plugins bereit...
```

**Plugin-Card:**
```
┌─────────────────────────────────┐
│ 🗺️ DuneMap  [Update ⬆️]        │
│ v1.0.0 → v2.0.0                 │
├─────────────────────────────────┤
│ Interactive Dune Awakening map  │
│                                  │
│ ⚠️ Update verfügbar!            │
│ Deadline: 14.10.2025 (5 Tage)   │
│                                  │
│ Änderungen:                      │
│ • 🔄 Automatisches Timer-System │
│ • 🌍 5 Regionen-Support         │
│ • ⏰ Timer bis Storm-Ende       │
│ ... und 5 weitere               │
├─────────────────────────────────┤
│ [🔄 Jetzt aktualisieren]        │
│ [⚙️ Einstellungen]              │
└─────────────────────────────────┘
```

### 4. Update durchführen

User klickt **"Jetzt aktualisieren"**:

1. ✅ Bestätigungsdialog
2. ✅ Button: "🔄 Wird aktualisiert..."
3. ✅ Migration läuft: `migrate_to_v2.js up(guildId)`
4. ✅ DB-Update: `coriolis_region='EU'` eingefügt
5. ✅ Alte Settings gelöscht
6. ✅ Status: `available` → `auto-updated`
7. ✅ Version: `1.0.0` → `2.0.0`
8. ✅ Seite lädt neu
9. ✅ Update-Badge verschwindet

### 5. Verifizierung

```sql
-- Prüfen ob Migration erfolgreich war
SELECT * FROM configs 
WHERE plugin = 'dunemap' 
AND config_key = 'coriolis_region' 
AND guild_id = '1403034310172475416';
-- Erwartet: value = 'EU'

-- Prüfen ob alte Settings entfernt wurden
SELECT * FROM configs 
WHERE plugin = 'dunemap' 
AND config_key IN ('storm_end_time', 'storm_active') 
AND guild_id = '1403034310172475416';
-- Erwartet: 0 Zeilen

-- Prüfen ob Update-Status korrekt
SELECT * FROM plugin_versions 
WHERE plugin_name = 'dunemap' 
AND guild_id = '1403034310172475416';
-- Erwartet: current_version = '2.0.0', update_status = 'up-to-date'
```

---

## 🔧 Troubleshooting

### Update erscheint nicht im Dashboard

**Problem**: `plugin.json` nicht gefunden

**Lösung**:
```bash
# Prüfe ob Datei existiert
ls -la plugins/mein-plugin/plugin.json

# Prüfe JSON-Syntax
cat plugins/mein-plugin/plugin.json | jq .
```

### Migration schlägt fehl

**Problem**: Fehler in Migration-Datei

**Lösung**:
```javascript
// Ausführliches Logging in Migration
const Logger = ServiceManager.get('Logger');
Logger.info('Migration Step 1: Adding setting...');
// ... DB-Operation
Logger.info('Migration Step 1: ✅ Success');
```

### Dashboard zeigt Fehler nach Update

**Problem**: Migration hat Daten korrumpiert

**Lösung**: Rollback durchführen

```javascript
const pluginManager = ServiceManager.get('pluginManager');
await pluginManager.runMigration('dunemap', '1.0.0', guildId); // Down-Migration
```

### Auto-Update läuft nicht

**Problem**: Cron nicht gestartet

**Lösung**:
```javascript
// In apps/dashboard/app.js prüfen
console.log('Auto-Update Cron scheduled for:', nextRun);

// Logs prüfen
tail -f logs/dashboard-*.log | grep -i "auto.*update"
```

---

## 📝 Checkliste: Plugin-Update erstellen

- [ ] `plugin.json` im Plugin-Root erstellen
- [ ] Version in semver-Format (`MAJOR.MINOR.PATCH`)
- [ ] Changelog mit Emoji-Icons (User-friendly)
- [ ] `breaking: true` setzen bei Breaking Changes
- [ ] `migrations/`-Ordner erstellen
- [ ] Migration-Datei: `migrate_to_v{version}.js`
- [ ] `up()` Funktion implementieren
- [ ] `down()` Funktion implementieren (Rollback!)
- [ ] Ausführliches Logging in Migration
- [ ] Fehlerbehandlung mit try-catch
- [ ] Migration in DEV testen
- [ ] Test-Script erstellen
- [ ] Update-Notice in DB erstellen
- [ ] Dashboard testen (Widget, Badge, Banner)
- [ ] Manuelles Update testen
- [ ] Verifizierung nach Update
- [ ] Dokumentation aktualisieren

---

## 🎓 Best Practices

### Versionierung

- **MAJOR**: Breaking Changes (1.0.0 → 2.0.0)
- **MINOR**: Neue Features, rückwärtskompatibel (1.0.0 → 1.1.0)
- **PATCH**: Bugfixes (1.0.0 → 1.0.1)

### Changelog

- ✅ **User-freundlich** schreiben (nicht technisch)
- ✅ **Emoji** verwenden für visuelle Kategorisierung
- ✅ **Kurz und prägnant** (max. 80 Zeichen pro Eintrag)
- ✅ **Wichtigste Änderungen zuerst**
- ❌ Keine technischen Details (z.B. "Refactored XYZ class")

### Migrationen

- ✅ **Idempotent**: Mehrfach ausführbar ohne Fehler
- ✅ **Transaktionen** verwenden bei mehreren DB-Ops
- ✅ **Logging**: Jeden Schritt loggen
- ✅ **Rollback**: Immer `down()` implementieren
- ✅ **Testen**: In DEV ausgiebig testen
- ❌ Keine destruktiven Operationen ohne Backup

### Deployment

- ✅ **DEV testen** vor PROD
- ✅ **Rollback-Plan** haben
- ✅ **Backup** vor großen Updates
- ✅ **Staged Rollout**: Erst wenige Guilds, dann alle
- ❌ Nie direkt in PROD deployen

---

## 📖 Weiterführende Dokumentation

- [Plugin-System Architecture](plugin_system_redesign.md)
- [Database Schema](../packages/dunebot-db-client/README.md)
- [PluginManager API](../apps/dashboard/helpers/PluginManager.js)
- [Migration Examples](../plugins/dunemap/migrations/)

---

**Ende der Dokumentation**  
Bei Fragen: firedervil77@gmail.com
