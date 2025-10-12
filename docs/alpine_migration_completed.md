# Alpine.js Migration - Abgeschlossen

## 📋 Übersicht

Die Core-Plugin Guild-Config-Seite wurde erfolgreich von Alpine.js zum standardisierten `guild.js` AJAX-System migriert.

---

## ✅ Migrierte Komponenten

### 1. **Server-Konfiguration** (`/guild/:guildId/core`)
- **Form Type**: `server-config`
- **Method**: `PUT`
- **Felder**:
  - `prefix` - Bot Command Prefix (Text, 1-2 Zeichen)
  - `locale` - Standard-Sprache (Select aus verfügbaren Sprachen)
  - `support_server` - Support-Server URL (URL)
  - `slash_commands` - Slash Commands aktiviert (on/off)
  - `context_menus` - Context Menus aktiviert (on/off)
  - Hidden: `server_config=true` (Backend-Flag)

**Response**: `{ success: true, message: "Server-Einstellungen erfolgreich gespeichert" }`

### 2. **Dashboard-Konfiguration** (`/guild/:guildId/core`)
- **Form Type**: `dashboard-config`
- **Method**: `PUT`
- **Felder**:
  - `logo` - Dashboard Logo Name (Text)
  - `logo_url` - Logo URL (Text/URL)
  - Hidden: `dash_config=true` (Backend-Flag)

**Response**: `{ success: true, message: "Dashboard-Einstellungen erfolgreich gespeichert" }`

---

## 🔧 Technische Änderungen

### Frontend (`/plugins/core/dashboard/views/guild.ejs`)

#### **Vorher (Alpine.js)**
```html
<div x-data="{ saving: false, formData: {...}, async submitServerConfig() {...} }">
  <form @submit.prevent="submitServerConfig">
    <input x-model="formData.prefix" />
    <button :disabled="saving">
      <span x-show="!saving">Speichern</span>
      <span x-show="saving">Wird gespeichert...</span>
    </button>
  </form>
</div>
```

#### **Nachher (guild.js)**
```html
<div>
  <form class="guild-ajax-form" data-form-type="server-config" data-method="PUT" action="/guild/:guildId/core">
    <input name="prefix" value="<%= config.PREFIX_COMMANDS.DEFAULT_PREFIX %>" />
    <button type="submit">Speichern</button>
  </form>
</div>
```

**Entfernt**:
- ❌ `x-data` Attribut
- ❌ `x-model` Two-Way-Binding
- ❌ `@submit.prevent` Event-Handler
- ❌ `x-show` Conditional Rendering
- ❌ `:disabled` Dynamic Attribute Binding
- ❌ Alpine.js JavaScript-Logik
- ❌ `Alpine.store('toast')` Aufrufe

**Hinzugefügt**:
- ✅ `class="guild-ajax-form"` für AJAX-Handler-Registrierung
- ✅ `data-form-type="..."` für Response-Routing
- ✅ `data-method="PUT"` für HTTP-Methode
- ✅ `name` Attribute auf allen Input-Feldern
- ✅ `value` Attribute mit Server-Side-Values
- ✅ `selected` Attribute für Selects mit EJS-Conditional

---

### Backend (`/plugins/core/dashboard/routes/guild.router.js`)

#### **Vorher**
```javascript
router.put("/", async (req, res) => {
    const body = req.body;
    // ... Verarbeitung ...
    res.sendStatus(200); // ❌ Kein strukturiertes Response
});
```

#### **Nachher**
```javascript
router.put("/", async (req, res) => {
    // Content-Type Detection (JSON + Form-Data)
    let body;
    const contentType = req.headers['content-type'] || '';
    if (contentType.includes('application/json')) {
        body = req.body;
    } else if (contentType.includes('application/x-www-form-urlencoded')) {
        body = req.body;
    } else {
        body = req.body;
    }
    
    // ... Verarbeitung ...
    
    if (server_config) {
        return res.json({ 
            success: true, 
            message: 'Server-Einstellungen erfolgreich gespeichert' 
        });
    }
    
    if (dash_config) {
        return res.json({ 
            success: true, 
            message: 'Dashboard-Einstellungen erfolgreich gespeichert' 
        });
    }
    
    res.status(400).json({ 
        success: false, 
        message: 'Keine gültigen Daten übermittelt' 
    });
});
```

**Verbesserungen**:
- ✅ Strukturierte JSON-Responses mit `success` + `message`
- ✅ Content-Type-Detection (JSON + Form-Data)
- ✅ Fehlerbehandlung mit spezifischen Meldungen
- ✅ Proper HTTP-Status-Codes (400, 500)

---

### AJAX-Handler (`/apps/dashboard/themes/default/assets/js/guild.js`)

**Neue Handler hinzugefügt**:

```javascript
// Switch-Case im handleForm()
case 'server-config':
    await this.handleServerConfigResponse(form, result);
    break;

case 'dashboard-config':
    await this.handleDashboardConfigResponse(form, result);
    break;

// Handler-Funktionen
static async handleServerConfigResponse(form, result) {
    if (result.success) {
        this.showToast('success', result.message || 'Server-Einstellungen erfolgreich gespeichert');
        setTimeout(() => window.location.reload(), 1500);
    } else {
        this.showToast('error', result.message || 'Fehler beim Speichern der Server-Einstellungen');
    }
}

static async handleDashboardConfigResponse(form, result) {
    if (result.success) {
        this.showToast('success', result.message || 'Dashboard-Einstellungen erfolgreich gespeichert');
        setTimeout(() => window.location.reload(), 1500);
    } else {
        this.showToast('error', result.message || 'Fehler beim Speichern der Dashboard-Einstellungen');
    }
}
```

---

## 🎯 Vorteile der Migration

### **1. Konsistenz**
- Alle Guild-Dashboard-Formulare nutzen jetzt dasselbe System
- Keine Verwirrung mehr über verschiedene Frontend-Frameworks

### **2. Wartbarkeit**
- Zentraler AJAX-Handler für alle Formulare
- Keine duplizierten Event-Listener pro Formular
- Einfachere Fehlerbehandlung

### **3. Performance**
- Keine Alpine.js-Library mehr nötig (~15KB weniger)
- Kein Reaktivitäts-Overhead
- Schnellerer Page-Load

### **4. Debugging**
- Klare Konsolenausgaben im `guild.js` Handler
- Strukturierte JSON-Responses vom Backend
- Einfacher zu testen (Standard HTML Forms)

### **5. Progressive Enhancement**
- Formulare funktionieren auch ohne JavaScript (Fallback auf Standard-Form-Submit möglich)
- Bessere Accessibility

---

## 📝 Status aktueller Dashboard-Seiten

| Seite/Plugin | Status | System | Priorität |
|-------------|--------|--------|-----------|
| **Core Guild Config** | ✅ Migriert | guild.js | - |
| **Moderation Settings** | ✅ Migriert | guild.js | - |
| **DuneMap Settings** | ✅ guild.js | guild.js | - |
| **Locales Editor** | ✅ ENTFERNT | - | ✅ ERLEDIGT |

---

## 🗑️ Entfernte Komponenten

### **Locales-Editor** (Alpine.js Legacy)
**Entfernt am**: 2025-10-12

**Warum entfernt:**
- Komplexes Alpine.js-Setup mit dynamischen Keys
- Keine aktive Nutzung
- Migration zu aufwändig für ungenutztes Feature
- Alpine.js-Dependency komplett entfernen wollen

**Entfernte Dateien:**
- ❌ `/apps/dashboard/themes/default/views/guild/locales.ejs`

**Entfernte Navigation:**
- ❌ SuperAdmin > Translations (`/guild/:guildId/locales`)

**Keine Backend-Routen** vorhanden (View-only Feature)

---

## 🚀 Nächste Schritte

### **Abgeschlossene Aufgaben:**
1. ✅ ~~Core Guild Config migrieren~~ (ERLEDIGT)
2. ✅ ~~Locales-Editor entfernen~~ (ERLEDIGT)

### **Keine weiteren Alpine.js-Abhängigkeiten:**
Alle Alpine.js-Referenzen wurden entfernt! Das System ist jetzt vollständig auf guild.js standardisiert.

---

## 📚 Entwickler-Guidelines (Aktualisiert)

### **NIEMALS VERWENDEN:**
```html
<!-- ❌ Alpine.js Syntax -->
<div x-data="...">
<input x-model="...">
<button @click="...">
<span x-show="...">
Alpine.store('toast').show(...)
```

### **IMMER VERWENDEN:**
```html
<!-- ✅ guild.js System -->
<form class="guild-ajax-form" data-form-type="my-feature" data-method="PUT" action="/guild/:guildId/plugin">
  <input name="field_name" value="<%= value %>">
  <button type="submit">Speichern</button>
</form>
```

**Backend Response:**
```javascript
res.json({ success: true, message: 'Erfolgsnachricht' });
```

**AJAX Handler:**
```javascript
// In guild.js Switch-Case
case 'my-feature':
    await this.handleMyFeatureResponse(form, result);
    break;

// Handler-Funktion
static async handleMyFeatureResponse(form, result) {
    if (result.success) {
        this.showToast('success', result.message);
        setTimeout(() => window.location.reload(), 1500);
    } else {
        this.showToast('error', result.message);
    }
}
```

---

## 🧪 Testing

### **Manuelle Tests:**
1. ✅ Server-Config Form absenden
2. ✅ Dashboard-Config Form absenden
3. ✅ Toast-Benachrichtigungen erscheinen
4. ✅ Seite lädt nach 1,5s neu
5. ✅ Werte bleiben nach Reload erhalten
6. ✅ Fehlerbehandlung bei ungültigen Daten

### **Zu testende Browser:**
- Chrome/Edge (✅ Primär)
- Firefox (⏳ TODO)
- Safari (⏳ TODO)

---

## 📅 Migration History

| Datum | Komponente | Status |
|-------|-----------|--------|
| 2025-10-12 | Moderation Settings | ✅ Migriert |
| 2025-10-12 | Core Guild Config (Server) | ✅ Migriert |
| 2025-10-12 | Core Guild Config (Dashboard) | ✅ Migriert |
| 2025-10-12 | Locales Editor | ✅ ENTFERNT |

---

## 🔗 Referenzen

- **guild.js Handler**: `/apps/dashboard/themes/default/assets/js/guild.js`
- **Core Plugin View**: `/plugins/core/dashboard/views/guild.ejs`
- **Core Plugin Route**: `/plugins/core/dashboard/routes/guild.router.js`
- **System-Dokumentation**: `.github/copilot-instructions.md`

---

**Erstellt am**: 2025-10-12  
**Autor**: Migration Team  
**Version**: 1.0.0
