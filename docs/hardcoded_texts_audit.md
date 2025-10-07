# Hardcodierte Texte - Audit Report
**Datum:** 7. Oktober 2025  
**Projekt:** DuneBot Dashboard & Plugins

## 🔍 Gefundene hardcodierte Texte die lokalisiert werden sollten

### 🚨 KRITISCH - SuperAdmin Plugin

#### 1. **news.ejs** - News Verwaltung
**Datei:** `/plugins/superadmin/dashboard/views/guild/news.ejs`

| Zeile | Deutscher Text | Kontext |
|-------|----------------|---------|
| 10 | "News Verwaltung" | Seitentitel |
| 14 | "Neue News erstellen" | Button-Text |
| 27 | "Titel" | Tabellen-Header |
| 28 | "Autor" | Tabellen-Header |
| 29 | "Status" | Tabellen-Header |
| 30 | "Datum" | Tabellen-Header |
| 31 | "Aktionen" | Tabellen-Header |
| 56 | "News wirklich löschen?" | Confirm-Dialog |
| 68 | "Keine News vorhanden" | Empty-State |

**Empfohlene Keys:**
```
superadmin:NEWS.TITLE = "News Management" / "News Verwaltung"
superadmin:NEWS.BTN_NEW = "Create News" / "Neue News erstellen"
superadmin:NEWS.TABLE.TITLE = "Title" / "Titel"
superadmin:NEWS.TABLE.AUTHOR = "Author" / "Autor"
superadmin:NEWS.TABLE.STATUS = "Status" / "Status"
superadmin:NEWS.TABLE.DATE = "Date" / "Datum"
superadmin:NEWS.TABLE.ACTIONS = "Actions" / "Aktionen"
superadmin:NEWS.CONFIRM_DELETE = "Really delete this news?" / "News wirklich löschen?"
superadmin:NEWS.EMPTY_STATE = "No news available" / "Keine News vorhanden"
```

---

#### 2. **news-edit.ejs** - News Editor
**Datei:** `/plugins/superadmin/dashboard/views/guild/news-edit.ejs`

| Zeile | Deutscher Text | Kontext |
|-------|----------------|---------|
| 82 | "Titel (DE) *" | Form-Label |
| 92 | "Kurzbeschreibung (DE) *" | Form-Label |
| 177 | "Autor *" | Form-Label |
| 202 | "Status *" | Form-Label |

**Problem:** Labels sind bereits multi-language (DE/EN Tabs), aber die **Tab-Namen selbst** sind hardcodiert!

---

#### 3. **stats.ejs** - SuperAdmin Stats
**Datei:** `/plugins/superadmin/dashboard/views/guild/stats.ejs`

| Zeile | Deutscher Text | Kontext |
|-------|----------------|---------|
| 11 | "Detaillierte Übersicht über den Bot-Status" | Beschreibung |
| 141 | "Letzte News" | Überschrift |
| 149 | "Titel" | Tabellen-Header |
| 150 | "Status" | Tabellen-Header |
| 182 | "Plugin Aktivierungen" | Überschrift |
| 191 | "Aktivierungen" | Tabellen-Header |

---

#### 4. **notifications.ejs** - Benachrichtigungen
**Datei:** `/plugins/superadmin/dashboard/views/guild/notifications.ejs`

| Zeile | Deutscher Text | Kontext |
|-------|----------------|---------|
| 29 | "Erfolg" | Dropdown-Option |
| 37 | "Titel *" | Form-Label |

---

#### 5. **Widgets** - SuperAdmin Dashboard Widgets

**superadmin-notifications.ejs:**
- Zeile 4: "Titel" (Label)
- Zeile 18: "Erfolg" (Option)
- Zeile 67: "Fehler beim Senden!" (Alert)

**superadmin-news.ejs:**
- Zeile 52: "Titel" (Label)
- Zeile 64: "Autor" (Label)
- Zeile 77: "Kurzbeschreibung" (Label)
- Zeile 92: "Status" (Label)
- Zeile 147: "Fehler beim Speichern!" (Alert)
- Zeile 152: "News wirklich löschen?" (Confirm)

---

### ⚠️ MITTEL - Core Plugin

#### **settings/general.ejs** - Allgemeine Einstellungen
**Bereits größtenteils lokalisiert**, aber:
- Status-Badges verwenden dynamische Klassen (`text-success`) ohne i18n

---

### ℹ️ NIEDRIG - Information Plugin

**Keine kritischen hardcodierten Texte gefunden** (Plugin scheint gut lokalisiert)

---

## 📊 Zusammenfassung

### Nach Plugin:

| Plugin | Hardcodierte Texte | Priorität |
|--------|-------------------|-----------|
| **superadmin** | ~25+ Texte | 🚨 KRITISCH |
| **core** | ~5 Texte | ⚠️ MITTEL |
| **dunemap** | ✅ Lokalisiert | ✅ OK |
| **information** | ✅ Lokalisiert | ✅ OK |

### Nach Dateityp:

| Typ | Anzahl | Beispiele |
|-----|--------|-----------|
| **Table Headers** | ~10 | "Titel", "Autor", "Status", "Datum", "Aktionen" |
| **Form Labels** | ~8 | "Titel *", "Autor *", "Kurzbeschreibung" |
| **Buttons** | ~5 | "Neue News erstellen", "Speichern" |
| **Alerts/Confirms** | ~4 | "News wirklich löschen?", "Fehler beim Senden!" |
| **Empty States** | ~2 | "Keine News vorhanden" |
| **Page Titles** | ~3 | "News Verwaltung", "Plugin Aktivierungen" |

---

## 🎯 Empfohlene Aktionen

### Phase 1: SuperAdmin News System (PRIO 1)
1. `news.ejs` - Tabelle & Actions lokalisieren
2. `news-edit.ejs` - Tabs & Labels lokalisieren
3. `superadmin-news.ejs` - Widget lokalisieren
4. Confirm-Dialoge durch i18n ersetzen

### Phase 2: SuperAdmin Rest (PRIO 2)
1. `stats.ejs` - Überschriften lokalisieren
2. `notifications.ejs` - Formular lokalisieren
3. `superadmin-notifications.ejs` - Widget lokalisieren

### Phase 3: JavaScript Alerts (PRIO 3)
1. Alle `alert()` durch Toast-System ersetzen
2. Alle `confirm()` durch Modal-Dialoge ersetzen

---

## 📝 Notizen

- **Status-Werte** (`published`, `draft`) sollten **NICHT** lokalisiert werden (DB-Werte)
- **CSS-Klassen** (`text-success`, `bg-warning`) sind technisch, kein i18n nötig
- **Datumsformate** bereits lokalisiert via `toLocaleDateString()`
- **SuperAdmin** ist das **einzige Plugin** mit massiven hardcodierten Texten

---

## 🔧 Technische Hinweise

### Confirm-Dialoge ersetzen:
```javascript
// ALT (hardcodiert):
onsubmit="return confirm('News wirklich löschen?');"

// NEU (lokalisiert):
onsubmit="return confirm('<%= tr('superadmin:NEWS.CONFIRM_DELETE') %>');"
```

### Alert-Dialoge ersetzen:
```javascript
// ALT (hardcodiert):
alert('Fehler beim Senden!');

// NEU (Toast):
Alpine.store('toast').show(i18n.t('superadmin:NOTIFICATIONS.ERROR_SEND'), 'error');
```

### Tab-Navigation (News Editor):
```html
<!-- ALT (Buttons - hardcodiert): -->
<button>Deutsch</button>
<button>English</button>

<!-- NEU (Bootstrap Tabs - lokalisiert): -->
<ul class="nav nav-tabs">
  <li class="nav-item">
    <a class="nav-link active" data-bs-toggle="tab" href="#de">
      <%= tr('LANG_DE') %>
    </a>
  </li>
  <li class="nav-item">
    <a class="nav-link" data-bs-toggle="tab" href="#en">
      <%= tr('LANG_EN') %>
    </a>
  </li>
</ul>
```

---

**Geschätzte Arbeitszeit:**
- Phase 1: ~2-3 Stunden
- Phase 2: ~1-2 Stunden
- Phase 3: ~1 Stunde

**Total: ~4-6 Stunden**
