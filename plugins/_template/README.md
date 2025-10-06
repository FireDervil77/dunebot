# 🧩 DuneBot Template Plugin

Ein vollständiges Template-Plugin für die Entwicklung neuer DuneBot-Plugins. Dieses Template zeigt Best Practices, grundlegende Strukturen und enthält ausführlich dokumentierte Beispiele.

## 📋 Inhaltsverzeichnis

- [Übersicht](#übersicht)
- [Features](#features)
- [Installation](#installation)
- [Struktur](#struktur)
- [Entwicklung](#entwicklung)
- [Konfiguration](#konfiguration)
- [API](#api)
- [Beispiele](#beispiele)

## 🎯 Übersicht

Das Template-Plugin demonstriert:
- ✅ Bot-Commands (Slash & Message)
- ✅ Discord Events
- ✅ IPC-Kommunikation Bot ↔ Dashboard
- ✅ Dashboard-Routen & Views
- ✅ Widgets für das Guild-Dashboard
- ✅ Datenbank-Integration
- ✅ i18n-Lokalisierung
- ✅ Hook-System
- ✅ Asset-Verwaltung (CSS, JS, Images)

## ⚡ Features

### Bot-Features
- **Commands**: Slash-Commands und Message-Commands
- **Events**: Discord.js Event-Handler
- **Context Menus**: Rechtsklick-Menüs für User/Messages
- **IPC**: Kommunikation mit dem Dashboard
- **Database**: SQL-Schema und Models
- **Localization**: Mehrsprachige Übersetzungen

### Dashboard-Features
- **Routen**: Express.js Routen für Guild-Bereich
- **Views**: EJS-Templates für UI
- **Widgets**: Dashboard-Widgets für Übersichten
- **Navigation**: Automatische Menü-Registrierung
- **API**: REST-Endpunkte für Frontend
- **Assets**: Custom CSS/JS für Plugin-UI

## 📦 Installation

### 1. Plugin kopieren
```bash
# Template kopieren
cp -r plugins/_template plugins/mein-plugin

# In Plugin-Verzeichnis wechseln
cd plugins/mein-plugin
```

### 2. Plugin anpassen
```bash
# Suchen und ersetzen: 'template' → 'mein-plugin'
# Dateien bearbeiten:
# - package.json
# - config.json
# - bot/index.js
# - dashboard/index.js
```

### 3. Dependencies installieren
```bash
npm install
```

### 4. Plugin aktivieren
```bash
# Im DuneBot-Root-Verzeichnis
npm run enable-plugin mein-plugin
```

## 📁 Struktur

```
_template/
├── bot/                      # Bot-Teil des Plugins
│   ├── commands/
│   │   ├── slash/           # Slash-Commands
│   │   ├── message/         # Message-Commands
│   │   └── shared/          # Gemeinsame Funktionen
│   ├── contexts/            # Context-Menu Commands
│   ├── events/              # Discord Event Handler
│   │   └── ipc/            # IPC Event Handler
│   ├── locales/            # Bot-Übersetzungen
│   ├── schemas/            # Datenbank-Schemas
│   └── index.js            # Bot-Plugin Hauptdatei
│
├── dashboard/               # Dashboard-Teil des Plugins
│   ├── locales/            # Dashboard-Übersetzungen
│   ├── public/             # Öffentliche Assets
│   │   ├── css/           # Stylesheets
│   │   ├── js/            # JavaScript
│   │   └── images/        # Bilder
│   ├── views/              # EJS-Templates
│   │   └── widgets/       # Dashboard-Widgets
│   └── index.js           # Dashboard-Plugin Hauptdatei
│
├── shared/                  # Gemeinsame Komponenten
│   ├── constants.js        # Konstanten
│   └── utils.js           # Utility-Funktionen
│
├── config.json             # Plugin-Konfiguration
├── package.json            # NPM-Package-Info
├── index.js               # Plugin Entry Point
├── README.md              # Diese Datei
└── QUICKSTART.md          # Schnellstart-Anleitung
```

## 🔧 Entwicklung

### Bot-Command erstellen

```javascript
// bot/commands/slash/meinCommand.js
const { ApplicationCommandOptionType } = require('discord.js');

module.exports = {
    name: "meincommand",
    description: "mein-plugin:COMMAND.DESCRIPTION",
    
    slashCommand: {
        enabled: true,
        options: [
            {
                name: "option",
                description: "Eine Option",
                type: ApplicationCommandOptionType.String,
                required: true
            }
        ]
    },
    
    async interactionRun({ interaction }) {
        await interaction.followUp({
            content: interaction.guild.getT('mein-plugin:COMMAND.SUCCESS')
        });
    }
};
```

### Dashboard-Route erstellen

```javascript
// dashboard/index.js
this.guildRouter.get('/meine-seite', async (req, res) => {
    const guildId = res.locals.guildId;
    const themeManager = ServiceManager.get('themeManager');
    
    res.render('meineSite', {
        title: req.translate('mein-plugin:PAGE.TITLE'),
        layout: themeManager.getLayout('guild')
    });
});
```

### Widget registrieren

```javascript
// dashboard/index.js
_registerWidgets() {
    const hooks = ServiceManager.get('hooks');
    
    hooks.addFilter('guild_dashboard_widgets', (widgets, guildId) => {
        widgets.push({
            id: 'mein-widget',
            title: 'Mein Widget',
            view: 'widgets/meinWidget',
            plugin: 'mein-plugin',
            order: 100,
            width: 6
        });
        return widgets;
    });
}
```

### Datenbank nutzen

```javascript
const dbService = ServiceManager.get('dbService');

// Daten speichern
await dbService.query(
    'INSERT INTO mein_plugin_data (guild_id, data) VALUES (?, ?)',
    [guildId, JSON.stringify(data)]
);

// Konfiguration setzen
await dbService.setConfig('mein-plugin', 'setting', 'value', 'bot', guildId);

// Konfiguration lesen
const value = await dbService.getConfig('mein-plugin', 'setting', 'bot', guildId);
```

## ⚙️ Konfiguration

### config.json

```json
{
  "enabled": true,           // Plugin aktiv
  "autoLoad": false,         // Beim Start automatisch laden
  "permissions": {
    "bot": ["SEND_MESSAGES"],
    "dashboard": ["MANAGE_GUILD"]
  },
  "settings": {
    "logLevel": "info"
  }
}
```

### package.json

```json
{
  "name": "mein-plugin",
  "version": "1.0.0",
  "displayName": "Mein Plugin",
  "description": "Beschreibung",
  "author": "Ihr Name",
  "dependencies": {
    "dunebot-sdk": "*"
  }
}
```

## 📚 API

### Bot Plugin Lifecycle

```javascript
class MeinBotPlugin extends BotPlugin {
    async onEnable(client) {
        // Plugin global aktiviert
    }
    
    async onDisable(client) {
        // Plugin global deaktiviert
    }
    
    async onGuildEnable(guildId) {
        // Plugin für Guild aktiviert
    }
    
    async onGuildDisable(guildId) {
        // Plugin für Guild deaktiviert
    }
    
    registerHooks(hooks) {
        // Hooks registrieren
    }
}
```

### Dashboard Plugin Lifecycle

```javascript
class MeinDashboardPlugin extends DashboardPlugin {
    async enable() {
        // Plugin aktiviert
    }
    
    async disable() {
        // Plugin deaktiviert
    }
    
    async onGuildEnable(guildId) {
        // Navigation registrieren
        await this._registerNavigation(guildId);
    }
    
    async onGuildDisable(guildId) {
        // Aufräumen
    }
}
```

## 💡 Beispiele

### IPC-Kommunikation

**Bot (events/ipc/getData.js):**
```javascript
module.exports = {
    name: 'mein-plugin:GET_DATA',
    async execute(client, { guildId }) {
        const guild = client.guilds.cache.get(guildId);
        return {
            success: true,
            data: { memberCount: guild.memberCount }
        };
    }
};
```

**Dashboard:**
```javascript
const ipcClient = ServiceManager.get('ipcClient');
const result = await ipcClient.sendTo('Bot #0', {
    action: 'mein-plugin:GET_DATA',
    guildId
});
```

### Hooks verwenden

```javascript
const hooks = ServiceManager.get('hooks');

// Action Hook (keine Rückgabe)
hooks.addAction('after_command_run', (commandName, guildId) => {
    console.log(`Command ${commandName} wurde ausgeführt`);
});

// Filter Hook (modifiziert Daten)
hooks.addFilter('command_response', (response, commandName) => {
    return response + ' - Modified';
});
```

## 🌍 Lokalisierung

**Übersetzungen hinzufügen:**

```json
// bot/locales/de-DE.json
{
    "COMMAND": {
        "DESCRIPTION": "Beschreibung des Commands",
        "SUCCESS": "Erfolgreich ausgeführt"
    }
}
```

**Verwendung:**
```javascript
// Im Bot
guild.getT('mein-plugin:COMMAND.SUCCESS')

// Im Dashboard
req.translate('mein-plugin:COMMAND.SUCCESS')
tr('mein-plugin:COMMAND.SUCCESS')
```

## 📖 Weitere Ressourcen

- [DuneBot SDK Dokumentation](../../packages/dunebot-sdk/README.md)
- [Plugin-Entwicklung Guide](../../docs/plugin-development.md)
- [Copilot Instructions](../../.github/copilot-instructions.md)
- [QUICKSTART.md](./QUICKSTART.md)

## 📝 Lizenz

MIT License - Siehe LICENSE Datei

## 👨‍💻 Autor

DuneBot Team
- GitHub: [@firedervil77](https://github.com/firedervil77)
- Repository: [dunebot](https://github.com/firedervil77/dunebot)

---

**Hinweis**: Dieses Template ist für Entwicklungszwecke gedacht. Löschen Sie die `_template` Dateien nicht aus dem Repository, da sie als Referenz dienen.
