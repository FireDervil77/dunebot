# i18n Status - Zusammenfassung
**Stand:** 7. Oktober 2025

## ✅ Vollständig lokalisiert

### DuneMap Plugin
- ✅ Dashboard-Views (dunemap-dashboard.ejs)
- ✅ Admin-Views (dunemap-admin.ejs)
- ✅ Settings (dunemap-settings.ejs)
- ⚠️ JavaScript: Fallback-Texte vorhanden, aber DATA.i18n wird nicht übergeben

### Core Plugin (größtenteils)
- ✅ Settings Views
- ✅ Dashboard Widgets
- ✅ Navigation
- ✅ Common Strings

### Information Plugin
- ✅ Vollständig lokalisiert

---

## 🚨 KRITISCH - Hardcodierte Texte

### SuperAdmin Plugin - News System

#### news.ejs (News-Liste)
```
❌ "News Verwaltung" (Titel)
❌ "Neue News erstellen" (Button)
❌ "Titel", "Autor", "Status", "Datum", "Aktionen" (Tabellen-Header)
❌ "News wirklich löschen?" (Confirm)
❌ "Keine News vorhanden" (Empty State)
```

#### news-edit.ejs (News Editor)
```
❌ "Titel (DE) *" (Label)
❌ "Kurzbeschreibung (DE) *" (Label)
❌ "Autor *" (Label)
❌ "Status *" (Label)
❌ Tab-Namen nicht lokalisiert (siehe Tabs-Problem)
```

#### stats.ejs (SuperAdmin Dashboard)
```
❌ "Detaillierte Übersicht über den Bot-Status"
❌ "Letzte News"
❌ "Plugin Aktivierungen"
❌ Tabellen-Header
```

#### notifications.ejs
```
❌ "Erfolg" (Dropdown)
❌ "Titel *" (Label)
```

#### Widgets
**superadmin-news.ejs:**
```javascript
❌ alert('Fehler beim Speichern!');
❌ confirm('News wirklich löschen?');
```

**superadmin-notifications.ejs:**
```javascript
❌ alert('Fehler beim Senden!');
```

---

## ⚠️ JavaScript Fallback-Texte

### DuneMap (dunemap-admin.js)
**Problem:** Fallback-Texte sind hardcodiert, `DATA.i18n` wird nicht vom Server übergeben!

```javascript
// Zeile 159
showToast('success', result.message || 'Marker hinzugefügt!');

// Zeile 182
showToast('danger', result.message || 'Fehler beim Hinzufügen');

// Zeile 186
showToast('danger', 'Netzwerkfehler');

// Zeile 193
const confirmMsg = DATA?.i18n?.confirmDelete || 'Marker wirklich entfernen?';

// Zeile 207
const successMsg = DATA?.i18n?.success || 'Marker entfernt!';

// Zeile 236
const errorMsg = DATA?.i18n?.error || 'Fehler beim Entfernen';

// Zeile 241
showToast('danger', DATA?.i18n?.error || 'Netzwerkfehler');
```

**Lösung:** AssetManager muss i18n-Strings übergeben!

---

## 📋 Benötigte Translation Keys

### SuperAdmin Plugin

```javascript
// news.ejs
"superadmin:NEWS.TITLE": {
  "de-DE": "News Verwaltung",
  "en-GB": "News Management"
}
"superadmin:NEWS.BTN_NEW": {
  "de-DE": "Neue News erstellen",
  "en-GB": "Create News"
}
"superadmin:NEWS.TABLE.TITLE": {
  "de-DE": "Titel",
  "en-GB": "Title"
}
"superadmin:NEWS.TABLE.AUTHOR": {
  "de-DE": "Autor",
  "en-GB": "Author"
}
"superadmin:NEWS.TABLE.STATUS": {
  "de-DE": "Status",
  "en-GB": "Status"
}
"superadmin:NEWS.TABLE.DATE": {
  "de-DE": "Datum",
  "en-GB": "Date"
}
"superadmin:NEWS.TABLE.ACTIONS": {
  "de-DE": "Aktionen",
  "en-GB": "Actions"
}
"superadmin:NEWS.CONFIRM_DELETE": {
  "de-DE": "News wirklich löschen?",
  "en-GB": "Really delete this news?"
}
"superadmin:NEWS.EMPTY_STATE": {
  "de-DE": "Keine News vorhanden",
  "en-GB": "No news available"
}

// news-edit.ejs
"superadmin:NEWS_EDITOR.TITLE_DE": {
  "de-DE": "Titel (DE) *",
  "en-GB": "Title (DE) *"
}
"superadmin:NEWS_EDITOR.EXCERPT_DE": {
  "de-DE": "Kurzbeschreibung (DE) *",
  "en-GB": "Short description (DE) *"
}
"superadmin:NEWS_EDITOR.AUTHOR": {
  "de-DE": "Autor *",
  "en-GB": "Author *"
}
"superadmin:NEWS_EDITOR.STATUS": {
  "de-DE": "Status *",
  "en-GB": "Status *"
}
"superadmin:NEWS_EDITOR.TAB_DE": {
  "de-DE": "Deutsch",
  "en-GB": "German"
}
"superadmin:NEWS_EDITOR.TAB_EN": {
  "de-DE": "Englisch",
  "en-GB": "English"
}

// stats.ejs
"superadmin:STATS.DESCRIPTION": {
  "de-DE": "Detaillierte Übersicht über den Bot-Status",
  "en-GB": "Detailed overview of bot status"
}
"superadmin:STATS.LATEST_NEWS": {
  "de-DE": "Letzte News",
  "en-GB": "Latest News"
}
"superadmin:STATS.PLUGIN_ACTIVATIONS": {
  "de-DE": "Plugin Aktivierungen",
  "en-GB": "Plugin Activations"
}

// notifications.ejs
"superadmin:NOTIFICATIONS.TYPE_SUCCESS": {
  "de-DE": "Erfolg",
  "en-GB": "Success"
}
"superadmin:NOTIFICATIONS.TITLE": {
  "de-DE": "Titel *",
  "en-GB": "Title *"
}

// JavaScript Alerts/Confirms
"superadmin:NEWS.ERROR_SAVE": {
  "de-DE": "Fehler beim Speichern!",
  "en-GB": "Error saving!"
}
"superadmin:NOTIFICATIONS.ERROR_SEND": {
  "de-DE": "Fehler beim Senden!",
  "en-GB": "Error sending!"
}
```

### DuneMap Plugin (JavaScript i18n)

```javascript
// Für AssetManager localize-Data
"dunemap:ADMIN.JS.MARKER_ADDED": {
  "de-DE": "Marker hinzugefügt!",
  "en-GB": "Marker added!"
}
"dunemap:ADMIN.JS.ERROR_ADD": {
  "de-DE": "Fehler beim Hinzufügen",
  "en-GB": "Error adding marker"
}
"dunemap:ADMIN.JS.NETWORK_ERROR": {
  "de-DE": "Netzwerkfehler",
  "en-GB": "Network error"
}
"dunemap:ADMIN.JS.CONFIRM_DELETE": {
  "de-DE": "Marker wirklich entfernen?",
  "en-GB": "Really remove marker?"
}
"dunemap:ADMIN.JS.MARKER_REMOVED": {
  "de-DE": "Marker entfernt!",
  "en-GB": "Marker removed!"
}
"dunemap:ADMIN.JS.ERROR_REMOVE": {
  "de-DE": "Fehler beim Entfernen",
  "en-GB": "Error removing marker"
}
```

---

## 🎯 Priorisierung

### Phase 1: SuperAdmin News (2-3h)
1. ✅ Translation Keys erstellen
2. ✅ news.ejs lokalisieren
3. ✅ news-edit.ejs lokalisieren + Tabs fixen
4. ✅ JavaScript-Alerts ersetzen

### Phase 2: SuperAdmin Rest (1-2h)
1. ✅ stats.ejs lokalisieren
2. ✅ notifications.ejs lokalisieren
3. ✅ Widgets lokalisieren

### Phase 3: DuneMap JavaScript i18n (1h)
1. ✅ AssetManager localize-Data implementieren
2. ✅ Fallback-Texte entfernen
3. ✅ Confirm-Dialoge modernisieren

### Phase 4: Testing (1h)
1. ✅ Alle Seiten in beiden Sprachen testen
2. ✅ JavaScript-Funktionen testen
3. ✅ Fehlende Keys dokumentieren

---

## 📊 Statistik

| Status | Anzahl | Prozent |
|--------|--------|---------|
| ✅ Lokalisiert | ~1700 Keys | ~85% |
| ⚠️ Fallbacks | ~10 Keys | ~5% |
| ❌ Hardcodiert | ~25 Texte | ~10% |

**Gesamt geschätzte Arbeitszeit: 5-7 Stunden**

---

## 🔧 Technische Notizen

### AssetManager i18n-Data Übergabe
```javascript
// In Plugin-Route (z.B. dunemap/index.js)
assetManager.registerScript('dunemap-admin-data', 'js/dunemap-admin.js', {
  plugin: 'dunemap',
  inFooter: true,
  localize: {
    guildId: guildId,
    markers: markers,
    ajaxUrl: `/guild/${guildId}/plugins/dunemap/admin/marker`,
    i18n: {
      markerAdded: req.t('dunemap:ADMIN.JS.MARKER_ADDED'),
      errorAdd: req.t('dunemap:ADMIN.JS.ERROR_ADD'),
      networkError: req.t('dunemap:ADMIN.JS.NETWORK_ERROR'),
      confirmDelete: req.t('dunemap:ADMIN.JS.CONFIRM_DELETE'),
      markerRemoved: req.t('dunemap:ADMIN.JS.MARKER_REMOVED'),
      errorRemove: req.t('dunemap:ADMIN.JS.ERROR_REMOVE')
    }
  }
});
```

### Confirm-Dialoge modernisieren
```javascript
// ALT:
onsubmit="return confirm('News wirklich löschen?');"

// NEU:
onsubmit="return confirm('<%= tr('superadmin:NEWS.CONFIRM_DELETE') %>');"
```

### Alert durch Toast ersetzen
```javascript
// ALT:
alert('Fehler beim Speichern!');

// NEU (wenn Alpine.js verfügbar):
Alpine.store('toast').show(
  '<%= tr("superadmin:NEWS.ERROR_SAVE") %>', 
  'error'
);

// ODER (vanilla JS mit globalem Toast):
window.showToast('error', '<%= tr("superadmin:NEWS.ERROR_SAVE") %>');
```
