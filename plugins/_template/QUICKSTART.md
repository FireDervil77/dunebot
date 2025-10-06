# 🚀 DuneBot Plugin Quickstart

**Erstellen Sie Ihr erstes DuneBot-Plugin in 5 Minuten!**

## Schritt 1: Template kopieren

```bash
# Terminal öffnen im DuneBot-Root-Verzeichnis
cd /pfad/zu/dunebot

# Template kopieren
cp -r plugins/_template plugins/mein-plugin

# In neues Plugin-Verzeichnis wechseln
cd plugins/mein-plugin
```

## Schritt 2: Plugin-Namen anpassen

### 2.1 package.json bearbeiten
```json
{
  "name": "mein-plugin",
  "version": "1.0.0",
  "displayName": "Mein Erstes Plugin",
  "description": "Mein erstes DuneBot-Plugin",
  "author": "Dein Name"
}
```

### 2.2 bot/index.js anpassen
```javascript
// Zeile 24-31: Plugin-Info ändern
super({
    name: 'mein-plugin',              // ← Ändern
    displayName: 'Mein Plugin',       // ← Ändern
    description: 'Beschreibung',      // ← Ändern
    version: '1.0.0',
    author: 'Dein Name',              // ← Ändern
    icon: 'fa-solid fa-star',         // ← Icon wählen
    baseDir: __dirname,
    ownerOnly: false
});
```

### 2.3 dashboard/index.js anpassen
```javascript
// Zeile 24-31: Plugin-Info ändern
super({
    name: 'mein-plugin',              // ← Ändern
    displayName: 'Mein Plugin',       // ← Ändern
    description: 'Beschreibung',      // ← Ändern
    version: '1.0.0',
    author: 'Dein Name',              // ← Ändern
    icon: 'fa-solid fa-star',         // ← Icon wählen
    baseDir: __dirname
});
```

## Schritt 3: Einfachen Command erstellen

### 3.1 Command-Datei erstellen
```bash
# Erstelle: bot/commands/slash/hallo.js
```

### 3.2 Command-Code
```javascript
const { EmbedUtils } = require("dunebot-sdk/utils");

module.exports = {
    name: "hallo",
    description: "mein-plugin:HALLO.DESCRIPTION",
    
    slashCommand: {
        enabled: true,
        ephemeral: false,
        options: []
    },

    async interactionRun({ interaction }) {
        const embed = EmbedUtils.embed()
            .setTitle('👋 Hallo!')
            .setDescription(`Hallo ${interaction.user.username}!`)
            .setColor('#00ff00');

        await interaction.followUp({ embeds: [embed] });
    }
};
```

### 3.3 Übersetzung hinzufügen
```javascript
// bot/locales/de-DE.json
{
    "TITLE": "Mein Plugin",
    "DESCRIPTION": "Mein erstes Plugin",
    
    "HALLO": {
        "DESCRIPTION": "Sagt Hallo"
    }
}
```

## Schritt 4: Dashboard-Seite erstellen

### 4.1 View-Datei erstellen
```bash
# Erstelle: dashboard/views/index.ejs
```

### 4.2 View-Code
```html
<div class="container-fluid">
    <div class="row">
        <div class="col-12">
            <div class="card">
                <div class="card-header">
                    <h3 class="card-title">
                        <i class="fa-solid fa-star me-2"></i>
                        Mein Plugin Dashboard
                    </h3>
                </div>
                <div class="card-body">
                    <h4>Willkommen!</h4>
                    <p>Dies ist dein erstes Plugin-Dashboard.</p>
                    
                    <div class="alert alert-success">
                        <i class="fa-solid fa-check-circle me-2"></i>
                        Plugin erfolgreich erstellt!
                    </div>
                </div>
            </div>
        </div>
    </div>
</div>
```

### 4.3 Route aktivieren (bereits in dashboard/index.js)
Die Route ist bereits im Template vorhanden. Sie wird automatisch unter:
`/guild/:guildId/mein-plugin` verfügbar sein.

## Schritt 5: Datenbank-Schema (Optional)

### 5.1 Schema bearbeiten
```sql
-- bot/schemas/tables.sql
CREATE TABLE IF NOT EXISTS mein_plugin_data (
    id INT AUTO_INCREMENT PRIMARY KEY,
    guild_id VARCHAR(20) NOT NULL,
    user_id VARCHAR(20) NOT NULL,
    nachricht TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_guild_id (guild_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

## Schritt 6: Plugin aktivieren

### 6.1 In Registry eintragen
```json
// plugins/registry.json
{
  "plugins": {
    "mein-plugin": {
      "enabled": true,
      "path": "./mein-plugin"
    }
  }
}
```

### 6.2 Bot & Dashboard neu starten
```bash
# Im Root-Verzeichnis
pm2 restart all

# Oder nur DEV
pm2 restart dunebot-dashboard-dev dunebot-bot-dev
```

## Schritt 7: Plugin testen

### 7.1 Bot-Command testen
1. Öffne Discord
2. Tippe `/hallo` in einen Kanal
3. Der Bot sollte mit einem Embed antworten

### 7.2 Dashboard testen
1. Öffne `http://localhost:3001`
2. Wähle einen Server
3. Navigation: "Mein Plugin" sollte sichtbar sein
4. Klicke darauf → Dein Dashboard wird angezeigt

## 🎉 Fertig!

Du hast dein erstes DuneBot-Plugin erstellt!

## 📚 Nächste Schritte

### Commands erweitern
- Füge Command-Optionen hinzu
- Nutze Datenbank-Operationen
- Implementiere Berechtigungsprüfungen

### Dashboard verbessern
- Erstelle Widgets
- Füge Settings-Seite hinzu
- Nutze IPC für Bot-Daten

### Fortgeschrittene Features
- Events implementieren
- Hooks nutzen
- Context-Menus erstellen
- Custom Assets (CSS/JS) hinzufügen

## 💡 Tipps

### Debugging
```javascript
const Logger = ServiceManager.get('Logger');
Logger.debug('[MeinPlugin] Debug-Nachricht');
Logger.info('[MeinPlugin] Info');
Logger.error('[MeinPlugin] Fehler:', error);
```

### Datenbank-Zugriff
```javascript
const dbService = ServiceManager.get('dbService');

// Daten abrufen
const [rows] = await dbService.query(
    'SELECT * FROM mein_plugin_data WHERE guild_id = ?',
    [guildId]
);

// Konfiguration speichern
await dbService.setConfig('mein-plugin', 'setting', 'wert', 'bot', guildId);
```

### IPC Bot ↔ Dashboard
```javascript
// Dashboard → Bot
const ipcClient = ServiceManager.get('ipcClient');
const result = await ipcClient.sendTo('Bot #0', {
    action: 'mein-plugin:GET_DATA',
    guildId
});
```

## 🆘 Hilfe

### Häufige Fehler

**Plugin wird nicht geladen:**
- Prüfe `plugins/registry.json`
- Prüfe Logs: `tail -f logs/dashboard-*.log`
- Stelle sicher, dass `index.js` exportiert: `{ bot, dashboard }`

**Command erscheint nicht:**
- Warte 1-2 Minuten (Discord Sync)
- Prüfe `slashCommand.enabled: true`
- Kicke Bot und lade ihn neu ein

**Dashboard-Seite nicht erreichbar:**
- Prüfe ob Route in `_setupRoutes()` registriert ist
- Prüfe Navigation in `onGuildEnable()`
- Prüfe Browser-Konsole auf Fehler

### Weitere Ressourcen

- 📖 [README.md](./README.md) - Vollständige Dokumentation
- 🔧 [Copilot Instructions](../../.github/copilot-instructions.md)
- 💬 Discord-Support: [DuneBot Server](#)

---

**Viel Erfolg bei der Plugin-Entwicklung! 🚀**
