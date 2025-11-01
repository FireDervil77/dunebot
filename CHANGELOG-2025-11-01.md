# Changelog - 1. November 2025

## 🎯 Dashboard Access Permission System

### Implementierung eines granularen Zugriffssystems für Dashboard-Benutzer

**Problem:** Benutzer in `guild_users` ohne Discord-Admin-Rechte hatten automatisch vollen Zugriff auf das Dashboard, unabhängig von ihren Berechtigungen.

**Lösung:** Neue `DASHBOARD.ACCESS` Permission wurde implementiert, die explizit für Dashboard-Zugriff erforderlich ist.

### Änderungen im Detail

#### 1. Neue Permission definiert
- **Datei:** `plugins/core/dashboard/permissions.json`
- **Key:** `DASHBOARD.ACCESS`
- **Kategorie:** Dashboard
- **Gefahr-Level:** Nicht kritisch (is_dangerous: 0)
- **Position:** Sort Order 9 (vor Settings-Permissions)

#### 2. Auth Middleware erweitert
- **Datei:** `apps/dashboard/middlewares/auth.middleware.js`
- **Neue Logik:** 
  - Discord Admins/Manager/Owner/BotOwners → Automatischer Bypass
  - guild_staff Einträge → Automatischer Bypass  
  - guild_users OHNE Discord-Rechte → **Muss DASHBOARD.ACCESS haben**
- **Fehlerseite:** 403 mit benutzerfreundlicher Meldung bei fehlender Permission

#### 3. Übersetzungen hinzugefügt
**Deutsch** (`plugins/core/dashboard/locales/de-DE.json`):
```json
"DASHBOARD_ACCESS": "Dashboard-Zugriff",
"DASHBOARD_ACCESS_DESC": "Erlaubt den grundlegenden Zugriff auf das Dashboard"
```

**Englisch** (`plugins/core/dashboard/locales/en-GB.json`):
```json
"DASHBOARD_ACCESS": "Dashboard Access",
"DASHBOARD_ACCESS_DESC": "Allows basic access to the dashboard"
```

#### 4. Migration 6.8.0 erstellt
- **Datei:** `plugins/core/dashboard/migrations/6.8.0-dashboard-access-permission.js`
- **Funktion:** 
  - Fügt bestehenden aktiven `guild_users` automatisch `DASHBOARD.ACCESS` hinzu
  - Konvertiert String `"true"` zu Boolean `true` (Backward Compatibility)
  - Globale Migration (läuft einmal, nicht pro Guild)
- **Rollback:** Entfernt Permission wieder von allen Benutzern

#### 5. Auto-Grant für neue Benutzer
- **Datei:** `plugins/core/dashboard/routes/permissions.router.js` (POST `/users/add-guild-member`)
- **Änderung:** Neue guild_users erhalten automatisch `DASHBOARD.ACCESS` beim Hinzufügen
- **Default Permissions:** `{"DASHBOARD.ACCESS": true}`

#### 6. Manual Seed Script erstellt
- **Datei:** `scripts/add-dashboard-access-permission.js`
- **Zweck:** Einmaliges Hinzufügen der Permission zu allen 9 Guilds
- **Ergebnis:** ✅ 9 Guilds erfolgreich aktualisiert

---

## 🐛 Bug-Fixes

### String "true" statt Boolean true in Permissions

**Problem:** HTML-Checkbox-Values werden als String `"true"` gespeichert, nicht als Boolean `true`.

**Betroffene Bereiche:**
- User Direct Permissions (guild_users)
- Group Permissions (guild_groups)

**Fix 1 - User Route:**
- **Datei:** `plugins/core/dashboard/routes/permissions.router.js` (PUT `/users/:userId`)
- **Lösung:** Konvertierung `value === 'true' || value === true` zu Boolean `true`

**Fix 2 - Group Update:**
- **Datei:** `packages/dunebot-sdk/lib/PermissionManager.js` (`updateGroup()`)
- **Lösung:** Permissions-Objekt wird beim Update durchiteriert und konvertiert

**Code-Beispiel:**
```javascript
const cleanedPerms = {};
Object.keys(direct_permissions).forEach(key => {
    cleanedPerms[key] = direct_permissions[key] === 'true' || direct_permissions[key] === true;
});
```

---

## 🧹 Verwaiste Permissions bereinigt

### Problem: Permissions von inaktiven Plugins in Datenbank

**Diagnose:**
- `greeting` (inaktiv) hatte 6 Permissions in DB
- `moderation` (inaktiv) hatte 8 Permissions in DB
- **Total:** 146 verwaiste Permissions über alle 9 Guilds

**Ursache:** Beim Plugin-Deaktivieren wurden Permissions nicht entfernt.

### Lösung 1: Manual Cleanup
- Script erstellt und ausgeführt
- ✅ **146 verwaiste Permissions** erfolgreich entfernt
- Prüfung: Nur noch Permissions von aktiven Plugins vorhanden

### Lösung 2: Automatisches Cleanup implementiert
- **Datei:** `apps/dashboard/helpers/PluginManager.js` (`disableInGuild()`)
- **Neue Logik:** Bei Plugin-Deaktivierung wird automatisch `permissionManager.unregisterPluginPermissions()` aufgerufen
- **Effekt:** Permissions werden beim Deaktivieren automatisch entfernt

**Code:**
```javascript
// 5. Permissions entfernen
try {
    const permissionManager = ServiceManager.get('permissionManager');
    if (permissionManager) {
        await permissionManager.unregisterPluginPermissions(pluginName, guildId);
        Logger.debug(`Permissions für Plugin ${pluginName} in Guild ${guildId} entfernt`);
    }
} catch (permError) {
    Logger.error(`Fehler beim Entfernen der Permissions für ${pluginName}:`, permError);
}
```

---

## 📊 Statistiken

### Betroffene Dateien (8 total)

**Backend:**
1. `apps/dashboard/middlewares/auth.middleware.js` (Auth-Logik erweitert)
2. `apps/dashboard/helpers/PluginManager.js` (Auto-Cleanup hinzugefügt)
3. `plugins/core/dashboard/routes/permissions.router.js` (String-Konvertierung + Auto-Grant)
4. `packages/dunebot-sdk/lib/PermissionManager.js` (String-Konvertierung)

**Migration & Scripts:**
5. `plugins/core/dashboard/migrations/6.8.0-dashboard-access-permission.js` (NEU)
6. `scripts/add-dashboard-access-permission.js` (NEU - einmalig)

**Locales:**
7. `plugins/core/dashboard/locales/de-DE.json` (Übersetzungen hinzugefügt)
8. `plugins/core/dashboard/locales/en-GB.json` (Übersetzungen hinzugefügt)

**Plugin Manifest:**
9. `plugins/core/plugin.json` (Version 6.7.2 → 6.8.0)
10. `plugins/core/package.json` (Version 6.7.2 → 6.8.0)
11. `plugins/core/dashboard/permissions.json` (DASHBOARD.ACCESS definiert)

### Database Impact

**permission_definitions:**
- ✅ 9 neue Einträge (DASHBOARD.ACCESS für alle Guilds)
- ✅ 146 verwaiste Einträge entfernt

**guild_users:**
- ✅ 10 aktive Users aktualisiert (DASHBOARD.ACCESS hinzugefügt)
- ✅ 1 User korrigiert (String → Boolean)

**plugin_versions:**
- ✅ 9 Guilds auf Core v6.8.0 aktualisiert

---

## 🧪 Testing

### Durchgeführte Tests

✅ **Permission-Konvertierung:**
- String "true" → Boolean true funktioniert
- Bestehende Boolean true bleibt unverändert

✅ **Dashboard Access:**
- Discord Admin → Bypass (funktioniert)
- guild_user MIT Permission → Zugriff (funktioniert)
- guild_user OHNE Permission → 403 Fehler (funktioniert)

✅ **Übersetzungen:**
- DASHBOARD.ACCESS in de-DE → "Dashboard-Zugriff"
- DASHBOARD.ACCESS in en-GB → "Dashboard Access"
- Beide korrekt in `permission_definitions` registriert

✅ **Plugin Lifecycle:**
- Permission-Cleanup bei Plugin-Deaktivierung funktioniert
- Nur aktive Plugins haben Permissions in DB

---

## 🔄 Migration Path

### Fresh Install (v0.0.0 → v6.8.0)
1. Core Plugin Installation
2. Migration 6.7.2: Lädt alle Core Permissions (inkl. DASHBOARD.ACCESS)
3. Migration 6.8.0: Keine User vorhanden → Skip
4. Neue User erhalten automatisch DASHBOARD.ACCESS

### Update (v6.7.2 → v6.8.0)
1. Dashboard-Restart erkennt neue Version
2. Migration 6.8.0 läuft automatisch:
   - Fügt DASHBOARD.ACCESS zu allen aktiven guild_users hinzu
   - Konvertiert String "true" zu Boolean true (falls vorhanden)
3. Neue Permission in `permission_definitions` (via Seed-Script oder Migration 6.7.2 Re-Run)
4. Middleware prüft ab sofort DASHBOARD.ACCESS

---

## 🎓 Lessons Learned

### 1. HTML Checkbox Values sind Strings
**Problem:** `<input type="checkbox" value="true">` sendet String `"true"`, nicht Boolean.
**Lösung:** Backend-Konvertierung mit `value === 'true' || value === true`.

### 2. Plugin Lifecycle muss vollständig sein
**Problem:** `enableInGuild()` registriert Permissions, aber `disableInGuild()` räumt nicht auf.
**Lösung:** Symmetrie in Enable/Disable-Funktionen sicherstellen.

### 3. Permissions sind guild-spezifisch
**Problem:** Migration 6.8.0 sollte global laufen, Plugin-System erwartet aber guild-spezifisch.
**Lösung:** `if (guildId) return {skipped: true}` um nur einmal zu laufen.

### 4. Permission Keys haben KEIN Plugin-Präfix in DB
**Verwirrt:** `permissions.json` definiert "key": "DASHBOARD.ACCESS"
**Gespeichert:** `permission_definitions.permission_key = 'DASHBOARD.ACCESS'` (NICHT "CORE.DASHBOARD.ACCESS")

---

## 📝 Hinweise für Entwickler

### Permission-System Best Practices

**1. Neue Permission hinzufügen:**
```javascript
// In plugins/yourplugin/dashboard/permissions.json
{
  "key": "YOURPLUGIN.FEATURE",  // Plugin-Präfix im Key für Übersichtlichkeit
  "name": "PERMISSIONS.YOURPLUGIN_FEATURE",
  "description": "PERMISSIONS.YOURPLUGIN_FEATURE_DESC",
  "category": "yourplugin",
  "is_dangerous": 0,
  "sort_order": 10
}
```

**2. Übersetzungen nicht vergessen:**
```json
// In plugins/yourplugin/dashboard/locales/de-DE.json
"PERMISSIONS": {
  "YOURPLUGIN_FEATURE": "Feature-Name",
  "YOURPLUGIN_FEATURE_DESC": "Was die Permission erlaubt"
}
```

**3. Permissions werden automatisch registriert:**
- Bei `PluginManager.enableInGuild()` → `registerPluginPermissionsForGuild()`
- Bei `PluginManager.disableInGuild()` → `unregisterPluginPermissions()`

**4. Checkbox-Values immer konvertieren:**
```javascript
// Backend-Route
const cleanedPerms = {};
Object.keys(permissions).forEach(key => {
    cleanedPerms[key] = permissions[key] === 'true' || permissions[key] === true;
});
```

---

## 🚀 Production Deployment

### Pre-Deployment Checklist

- [x] Migration 6.8.0 getestet (Fresh Install + Update)
- [x] String-Konvertierung funktioniert (Users + Groups)
- [x] Übersetzungen vorhanden (de-DE + en-GB)
- [x] Verwaiste Permissions bereinigt
- [x] Auto-Cleanup implementiert
- [x] Dashboard-Neustart ohne Fehler (PM2 #799)
- [x] Alle 9 Guilds auf Core v6.8.0

### Deployment Steps (PROD)

1. Git Pull / Code Sync
2. Dashboard-Neustart via PM2
3. Migration 6.8.0 läuft automatisch
4. Verifizierung:
   - Alle guild_users haben DASHBOARD.ACCESS
   - Nur aktive Plugins haben Permissions
   - Neue Users erhalten Permission automatisch

### Rollback Plan

Falls Probleme auftreten:

```bash
# Migration 6.8.0 zurücksetzen
cd /home/firedervil/dunebot_prod
node -e "
const mysql = require('mysql2/promise');
require('dotenv').config({ path: './apps/dashboard/.env' });

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE
  });
  
  // Migration-Eintrag löschen
  await conn.query(
    'DELETE FROM plugin_migrations WHERE plugin_name = ? AND migration_file LIKE ?',
    ['core', '%6.8.0%']
  );
  
  // Permission aus guild_users entfernen
  const [users] = await conn.query('SELECT user_id, guild_id, direct_permissions FROM guild_users WHERE status = \"active\"');
  for (const user of users) {
    if (!user.direct_permissions) continue;
    const perms = JSON.parse(user.direct_permissions);
    if (perms['DASHBOARD.ACCESS']) {
      delete perms['DASHBOARD.ACCESS'];
      await conn.query('UPDATE guild_users SET direct_permissions = ? WHERE user_id = ? AND guild_id = ?',
        [JSON.stringify(perms), user.user_id, user.guild_id]);
    }
  }
  
  // Permission aus permission_definitions entfernen
  await conn.query('DELETE FROM permission_definitions WHERE permission_key = \"DASHBOARD.ACCESS\"');
  
  // Version zurücksetzen
  await conn.query('UPDATE plugin_versions SET current_version = \"6.7.2\" WHERE plugin_name = \"core\"');
  
  await conn.end();
  console.log('✅ Rollback complete');
})();
"

# Dashboard-Neustart
pm2 restart dunebot-dashboard-prod
```

---

## 🎯 Auswirkungen

### Für Benutzer
- ✅ **Mehr Sicherheit:** Kein automatischer Dashboard-Zugriff mehr
- ✅ **Transparenz:** Berechtigung wird explizit angezeigt
- ✅ **Kein Breaking Change:** Bestehende User behalten Zugriff (Migration)

### Für Admins
- ✅ **Granulare Kontrolle:** Dashboard-Zugriff kann pro User/Gruppe gesteuert werden
- ✅ **Audit-Trail:** Wer hat Zugriff ist jetzt nachvollziehbar
- ✅ **Saubere Datenbank:** Keine verwaisten Permissions mehr

### Für Entwickler
- ✅ **Konsistentes System:** Permissions werden automatisch verwaltet
- ✅ **Best Practices:** String-Konvertierung in Backend, nicht Frontend
- ✅ **Wartbarkeit:** Plugin-Lifecycle ist komplett und symmetrisch

---

## 📌 Version Info

- **Core Plugin:** v6.7.2 → v6.8.0
- **Breaking Changes:** Keine (Backward Compatibility durch Migration)
- **Database Schema:** Keine Änderungen (nur Daten)
- **API Changes:** Keine (interne Verbesserungen)

---

**Autor:** FireDervil + GitHub Copilot  
**Datum:** 1. November 2025  
**Status:** ✅ Production Ready  
**Dashboard Restart:** PM2 #799 (erfolreich)
