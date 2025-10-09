# 🚀 GitHub Release Update System

**DuneBot Plugin Update System mit GitHub Integration**  
Version: 2.0.0  
Autor: FireDervil  
Datum: 2025-10-09

---

## 📋 Inhaltsverzeichnis

1. [Übersicht](#übersicht)
2. [Architektur](#architektur)
3. [Release Workflow](#release-workflow)
4. [Entwickler-Guide](#entwickler-guide)
5. [Administrator-Guide](#administrator-guide)
6. [API Referenz](#api-referenz)
7. [Troubleshooting](#troubleshooting)

---

## 📖 Übersicht

### Was ist das GitHub Release Update System?

Ein WordPress-ähnliches Update-System, das Plugins automatisch von **GitHub Releases** aktualisiert, mit:

✅ **Automatische Update-Erkennung** (täglich um 03:00 Uhr)  
✅ **Grace Period** (5 Tage Wartezeit vor Auto-Update)  
✅ **Dashboard-Benachrichtigungen** mit Countdown  
✅ **Manuelle Updates** jederzeit möglich  
✅ **Automatisches Backup & Rollback**  
✅ **Migration-Support** für Datenbank-Änderungen  
✅ **Changelog-Integration** aus GitHub Releases  

### Zwei Update-Typen

```
┌─────────────────────────────────────────────────────────────┐
│ TYPE 1: CORE SYSTEM UPDATE                                 │
├─────────────────────────────────────────────────────────────┤
│ Was:  Bot Framework, Dashboard, Packages                    │
│ Wie:  Git Pull + PM2 Restart                                │
│ Tag:  v2.0.0, v2.1.0 (OHNE Plugin-Name)                    │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ TYPE 2: PLUGIN UPDATE                                       │
├─────────────────────────────────────────────────────────────┤
│ Was:  Einzelne Plugins (dunemap, greeting, etc.)            │
│ Wie:  GitHub Release Download + Auto-Install                │
│ Tag:  pluginname-v2.0.0 (MIT Plugin-Name!)                 │
└─────────────────────────────────────────────────────────────┘
```

---

## 🏗️ Architektur

### System-Komponenten

```
┌─────────────────────────────────────────────────────────────┐
│ GITHUB REPOSITORY                                           │
├─────────────────────────────────────────────────────────────┤
│ - Releases mit Tags (pluginname-vX.Y.Z)                    │
│ - Changelog im Release Body                                 │
│ - Source Code als .tar.gz                                  │
└─────────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────┐
│ PLUGINMANAGER (Dashboard)                                   │
├─────────────────────────────────────────────────────────────┤
│ - fetchGitHubReleases() → GitHub API Call                  │
│ - getLatestGitHubRelease(pluginName) → Neueste Version     │
│ - checkPluginUpdate() → Versions-Vergleich                 │
│ - downloadAndInstallUpdate() → Download + Installation     │
└─────────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────┐
│ DATABASE (plugin_versions Tabelle)                         │
├─────────────────────────────────────────────────────────────┤
│ - current_version: Aktuell installierte Version             │
│ - available_version: Verfügbares Update                    │
│ - update_deadline_at: Auto-Update Deadline                 │
│ - update_status: available / up-to-date / failed          │
│ - changelog: JSON Array mit Änderungen                     │
│ - release_url: Link zum GitHub Release                     │
└─────────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────┐
│ DASHBOARD UI                                                │
├─────────────────────────────────────────────────────────────┤
│ - Update-Widget mit Countdown                               │
│ - "Jetzt updaten" Button                                   │
│ - Changelog-Anzeige                                         │
│ - Update-Historie                                           │
└─────────────────────────────────────────────────────────────┘
```

### Datenbank-Schema

```sql
CREATE TABLE plugin_versions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    plugin_name VARCHAR(100) NOT NULL,
    guild_id VARCHAR(255) NOT NULL,
    
    -- Versionen
    current_version VARCHAR(20) DEFAULT NULL,
    available_version VARCHAR(20) DEFAULT NULL,
    
    -- Update-Zeitplan
    update_available_at DATETIME DEFAULT NULL,
    update_deadline_at DATETIME DEFAULT NULL,
    
    -- Status & Info
    update_status ENUM('available', 'up-to-date', 'auto-updated', 'failed'),
    changelog LONGTEXT DEFAULT NULL,  -- JSON Array
    release_url VARCHAR(500) DEFAULT NULL,  -- GitHub Release Link
    error_log TEXT DEFAULT NULL,
    
    -- Timestamps
    auto_update_at DATETIME DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    UNIQUE KEY unique_plugin_guild (plugin_name, guild_id)
);
```

---

## 🔄 Release Workflow

### Schritt-für-Schritt Anleitung

#### **1. ENTWICKLUNG (DEV Environment)**

```bash
# 1.1 Plugin entwickeln
cd dunebot_dev/plugins/dunemap
# ... Code-Änderungen ...

# 1.2 plugin.json Version erhöhen
vim plugin.json
```

```json
{
  "name": "dunemap",
  "version": "2.1.0",  // ← Erhöhen!
  "changelog": {
    "2.1.0": [
      "✨ Neue Storm-Timer Funktion",
      "🐛 Marker-Limit Bug behoben",
      "⚡ Performance-Verbesserungen"
    ]
  },
  "migrations": {
    "2.1.0": "migrations/migrate_to_v2.1.js"  // Optional
  }
}
```

```bash
# 1.3 Migration erstellen (falls nötig)
mkdir -p migrations
vim migrations/migrate_to_v2.1.js
```

```javascript
// migrations/migrate_to_v2.1.js
module.exports = {
    async up(dbService, guildId) {
        // Upgrade Logic
        await dbService.query(`
            ALTER TABLE dunemap_markers 
            ADD COLUMN new_field VARCHAR(255)
        `);
        return { success: true };
    },
    
    async down(dbService, guildId) {
        // Rollback Logic
        await dbService.query(`
            ALTER TABLE dunemap_markers 
            DROP COLUMN new_field
        `);
        return { success: true };
    }
};
```

```bash
# 1.4 Testen im DEV
npm run start:dashboard
npm run start:bot

# 1.5 Git Commit
git add plugins/dunemap/
git commit -m "feat(dunemap): Storm timer v2.1.0"
git push origin development
```

#### **2. RELEASE ERSTELLEN (GitHub)**

```bash
# 2.1 Zu main Branch wechseln
git checkout main
git merge development

# 2.2 Git Tag erstellen
git tag dunemap-v2.1.0
git push origin dunemap-v2.1.0
```

**2.3 GitHub Release erstellen:**

1. Gehe zu: `https://github.com/FireDervil77/dunebot/releases/new`
2. **Tag:** `dunemap-v2.1.0` (wähle den gerade erstellten Tag)
3. **Release Title:** `DuneMap v2.1.0 - Storm Timer`
4. **Release Body:**

```markdown
## 🗺️ DuneMap v2.1.0

### ✨ Neue Features
- Automatischer Storm-Timer für 5 Regionen
- Live-Countdown im Admin-Panel
- `/storm` Command mit Region-Auswahl

### 🐛 Bugfixes
- Marker-Limit auf 6 pro Kategorie erhöht
- Koordinaten-Validierung verbessert

### ⚡ Verbesserungen
- Performance-Optimierung beim Karten-Rendering
- Bessere Fehlerbehandlung

### 📋 Migration
Diese Version enthält eine Datenbank-Migration, die automatisch ausgeführt wird.

### 📦 Installation
Dieses Update wird automatisch über das Plugin Update System verteilt.
Grace Period: 5 Tage ab Veröffentlichung.
```

5. **Publish Release** klicken

#### **3. AUTO-UPDATE (PROD Environment)**

**Täglich um 03:00 Uhr:**

```javascript
// Automatischer Ablauf (kein manueller Eingriff nötig)

1. PluginManager.checkAllPluginUpdates() läuft
   ↓
2. Für jedes Plugin: checkPluginUpdate(pluginName, guildId)
   ↓
3. GitHub API Call: fetchGitHubReleases()
   ↓
4. Neueste Version finden: getLatestGitHubRelease('dunemap')
   → Findet: dunemap-v2.1.0
   ↓
5. Versions-Vergleich: semver.gt('2.1.0', '2.0.0') = TRUE
   ↓
6. Update-Notice erstellen in plugin_versions Tabelle
   - current_version: 2.0.0
   - available_version: 2.1.0
   - update_deadline_at: 2025-10-14 03:00:00 (heute + 5 Tage)
   - changelog: JSON aus GitHub Release
   - release_url: https://github.com/.../releases/tag/dunemap-v2.1.0
   ↓
7. Dashboard-Widget zeigt Update-Benachrichtigung
```

#### **4. UPDATE INSTALLATION**

**Option A: Manuelles Update (sofort)**

```
Admin klickt "Jetzt updaten" im Dashboard
   ↓
PluginManager.updatePlugin('dunemap', guildId, false)
   ↓
1. createPluginBackup() - Backup in backups/plugins/
2. downloadAndInstallUpdate() 
   - Download: https://github.com/.../archive/refs/tags/dunemap-v2.1.0.tar.gz
   - Extraktion: Nur plugins/dunemap/ Ordner
   - Installation: Ersetze altes Plugin
3. runMigration() - Führe migrate_to_v2.1.js aus
4. UPDATE plugin_versions: current_version = 2.1.0
5. PM2 Restart (falls konfiguriert)
   ↓
✅ Update abgeschlossen
```

**Option B: Auto-Update (nach 5 Tagen)**

```
2025-10-14 03:00 Uhr (Deadline erreicht)
   ↓
PluginManager.processAutoUpdates()
   ↓
Findet: dunemap mit update_deadline_at <= NOW()
   ↓
PluginManager.updatePlugin('dunemap', guildId, true)
   ↓
[Gleicher Ablauf wie Option A, aber isAutoUpdate=true]
   ↓
✅ Auto-Update abgeschlossen
```

---

## 👨‍💻 Entwickler-Guide

### Naming Conventions

```bash
# ❌ FALSCH
git tag v2.1.0                    # Core System Update
git tag dunemap_v2.1.0            # Unterstrich statt Bindestrich
git tag DuneMap-v2.1.0            # Großbuchstaben

# ✅ RICHTIG
git tag dunemap-v2.1.0            # Plugin Update (lowercase + Bindestrich)
git tag greeting-v1.5.0           # Anderes Plugin
git tag core-v3.0.0               # Core Plugin
```

### plugin.json Struktur

```json
{
  "name": "dunemap",
  "displayName": "DuneMap",
  "description": "Interaktive Karte für Dune Awakening",
  "version": "2.1.0",               // Semantic Versioning!
  "author": "FireDervil",
  
  "changelog": {
    "2.1.0": [
      "Storm-Timer implementiert",
      "Marker-Limit erhöht"
    ],
    "2.0.0": [
      "Komplettes Redesign",
      "Neue Admin-UI"
    ]
  },
  
  "migrations": {
    "2.1.0": "migrations/migrate_to_v2.1.js",
    "2.0.0": "migrations/migrate_to_v2.js"
  },
  
  "dependencies": {
    "dunebot-core": "^1.0.0"
  }
}
```

### Migration-Scripts Best Practices

```javascript
// plugins/dunemap/migrations/migrate_to_v2.1.js

module.exports = {
    /**
     * Upgrade zu v2.1.0
     * @param {Object} dbService - Datenbank Service
     * @param {string} guildId - Guild ID (für guild-spezifische Updates)
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    async up(dbService, guildId) {
        try {
            // 1. Tabellen-Änderungen
            await dbService.query(`
                ALTER TABLE dunemap_markers 
                ADD COLUMN storm_region VARCHAR(50) DEFAULT NULL
            `);
            
            // 2. Config-Updates (guild-spezifisch)
            await dbService.setConfig(
                'dunemap',
                'storm_timer_enabled',
                true,
                'shared',
                guildId
            );
            
            // 3. Daten-Migration
            await dbService.query(`
                UPDATE dunemap_markers 
                SET storm_region = 'zone1' 
                WHERE x BETWEEN 0 AND 100
            `);
            
            return { success: true };
            
        } catch (error) {
            return { 
                success: false, 
                error: error.message 
            };
        }
    },
    
    /**
     * Rollback zu v2.0.0
     */
    async down(dbService, guildId) {
        try {
            await dbService.query(`
                ALTER TABLE dunemap_markers 
                DROP COLUMN storm_region
            `);
            
            return { success: true };
            
        } catch (error) {
            return { success: false, error: error.message };
        }
    }
};
```

### Testing vor Release

```bash
# 1. DEV Environment testen
cd dunebot_dev
npm run start:dashboard
npm run start:bot

# 2. Migration testen
node -e "
const migration = require('./plugins/dunemap/migrations/migrate_to_v2.1.js');
const dbService = require('./packages/dunebot-db-client');
migration.up(dbService, 'TEST_GUILD_ID').then(console.log);
"

# 3. Rollback testen
# ...

# 4. Erst dann Release erstellen!
```

---

## 👑 Administrator-Guide

### Dashboard Update-Widget

```
┌─────────────────────────────────────────────────────────┐
│ 🔔 PLUGIN UPDATES VERFÜGBAR                            │
├─────────────────────────────────────────────────────────┤
│                                                          │
│ 🗺️  DuneMap                                            │
│     v2.0.0 → v2.1.0                                    │
│     ⏱️  Auto-Update in: 3 Tagen                        │
│     📋 Changelog:                                       │
│        - Storm-Timer implementiert                      │
│        - Marker-Limit erhöht                           │
│     [Jetzt updaten]  [Mehr Infos]                      │
│                                                          │
│ 👋  Greeting                                            │
│     v1.4.0 → v1.5.0                                    │
│     ⏱️  Auto-Update in: 1 Tag                          │
│     📋 Changelog:                                       │
│        - Neue Welcome-Message Vorlagen                 │
│     [Jetzt updaten]  [Mehr Infos]                      │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### Manuelles Update durchführen

1. **Dashboard öffnen:** `https://dunebot.de/guild/GUILD_ID/dashboard`
2. **Update-Widget:** Zeigt verfügbare Updates
3. **"Jetzt updaten" klicken**
4. **Bestätigung:** Modal mit Changelog + Warnung
5. **Update läuft:** Progress-Indikator
6. **Fertig:** Success-Meldung + PM2 Restart Info

### Auto-Update konfigurieren

```sql
-- Auto-Updates global aktivieren/deaktivieren
UPDATE superadmin_config 
SET config_value = 'true' 
WHERE config_key = 'plugin_auto_update_enabled';

-- Grace Period ändern (Tage)
UPDATE superadmin_config 
SET config_value = '7' 
WHERE config_key = 'plugin_update_grace_days';
```

### Update-Historie einsehen

```sql
-- Alle Updates für eine Guild
SELECT 
    plugin_name,
    current_version,
    auto_update_at,
    update_status
FROM plugin_versions
WHERE guild_id = 'YOUR_GUILD_ID'
ORDER BY updated_at DESC;
```

---

## 🔧 API Referenz

### PluginManager Methoden

#### `fetchGitHubReleases()`

Holt alle GitHub Releases des Repositories.

```javascript
const releases = await pluginManager.fetchGitHubReleases();
// Returns: Array<GitHubRelease>
```

#### `getLatestGitHubRelease(pluginName)`

Findet das neueste Release für ein bestimmtes Plugin.

```javascript
const release = await pluginManager.getLatestGitHubRelease('dunemap');
// Returns: GitHubRelease | null
```

**GitHubRelease Object:**
```javascript
{
  tag_name: 'dunemap-v2.1.0',
  name: 'DuneMap v2.1.0',
  body: 'Changelog...',
  published_at: '2025-10-09T12:00:00Z',
  html_url: 'https://github.com/...',
  tarball_url: 'https://api.github.com/...',
  draft: false,
  prerelease: false
}
```

#### `extractVersionFromTag(tagName, pluginName)`

Extrahiert Version aus Release Tag.

```javascript
const version = pluginManager.extractVersionFromTag('dunemap-v2.1.0', 'dunemap');
// Returns: '2.1.0'
```

#### `checkPluginUpdate(pluginName, guildId)`

Prüft ob Update verfügbar ist.

```javascript
await pluginManager.checkPluginUpdate('dunemap', '123456789');
// Creates entry in plugin_versions if update available
```

#### `downloadAndInstallUpdate(pluginName, version, guildId)`

Lädt Update herunter und installiert es.

```javascript
const result = await pluginManager.downloadAndInstallUpdate('dunemap', '2.1.0', '123456789');
// Returns: { success: true } | { success: false, error: 'message' }
```

#### `createPluginBackup(pluginName)`

Erstellt Backup des aktuellen Plugins.

```javascript
const backupPath = await pluginManager.createPluginBackup('dunemap');
// Returns: '/path/to/backups/plugins/dunemap-backup-2025-10-09T12-00-00'
```

#### `rollbackPlugin(pluginName)`

Stellt letztes Backup wieder her.

```javascript
await pluginManager.rollbackPlugin('dunemap');
// Restores most recent backup
```

---

## 🐛 Troubleshooting

### Problem: "Kein GitHub Release gefunden"

**Ursache:** Release Tag Format falsch

```bash
# ❌ Falsch
git tag v2.1.0                # Fehlt Plugin-Name
git tag dunemap_v2.1.0        # Unterstrich statt Bindestrich

# ✅ Richtig
git tag dunemap-v2.1.0
```

**Lösung:**
```bash
# Tag löschen
git tag -d dunemap_v2.1.0
git push origin :refs/tags/dunemap_v2.1.0

# Korrekten Tag erstellen
git tag dunemap-v2.1.0
git push origin dunemap-v2.1.0
```

### Problem: "Update fehlgeschlagen"

**Ursache:** Migration-Script Fehler

**Lösung:**
```bash
# 1. Logs prüfen
tail -f logs/dashboard-YYYY.MM.DD.log | grep PluginManager

# 2. Rollback durchführen
# Im Dashboard: Plugin-Einstellungen → Rollback

# 3. Migration manuell testen
cd dunebot_prod/plugins/dunemap
node migrations/migrate_to_v2.1.js
```

### Problem: GitHub API Rate Limit

**Ursache:** Zu viele API Calls (60/Stunde ohne Token)

**Lösung:**
```bash
# GitHub Personal Access Token erstellen
# https://github.com/settings/tokens

# In .env eintragen
echo "GITHUB_TOKEN=ghp_your_token_here" >> apps/dashboard/.env

# Dashboard neu starten
pm2 restart dunebot-dashboard-prod
```

Mit Token: **5000 Requests/Stunde**

### Problem: "Tarball extraction failed"

**Ursache:** `tar` Package nicht installiert

**Lösung:**
```bash
cd dunebot_prod
npm install tar --save
pm2 restart dunebot-dashboard-prod
```

---

## 📚 Weitere Ressourcen

- **Plugin Development Guide:** `docs/plugin_update_system.md`
- **Migration System:** `docs/migrations.md`
- **GitHub API:** https://docs.github.com/en/rest/releases
- **Semantic Versioning:** https://semver.org/

---

## 🔒 Sicherheit

### Backup-Strategie

```
backups/plugins/
├── dunemap-backup-2025-10-09T12-00-00/
├── dunemap-backup-2025-10-08T15-30-00/
├── dunemap-backup-2025-10-07T09-15-00/
└── greeting-backup-2025-10-09T14-20-00/
```

**Automatische Backups:**
- Vor jedem Update
- Zeitstempel im Ordnernamen
- Komplettes Plugin-Verzeichnis
- Unbegrenzte Aufbewahrung (manuelles Cleanup)

### Rollback-Prozess

```javascript
// Automatisch bei Fehler
try {
    await downloadAndInstallUpdate(...);
} catch (error) {
    await rollbackPlugin(pluginName); // ← Automatisch
}

// Manuell via Dashboard
// Plugins → DuneMap → Rollback → Backup wählen
```

---

## 📊 Monitoring

### Logs

```bash
# Update-Prozess verfolgen
tail -f logs/dashboard-*.log | grep -E "(PluginManager|Update)"

# Beispiel Output:
[PluginManager] Starte täglichen Plugin-Update-Check...
[PluginManager] Update verfügbar: dunemap 2.0.0 → 2.1.0
[PluginManager] Update-Notice erstellt: dunemap (Deadline: 14.10.2025)
[PluginManager] Starte Update: dunemap → v2.1.0
[PluginManager] Backup erstellt: /backups/plugins/dunemap-backup-...
[PluginManager] Download abgeschlossen: /temp/dunemap-2.1.0.tar.gz
[PluginManager] Plugin extrahiert
[PluginManager] Plugin-Dateien aktualisiert
[PluginManager] dunemap erfolgreich aktualisiert auf v2.1.0
```

### Metriken

```sql
-- Update-Statistiken
SELECT 
    update_status,
    COUNT(*) as count
FROM plugin_versions
GROUP BY update_status;

-- Letzte 10 Updates
SELECT 
    plugin_name,
    current_version,
    auto_update_at,
    update_status
FROM plugin_versions
WHERE auto_update_at IS NOT NULL
ORDER BY auto_update_at DESC
LIMIT 10;
```

---

**Ende der Dokumentation**

Bei Fragen: [GitHub Issues](https://github.com/FireDervil77/dunebot/issues)
