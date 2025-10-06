# 🌍 Internationalisierung (i18n) - Übersetzungs-Todo

## Status-Übersicht

**Aktuelles Problem**: Viele Views haben hardcodierte deutsche Texte statt `tr()` zu verwenden.

**Ziel**: Alle Texte in DE + EN übersetzen für 21 Server mit ~480 Membern.

---

## 1. Core Plugin - Übersetzungen

### Dashboard-Locales vorhanden?
- [x] ✅ Prüfen: `/plugins/core/dashboard/locales/de-DE.json` existiert
- [x] ✅ Prüfen: `/plugins/core/dashboard/locales/en-GB.json` existiert
- [x] ✅ Erweitert um SETTINGS.GENERAL, SETTINGS.HELP, SETTINGS.STATUS

### Views die übersetzt werden müssen:

#### `/plugins/core/dashboard/views/guild/`
- [ ] **dashboard.ejs** - Guild-Dashboard (Übersicht)
  - "Willkommen zurück"
  - "Server-Übersicht"
  - "Schnellzugriffe"
  - Widget-Titel

- [ ] **settings.ejs** - Settings-Übersicht
  - "Einstellungen"
  - "Konfiguriere deinen Bot"
  - Alle Karten-Titel und Beschreibungen

#### `/plugins/core/dashboard/views/guild/settings/`
- [x] ✅ **general.ejs** - Allgemeine Einstellungen
  ```
  ERLEDIGT - Alle Texte übersetzt:
  ✅ "Grundkonfiguration" → tr('SETTINGS.GENERAL.TITLE')
  ✅ "Bot-Präfix" → tr('SETTINGS.GENERAL.PREFIX_LABEL')
  ✅ "Das Präfix für Text-Befehle" → tr('SETTINGS.GENERAL.PREFIX_HELP')
  ✅ "Standard-Sprache" → tr('SETTINGS.GENERAL.LOCALE_LABEL')
  ✅ "Die Standard-Sprache für Bot-Antworten" → tr('SETTINGS.GENERAL.LOCALE_HELP')
  ✅ "Dashboard-Theme" → tr('SETTINGS.GENERAL.THEME_LABEL')
  ✅ "Slash-Commands" → tr('SETTINGS.GENERAL.SLASH_LABEL')
  ✅ "Slash-Commands aktivieren/deaktivieren" → tr('SETTINGS.GENERAL.SLASH_HELP')
  ✅ "Erweiterte Logs" → tr('SETTINGS.GENERAL.VERBOSE_LABEL')
  ✅ "Debug-Modus" → tr('SETTINGS.GENERAL.DEBUG_LABEL')
  ✅ "Zurücksetzen" → tr('SETTINGS.GENERAL.RESET_BTN')
  ✅ "Einstellungen speichern" → tr('SETTINGS.GENERAL.SAVE_BTN')
  ✅ Hilfe-Card komplett übersetzt
  ✅ Status-Card komplett übersetzt
  ```

- [ ] **users.ejs** - Benutzer-Verwaltung
  ```
  Hardcoded Texte:
  - "Benutzer-Verwaltung"
  - "Berechtigungen & Rollen"
  - "Mitglied"
  - "Rolle"
  - "Berechtigung"
  - "Aktionen"
  ```

- [ ] **integrations.ejs** - Integrationen
  ```
  Hardcoded Texte:
  - "Integrationen"
  - "Externe Dienste & APIs"
  - "Webhook-URL"
  - "API-Key"
  - "Status"
  - "Verbunden" / "Nicht verbunden"
  ```

#### Widgets
- [ ] **widgets/stats-widget.ejs** - Statistik-Widget
- [ ] **widgets/quick-actions.ejs** - Schnellaktionen-Widget

---

## 2. SuperAdmin Plugin - Übersetzungen

### Dashboard-Locales erstellen
- [ ] **ERSTELLEN**: `/plugins/superadmin/dashboard/locales/de-DE.json`
- [ ] **ERSTELLEN**: `/plugins/superadmin/dashboard/locales/en-GB.json`

### Views die übersetzt werden müssen:

#### `/plugins/superadmin/dashboard/views/guild/`
- [ ] **plugins.ejs** - Plugin-Verwaltung
  ```
  Hardcoded Texte:
  - "Plugin-Verwaltung"
  - "Verfügbare Plugins"
  - "Aktivierte Plugins"
  - "Deaktivierte Plugins"
  - "Plugin aktivieren"
  - "Plugin deaktivieren"
  - "Einstellungen"
  - "Autor"
  - "Version"
  - "Beschreibung"
  - "Keine Plugins verfügbar"
  ```

- [ ] **locales.ejs** - Übersetzungs-Editor (von Core hierher verschoben)
  ```
  Hardcoded Texte:
  - "Übersetzungen"
  - "Sprache wählen"
  - "Übersetzungsschlüssel"
  - "Übersetzter Text"
  - "Speichern"
  - "Zurücksetzen"
  ```

---

## 3. DuneMap Plugin - Übersetzungen

### Dashboard-Locales erstellen
- [ ] **ERSTELLEN**: `/plugins/dunemap/dashboard/locales/de-DE.json`
- [ ] **ERSTELLEN**: `/plugins/dunemap/dashboard/locales/en-GB.json`

### Views die übersetzt werden müssen:

#### `/plugins/dunemap/dashboard/views/guild/`
- [ ] **dunemap-dashboard.ejs** - DuneMap Übersicht
  ```
  Hardcoded Texte:
  - "DuneMap Übersicht"
  - "Verfügbare Commands"
  - "Marker setzen"
  - "Storm-Timer setzen"
  - "Karte anzeigen"
  - "Letzte Marker"
  - "Sektor"
  - "Typ"
  - "Gesetzt von"
  - "Datum"
  - "Keine Marker vorhanden"
  ```

- [ ] **dunemap-settings.ejs** - DuneMap Einstellungen
  ```
  Hardcoded Texte:
  - "DuneMap Einstellungen"
  - "Storm-Timer Format"
  - "Zeitzone"
  - "Storm-Dauer"
  - "Map-Channel"
  - "Kanal auswählen"
  - "Einstellungen speichern"
  ```

- [ ] **dunemap-admin.ejs** - Sektor-Karte Verwaltung
  ```
  Hardcoded Texte:
  - "Sektor-Karte verwalten"
  - "Marker hinzufügen"
  - "Marker entfernen"
  - "Marker-Typ wählen"
  - "Sektor auswählen"
  - "Speichern"
  - "Abbrechen"
  ```

---

## 4. Information Plugin - Übersetzungen

### Dashboard-Locales vorhanden?
- [ ] Prüfen: `/plugins/information/dashboard/locales/` existiert?
- [ ] Ggf. erstellen für DE + EN

### Views prüfen
- [ ] Alle Information-Plugin Views auf hardcodierte Texte prüfen

---

## 5. Navigation-Titel

### Core Plugin Navigation
```javascript
// In /plugins/core/dashboard/index.js
await navigationManager.registerNavigation(this.name, guildId, [
    {
        title: 'Dashboard',           // → tr('NAV.DASHBOARD')
        path: `/guild/${guildId}`,
        icon: 'fa-solid fa-house'
    },
    {
        title: 'Einstellungen',       // → tr('NAV.SETTINGS')
        path: `/guild/${guildId}/plugins/core/settings`,
        icon: 'fa-solid fa-cog'
    },
    {
        title: 'Allgemein',           // → tr('NAV.SETTINGS.GENERAL')
        parent: `/guild/${guildId}/plugins/core/settings`
    }
]);
```

- [ ] **ÄNDERN**: Core-Navigation auf `tr()` umstellen
- [ ] **TESTEN**: Navigation zeigt übersetzte Titel an

### SuperAdmin Plugin Navigation
```javascript
{
    title: 'SuperAdmin',              // → tr('NAV.SUPERADMIN')
    title: 'Plugins',                 // → tr('NAV.PLUGINS')
    title: 'Übersetzungen'            // → tr('NAV.TRANSLATIONS')
}
```

- [ ] **ÄNDERN**: SuperAdmin-Navigation auf `tr()` umstellen

### DuneMap Plugin Navigation
```javascript
{
    title: 'DuneMap',                 // → tr('NAV.DUNEMAP')
    title: 'Sektor-Karte',            // → tr('NAV.SECTOR_MAP')
    title: 'DuneMap' (Settings)       // → tr('NAV.DUNEMAP_SETTINGS')
}
```

- [ ] **ÄNDERN**: DuneMap-Navigation auf `tr()` umstellen

---

## 6. Theme-Partials (Shared zwischen Plugins)

### Frontend-Partials
- [ ] **header_nav.ejs** - "Login", "Register", "Dashboard"
- [ ] **footer.ejs** - Copyright, Links

### Guild-Partials
- [ ] **header_topbar.ejs** - "Zum Dashboard", "Profil", "Logout"
- [ ] **sidebar.ejs** - Navigation-Labels (werden von Navigation-Manager geholt)

---

## 7. Locale-File-Struktur

### Beispiel: `/plugins/core/dashboard/locales/de-DE.json`

```json
{
  "NAV": {
    "DASHBOARD": "Dashboard",
    "SETTINGS": "Einstellungen",
    "SETTINGS_GENERAL": "Allgemein",
    "SETTINGS_USERS": "Benutzer",
    "SETTINGS_INTEGRATIONS": "Integrationen"
  },
  "DASHBOARD": {
    "WELCOME": "Willkommen zurück",
    "SERVER_OVERVIEW": "Server-Übersicht",
    "QUICK_ACTIONS": "Schnellzugriffe"
  },
  "SETTINGS": {
    "GENERAL": {
      "TITLE": "Grundkonfiguration",
      "PREFIX_LABEL": "Bot-Präfix",
      "PREFIX_HELP": "Das Präfix für Text-Befehle (z.B. !help, !ping)",
      "LOCALE_LABEL": "Standard-Sprache",
      "LOCALE_HELP": "Die Standard-Sprache für Bot-Antworten und Dashboard-Inhalte",
      "THEME_LABEL": "Dashboard-Theme",
      "THEME_HELP": "Wähle ein Theme für das Dashboard",
      "SLASH_LABEL": "Slash-Commands",
      "SLASH_HELP": "Slash-Commands aktivieren/deaktivieren",
      "SAVE_BTN": "Einstellungen speichern"
    },
    "USERS": {
      "TITLE": "Benutzer-Verwaltung",
      "SUBTITLE": "Berechtigungen & Rollen",
      "MEMBER": "Mitglied",
      "ROLE": "Rolle",
      "PERMISSION": "Berechtigung",
      "ACTIONS": "Aktionen"
    },
    "INTEGRATIONS": {
      "TITLE": "Integrationen",
      "SUBTITLE": "Externe Dienste & APIs",
      "WEBHOOK_URL": "Webhook-URL",
      "API_KEY": "API-Key",
      "STATUS": "Status",
      "CONNECTED": "Verbunden",
      "DISCONNECTED": "Nicht verbunden"
    }
  },
  "COMMON": {
    "SAVE": "Speichern",
    "CANCEL": "Abbrechen",
    "DELETE": "Löschen",
    "EDIT": "Bearbeiten",
    "LOADING": "Lädt...",
    "SUCCESS": "Erfolgreich gespeichert",
    "ERROR": "Fehler beim Speichern"
  }
}
```

### Beispiel: `/plugins/core/dashboard/locales/en-GB.json`

```json
{
  "NAV": {
    "DASHBOARD": "Dashboard",
    "SETTINGS": "Settings",
    "SETTINGS_GENERAL": "General",
    "SETTINGS_USERS": "Users",
    "SETTINGS_INTEGRATIONS": "Integrations"
  },
  "DASHBOARD": {
    "WELCOME": "Welcome back",
    "SERVER_OVERVIEW": "Server Overview",
    "QUICK_ACTIONS": "Quick Actions"
  },
  "SETTINGS": {
    "GENERAL": {
      "TITLE": "Basic Configuration",
      "PREFIX_LABEL": "Bot Prefix",
      "PREFIX_HELP": "The prefix for text commands (e.g. !help, !ping)",
      "LOCALE_LABEL": "Default Language",
      "LOCALE_HELP": "The default language for bot responses and dashboard content",
      "THEME_LABEL": "Dashboard Theme",
      "THEME_HELP": "Choose a theme for the dashboard",
      "SLASH_LABEL": "Slash Commands",
      "SLASH_HELP": "Enable/disable slash commands",
      "SAVE_BTN": "Save Settings"
    },
    "USERS": {
      "TITLE": "User Management",
      "SUBTITLE": "Permissions & Roles",
      "MEMBER": "Member",
      "ROLE": "Role",
      "PERMISSION": "Permission",
      "ACTIONS": "Actions"
    },
    "INTEGRATIONS": {
      "TITLE": "Integrations",
      "SUBTITLE": "External Services & APIs",
      "WEBHOOK_URL": "Webhook URL",
      "API_KEY": "API Key",
      "STATUS": "Status",
      "CONNECTED": "Connected",
      "DISCONNECTED": "Disconnected"
    }
  },
  "COMMON": {
    "SAVE": "Save",
    "CANCEL": "Cancel",
    "DELETE": "Delete",
    "EDIT": "Edit",
    "LOADING": "Loading...",
    "SUCCESS": "Successfully saved",
    "ERROR": "Error while saving"
  }
}
```

---

## 8. Implementation-Workflow

### Schritt 1: Locale-Files erstellen
1. Für jedes Plugin `locales/` Ordner erstellen (falls nicht vorhanden)
2. `de-DE.json` mit allen deutschen Texten erstellen
3. `en-GB.json` mit englischen Übersetzungen erstellen

### Schritt 2: Views anpassen
1. Alle hardcodierte Texte identifizieren
2. Durch `<%= tr('KEY.SUBKEY') %>` ersetzen
3. Testen ob Übersetzung funktioniert

### Schritt 3: Navigation anpassen
1. In `_registerNavigation()` Methode `title` durch `tr()` ersetzen
2. NavigationManager muss `tr()` unterstützen (prüfen!)

### Schritt 4: Testing
1. Sprache im Dashboard auf EN umstellen
2. Alle Seiten durchgehen
3. Fehlende Übersetzungen ergänzen

---

## 9. Priorisierung (nach Nutzungs-Häufigkeit)

### High Priority (80% der User sehen das)
1. ✅ **Core - Dashboard** (Startseite)
2. ✅ **Core - Settings/General** (Bot-Präfix, Sprache)
3. ✅ **Navigation** (alle Plugin-Menüs)

### Medium Priority (50% der User)
4. ⚠️ **SuperAdmin - Plugins** (nur Owner)
5. ⚠️ **DuneMap - Dashboard** (nur aktive Server)

### Low Priority (20% der User)
6. 🔵 **Settings - Users** (selten genutzt)
7. 🔵 **Settings - Integrations** (selten genutzt)
8. 🔵 **SuperAdmin - Locales** (nur Owner)

---

## 10. Nächste Schritte

1. **Phase 1**: Core-Plugin Settings/General ✅ **ERLEDIGT** (2025-10-04)
   - [x] ✅ Locale-Files erweitert (DE + EN)
   - [x] ✅ `settings/general.ejs` komplett übersetzt
   - [x] ✅ Alle hardcoded Texte durch `tr()` ersetzt
   - [x] ✅ Nach DEV deployed
   - [x] ✅ Dashboard neu gestartet
   - [ ] **TESTEN**: Sprache auf EN umstellen und prüfen

2. **Phase 2**: SuperAdmin-Plugin übersetzen
   - [ ] Locale-Files erstellen
   - [ ] `plugins.ejs` anpassen
   - [ ] `locales.ejs` anpassen

3. **Phase 3**: DuneMap-Plugin übersetzen
   - [ ] Locale-Files erstellen
   - [ ] Alle Views anpassen

4. **Phase 4**: Testing & Refinement
   - [ ] EN-Locale testen
   - [ ] Fehlende Keys ergänzen
   - [ ] User-Feedback einholen

---

## 11. Technische Fragen

- [ ] **NavigationManager**: Unterstützt der bereits `tr()` in Navigation-Titles?
- [ ] **ThemeManager**: Wird Locale automatisch an alle Views übergeben?
- [ ] **i18n-Service**: Ist `tr()` in allen EJS-Views verfügbar?
- [ ] **Fallback**: Was passiert wenn Key fehlt? (Zeigt Key-Name?)

---

## 12. Geschätzte Arbeitszeit

- **Core Plugin**: ~4 Stunden (viele Views)
- **SuperAdmin Plugin**: ~2 Stunden (wenige Views)
- **DuneMap Plugin**: ~3 Stunden (mittel-komplex)
- **Navigation**: ~1 Stunde
- **Testing**: ~2 Stunden

**Total**: ~12 Stunden für vollständige DE + EN Übersetzung

---

**Erstellt am**: 2025-10-04  
**Status**: Planning  
**Ziel**: Alle Dashboard-Views in DE + EN verfügbar für 21 Server / 480 Member
