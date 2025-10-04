# 🧩 Template Plugin für DuneBot

Dieses Plugin dient als **Vorlage** für neue DuneBot-Plugins und demonstriert alle Best Practices.

## 📋 Setup-Anleitung

### 1. Plugin kopieren
```bash
cp -r plugins/_template plugins/mein-plugin
cd plugins/mein-plugin
```

### 2. Namen ersetzen
Suche & Ersetze in **ALLEN Dateien**:
- `template` → `meinplugin` (lowercase)
- `Template` → `MeinPlugin` (PascalCase)
- `TEMPLATE` → `MEINPLUGIN` (UPPERCASE)

### 3. Metadaten anpassen
- `package.json` → name, description, author
- `config.json` → displayName, description, icon
- `bot/index.js` → constructor-Metadaten
- `dashboard/index.js` → constructor-Metadaten

### 4. Commands erstellen
- Lösche Beispiel-Commands in `bot/commands/`
- Erstelle deine eigenen Commands nach dem Pattern
- Slash-Commands → `bot/commands/slash/`
- Message-Commands → `bot/commands/message/`

### 5. Übersetzungen anpassen
- `bot/locales/de-DE.json` → Deine Übersetzungs-Keys
- `bot/locales/en-GB.json` → Englische Übersetzungen
- `dashboard/locales/` → Dashboard-Übersetzungen

### 6. Datenbank (optional)
- SQL-Schemas in `bot/schemas/tables.sql`
- Tabellen werden automatisch bei Plugin-Aktivierung erstellt

### 7. Dashboard (optional)
- Routen in `dashboard/routes/`
- Views in `dashboard/views/`
- Widgets in `dashboard/views/widgets/`
- Public Assets in `dashboard/public/`

### 8. Plugin registrieren
```bash
# Im Root-Verzeichnis
npm run register-plugin meinplugin
```

Oder manuell in `plugins/registry.json`:
```json
{
  "plugins": [
    {
      "id": "meinplugin",
      "name": "Mein Plugin",
      "enabled": true,
      "path": "./meinplugin"
    }
  ]
}
```

## 🎯 Plugin-Struktur

```
_template/
├── index.js                    # Entry Point (bot + dashboard)
├── package.json                # NPM-Metadaten
├── config.json                 # Plugin-Konfiguration
├── README.md                   # Dokumentation
├── bot/                        # Bot-spezifischer Teil
│   ├── index.js                # BotPlugin-Klasse
│   ├── commands/               # Commands
│   │   ├── slash/              # Slash-Commands
│   │   │   └── example.js      # Beispiel Slash-Command
│   │   ├── message/            # Prefix-Commands
│   │   │   └── example.js      # Beispiel Message-Command
│   │   └── shared/             # Gemeinsame Helper
│   │       └── exampleHelper.js
│   ├── events/                 # Discord-Events
│   │   ├── ready.js            # Beispiel: ready-Event
│   │   └── ipc/                # IPC-Event-Handler
│   │       └── exampleIpc.js
│   ├── contexts/               # Context-Menüs
│   │   └── exampleContext.js
│   ├── locales/                # Bot-Übersetzungen
│   │   ├── de-DE.json
│   │   └── en-GB.json
│   └── schemas/                # Datenbank-Schemas
│       └── tables.sql
├── dashboard/                  # Dashboard-spezifischer Teil
│   ├── index.js                # DashboardPlugin-Klasse
│   ├── routes/                 # Express-Routen
│   │   └── example.routes.js
│   ├── views/                  # EJS-Templates
│   │   ├── index.ejs           # Haupt-View
│   │   └── widgets/            # Dashboard-Widgets
│   │       └── exampleWidget.ejs
│   ├── public/                 # Static Assets
│   │   ├── css/
│   │   │   └── template.css
│   │   ├── js/
│   │   │   └── template.js
│   │   └── images/
│   ├── locales/                # Dashboard-Übersetzungen
│   │   ├── de-DE.json
│   │   └── en-GB.json
│   └── schemas/                # Dashboard-spezifische Schemas
│       └── tables.sql
└── shared/                     # Gemeinsame Logik (optional)
    ├── utils.js
    └── constants.js
```

## 🔧 Command-Pattern

### Slash-Command
```javascript
module.exports = {
    name: 'beispiel',
    description: 'template:BEISPIEL.DESCRIPTION',
    
    command: { enabled: false },
    slashCommand: { enabled: true },

    async interactionRun(context) {
        const interaction = context.interaction;
        // Deine Logik
    }
};
```

### Message-Command
```javascript
module.exports = {
    name: 'beispiel',
    description: 'template:BEISPIEL.DESCRIPTION',
    
    command: { enabled: true },
    slashCommand: { enabled: false },  // ⚠️ WICHTIG!

    async messageRun(context) {
        const { message, args } = context;
        // Deine Logik
    }
};
```

## 📚 Weitere Ressourcen

- [DuneBot Plugin-System Dokumentation](../../docs/plugins.md)
- [BotPlugin API](../../packages/dunebot-sdk/lib/BotPlugin.js)
- [DashboardPlugin API](../../packages/dunebot-sdk/lib/DashboardPlugin.js)
- [Hook-System](../../packages/dunebot-core/lib/PluginHooks.js)

## 💡 Tipps

1. **Teste lokal**: Aktiviere das Plugin erst für eine Test-Guild
2. **Logging**: Nutze `ServiceManager.get('Logger')` für Debug-Ausgaben
3. **Fehlerbehandlung**: Wrappe kritische Operationen in try-catch
4. **Übersetzungen**: Nutze immer Translation-Keys, keine hardcodierten Strings
5. **Datenbank**: Nutze `ServiceManager.get('dbService')` für Queries
6. **IPC**: Für Bot ↔ Dashboard Kommunikation IPC-Events nutzen

## ⚠️ Häufige Fehler

- ❌ Message-Commands ohne `slashCommand.enabled: false`
- ❌ Slash-Commands ohne `interactionRun`
- ❌ Destrukturierung `{ interaction }` im Parameter
- ❌ Direkte DB-Queries statt DBService
- ❌ Hardcodierte Strings statt Übersetzungen

## 🚀 Los geht's!

```bash
# Plugin kopieren
cp -r plugins/_template plugins/meinplugin

# Namen ersetzen (Linux/Mac)
find plugins/meinplugin -type f -exec sed -i 's/template/meinplugin/g' {} +
find plugins/meinplugin -type f -exec sed -i 's/Template/MeinPlugin/g' {} +
find plugins/meinplugin -type f -exec sed -i 's/TEMPLATE/MEINPLUGIN/g' {} +

# Entwicklung starten
npm run dev
```

Viel Erfolg! 🎉
