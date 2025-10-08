# Toast Notification System - Dokumentation

## 🔔 Übersicht

Das **Toast Notification Center** ist ein vollständiges Benachrichtigungssystem für das DuneBot Dashboard. Es besteht aus:

1. **Globales Toast-System** - Einheitliche API für Toasts über alle Plugins
2. **Toast-Logger** - Speichert kritische Toasts (error/warning) in Session/DB
3. **Notification Center** - Glocken-Icon in der Navbar mit Dropdown
4. **Toast-History Page** - Vollständige History für Superadmins

---

## 📦 Komponenten

### 1. Globales Toast-System

**Dateien:**
- `apps/dashboard/themes/default/assets/js/global-toast.js`
- Eingebunden in: `apps/dashboard/themes/default/views/layouts/guild.ejs`

**API:**
```javascript
// Einfache Toasts
showToast('success', 'Nachricht');
showToast('error', 'Fehler aufgetreten');
showToast('warning', 'Warnung!');
showToast('info', 'Information');

// Shortcuts
showSuccess('Gespeichert!');
showError('Fehler!');
showWarning('Achtung!');
showInfo('Hinweis');

// Mit Optionen
showError('Fehler beim Speichern', {
    title: 'Speicherfehler',
    timeOut: 0,  // Dauerhaft anzeigen
    metadata: {  // Für Server-Logging
        action: 'saveSettings',
        pluginName: 'greeting',
        details: { ... }
    }
});

// Promise-Handling
showToastForPromise(fetchPromise, {
    success: 'Erfolgreich!',
    error: 'Fehlgeschlagen'
});
```

**Features:**
- ✅ **I18n-Support**: Nutzt `window.i18n.TOAST_MESSAGES` für Übersetzungen
- ✅ **Auto-Logging**: `error` und `warning` werden automatisch an Server geloggt
- ✅ **Metadata**: Zusätzliche Debug-Infos mitschicken
- ✅ **Events**: Feuert `toastShown` Event für Notification Center

---

### 2. Toast-Logger Backend

**Dateien:**
- `plugins/core/dashboard/routes/api/toast-logger.js`
- Registriert in: `plugins/core/dashboard/index.js`

**Endpoints:**

#### POST `/api/core/toasts/log`
Loggt einen Toast-Event (wird automatisch von `global-toast.js` aufgerufen).

**Request Body:**
```json
{
    "type": "error",
    "message": "Fehler beim Speichern",
    "timestamp": "2025-10-08T12:00:00.000Z",
    "url": "/guild/123/plugins/greeting",
    "guildId": "123456789",
    "userAgent": "Mozilla/5.0...",
    "metadata": {
        "action": "saveSettings",
        "error": "Connection timeout"
    }
}
```

**Response:**
```json
{
    "success": true,
    "logged": true,
    "savedToSession": true,
    "savedToDb": false
}
```

**Speicherung:**
- **Session**: Letzte 50 kritische Toasts pro User (In-Memory)
- **Logs**: Alle Toasts strukturiert in Pino-Logs (ELK-Stack ready)
- **DB** (optional): Setze `TOAST_LOGGER_DB=true` in `.env`

#### GET `/api/core/toasts/history`
Gibt Toast-History der aktuellen Session zurück.

**Response:**
```json
{
    "success": true,
    "count": 5,
    "toasts": [
        {
            "type": "error",
            "message": "Fehler beim Speichern",
            "timestamp": "2025-10-08T12:00:00.000Z",
            "url": "/guild/123/plugins/greeting",
            "guildId": "123456789",
            "userId": "user123",
            "username": "FireDervil",
            "metadata": { ... }
        }
    ]
}
```

---

### 3. Notification Center (Navbar)

**Dateien:**
- `apps/dashboard/themes/default/partials/guild/header_topbar.ejs`
- `apps/dashboard/themes/default/assets/js/toast-notification-center.js`

**Features:**
- 🔔 **Glocken-Icon** in der Navbar
- 🔴 **Badge** mit Anzahl kritischer Toasts (error + warning)
- 📋 **Dropdown** mit letzten 5 Toasts
- ⚡ **Auto-Refresh** alle 30 Sekunden
- 💫 **Puls-Animation** bei neuen Toasts
- 🔗 **"Alle anzeigen"** Link zur Toast-History Page

**UI-Elemente:**
```html
<!-- Badge zeigt Anzahl -->
<span class="badge badge-danger" id="toastNotificationBadge">3</span>

<!-- Dropdown-Liste -->
<div id="toastNotificationList">
    <!-- Dynamisch generiert -->
</div>
```

**Konfiguration:**
```javascript
// In toast-notification-center.js
const REFRESH_INTERVAL = 30000; // 30 Sekunden
const MAX_DISPLAY_TOASTS = 5;   // Max. Toasts im Dropdown
```

---

### 4. Toast-History Page (Für alle User)

**Dateien:**
- `plugins/core/dashboard/views/guild/toast-history.ejs`
- `plugins/core/dashboard/index.js` (Route registriert)

**Route:**
```
/guild/{guildId}/plugins/core/toast-history
```

**API:**
```
GET /api/core/toasts/history
```

**Features:**
- 📊 **User-spezifisch**: Jeder User sieht nur seine eigenen Toasts
- 🔍 **Filter**: Typ (Error/Warning), URL
- � **Details-Button**: Zeigt Metadata als JSON
- 🎨 **Benutzerfreundlich**: Vereinfachte Darstellung, deutsche Beschriftungen
- ✅ **Für alle verfügbar**: Nicht nur für Superadmins

**Session-basiert:**
Zeigt die letzten 50 kritischen Toasts (error + warning) aus `req.session.toastHistory`.
Keine DB-Abfrage nötig - sehr schnell!

---

## 🗄️ Datenbank (Optional)

### Tabelle aktivieren

In `apps/dashboard/.env`:
```env
TOAST_LOGGER_DB=true
```

### Schema

```sql
CREATE TABLE toast_events (
    id INT AUTO_INCREMENT PRIMARY KEY,
    type VARCHAR(20) NOT NULL,
    message TEXT NOT NULL,
    user_id VARCHAR(100),
    username VARCHAR(100),
    guild_id VARCHAR(100),
    url VARCHAR(500),
    user_agent TEXT,
    metadata JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_type (type),
    INDEX idx_user (user_id),
    INDEX idx_guild (guild_id),
    INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

**Automatische Erstellung**: Tabelle wird beim ersten Toast-Log automatisch erstellt.

---

## 🎨 Customization

### Toast-Optionen anpassen

In `global-toast.js`:
```javascript
toastr.options = {
    closeButton: true,
    debug: false,
    newestOnTop: true,
    progressBar: true,
    positionClass: 'toast-top-right',  // Position ändern
    timeOut: '5000',                    // Anzeigedauer
    extendedTimeOut: '1000',
    showMethod: 'fadeIn',
    hideMethod: 'fadeOut'
};
```

### Badge-Farbe ändern

In `header_topbar.ejs`:
```html
<!-- Rot für Fehler -->
<span class="badge badge-danger" id="toastNotificationBadge">...</span>

<!-- Gelb für Warnungen -->
<span class="badge badge-warning" id="toastNotificationBadge">...</span>
```

### Notification Center Position

In `header_topbar.ejs`:
```html
<!-- Rechts-Dropdown -->
<ul class="dropdown-menu dropdown-menu-right">

<!-- Links-Dropdown -->
<ul class="dropdown-menu dropdown-menu-left">
```

---

## 🔧 Migration bestehender Plugins

### Vorher (Plugin-spezifisch):
```javascript
if (typeof window.toastr !== 'undefined') {
    toastr.success('Gespeichert!');
} else {
    alert('Gespeichert!');
}
```

### Nachher (Global):
```javascript
showSuccess('Gespeichert!');
```

### Mit Metadata für Debugging:
```javascript
showError('Fehler beim Speichern', {
    metadata: { 
        action: 'saveGreeting', 
        type: 'welcome',
        error: error.toString() 
    }
});
```

---

## 📊 Monitoring & Debugging

### Session-History abrufen
```javascript
// In Browser-Console
fetch('/api/core/toasts/history')
    .then(r => r.json())
    .then(data => console.table(data.toasts));
```

### Server-Logs prüfen
```bash
# Strukturierte Toast-Logs
pm2 logs dunebot-dashboard-dev | grep "client_toast"

# Nur Errors
pm2 logs dunebot-dashboard-dev | grep "client_toast.*error"
```

### Datenbank-Abfrage (wenn aktiviert)
```sql
-- Letzte 20 Fehler
SELECT * FROM toast_events 
WHERE type = 'error' 
ORDER BY created_at DESC 
LIMIT 20;

-- Toasts pro User
SELECT username, COUNT(*) as count, type
FROM toast_events
GROUP BY username, type
ORDER BY count DESC;

-- Toasts der letzten Stunde
SELECT * FROM toast_events
WHERE created_at >= NOW() - INTERVAL 1 HOUR
ORDER BY created_at DESC;
```

---

## 🚀 Best Practices

### 1. Aussagekräftige Messages
```javascript
// ❌ Schlecht
showError('Fehler!');

// ✅ Gut
showError('Fehler beim Speichern der Willkommensnachricht');
```

### 2. Metadata für Debugging
```javascript
showError('API-Fehler', {
    metadata: {
        endpoint: '/api/greeting/save',
        statusCode: 500,
        response: errorData
    }
});
```

### 3. I18n verwenden
```javascript
// In de-DE.json
"TOAST_MESSAGES": {
    "GREETING_SAVED": "Begrüßung erfolgreich gespeichert"
}

// Im Code
showSuccess('GREETING_SAVED');  // Wird automatisch übersetzt
```

### 4. Promise-Handling
```javascript
const promise = fetch('/api/...')
    .then(r => r.json());

showToastForPromise(promise, {
    success: 'SETTINGS_SAVED',
    error: 'SETTINGS_ERROR'
});
```

---

## 🔐 Sicherheit

- ✅ **XSS-Schutz**: Messages werden escaped
- ✅ **Session-basiert**: Toast-History pro User isoliert
- ✅ **Superadmin-Check**: DB-History nur für Owner
- ✅ **Rate-Limiting**: Kann bei Bedarf aktiviert werden

---

## 📝 Changelog

### v1.0.0 (2025-10-08)
- ✅ Globales Toast-System implementiert
- ✅ Toast-Logger Backend mit Session-Storage
- ✅ Notification Center in Navbar
- ✅ Toast-History Page für Superadmins
- ✅ DB-Logging (optional)
- ✅ I18n-Support (de-DE, en-GB)
- ✅ Auto-Refresh und Live-Updates

---

## 🎯 Roadmap

### Geplante Features:
- [ ] **Modal-View** für Toast-Details (statt Alert)
- [ ] **Filter in Navbar** (nur errors/warnings/all)
- [ ] **Desktop-Notifications** (Browser-API)
- [ ] **Toast-Kategorien** (System, Plugin, User-Action)
- [ ] **Retention Policy** (Auto-Delete nach X Tagen)
- [ ] **Export-Funktion** (CSV/JSON für Analyse)
- [ ] **Webhook-Integration** (Discord/Slack bei kritischen Errors)

---

## 📚 Weitere Ressourcen

- **Toastr Docs**: https://github.com/CodeSeven/toastr
- **Bootstrap Icons**: https://icons.getbootstrap.com/
- **AdminLTE**: https://adminlte.io/themes/v3/

---

**Viel Erfolg mit dem Toast Notification System! 🎉**
