# 🎯 Template Plugin - Schnellstart

## Neues Plugin erstellen

```bash
# 1. Template kopieren
cp -r plugins/_template plugins/meinplugin

# 2. In das neue Plugin-Verzeichnis wechseln
cd plugins/meinplugin

# 3. Namen ersetzen (Linux/Mac)
find . -type f -exec sed -i 's/template/meinplugin/g' {} +
find . -type f -exec sed -i 's/Template/MeinPlugin/g' {} +
find . -type f -exec sed -i 's/TEMPLATE/MEINPLUGIN/g' {} +

# Für Windows (PowerShell):
# Get-ChildItem -Recurse -File | ForEach-Object {
#     (Get-Content $_.FullName) -replace 'template', 'meinplugin' |
#     Set-Content $_.FullName
# }
```

## Was jetzt?

1. **Metadaten anpassen**:
   - `package.json` → name, description, author
   - `config.json` → displayName, icon, category
   - `bot/index.js` → constructor-Werte
   - `dashboard/index.js` → constructor-Werte

2. **Commands erstellen**:
   - Lösche Beispiel-Commands
   - Erstelle deine eigenen in `bot/commands/slash/` oder `bot/commands/message/`
   - Folge dem Pattern!

3. **Übersetzungen**:
   - `bot/locales/de-DE.json` → Deine Keys
   - `bot/locales/en-GB.json` → Englische Übersetzungen

4. **Datenbank** (optional):
   - `bot/schemas/tables.sql` → Deine Tabellen
   - Werden automatisch erstellt

5. **Dashboard** (optional):
   - Views in `dashboard/views/`
   - Routen in `dashboard/index.js` → `_setupRoutes()`
   - Widgets in `dashboard/index.js` → `_registerWidgets()`

## Wichtige Regeln

✅ **Message-Commands MÜSSEN haben**: `slashCommand.enabled: false`
✅ **Slash-Commands MÜSSEN haben**: `interactionRun(context)`
✅ **Immer Übersetzungen nutzen**: `guild.getT('plugin:KEY')`
✅ **ServiceManager für Services**: `ServiceManager.get('Logger')`
✅ **DBService für Datenbank**: `ServiceManager.get('dbService')`

## Struktur-Übersicht

```
meinplugin/
├── index.js              # Entry Point
├── config.json           # Plugin-Config
├── bot/
│   ├── index.js          # Bot-Plugin Klasse
│   ├── commands/
│   │   ├── slash/        # Slash-Commands
│   │   ├── message/      # Prefix-Commands
│   │   └── shared/       # Helper-Funktionen
│   ├── events/           # Discord Events
│   ├── contexts/         # Context-Menüs
│   ├── locales/          # Übersetzungen
│   └── schemas/          # DB-Schemas
├── dashboard/
│   ├── index.js          # Dashboard-Plugin Klasse
│   ├── views/            # EJS-Templates
│   ├── public/           # CSS, JS, Images
│   ├── locales/          # Dashboard-Übersetzungen
│   └── schemas/          # Dashboard-Schemas
└── shared/               # Gemeinsame Utils
```

## Hilfe

- [README.md](README.md) → Vollständige Dokumentation
- [Copilot Instructions](../../.github/copilot-instructions.md) → System-Infos
- DuneMap Plugin → Gutes Beispiel ansehen
- Core Plugin → Komplexes Beispiel

Viel Erfolg! 🚀
