---
applyTo: "**"
---

# COPILOT EDITS OPERATIONAL GUIDELINES

## PROJECT OVERVIEW

DuneBot ist ein modulares Discord-Bot-System mit einem WordPress-ähnlichen Plugin-System. Das Projekt besteht aus:

- **Bot** (Discord.js): Bot-Funktionalität mit Commands und Events
- **Dashboard** (Express.js): Web-Interface für Guild-Management mit Discord OAuth2
- **Plugin-System**: Erweiterbare Architektur für beide Seiten (Bot + Dashboard)
- **Theme-System**: Anpassbare UI-Themes für das Dashboard
- **Hook-System**: WordPress-ähnliche Hooks für Plugin-Interaktion
- **MySQL-Datenbank**: Nativer SQL-Client (keine ORM)
- **DASHBOARD**: Nutzte Adminlte & Bootstrap (nichts anderes nutzten!)
- **Frontend**: Nutzte LUMIA THEME (Bootstrap)

## 🚧 ACTIVE DEVELOPMENT PLAN

**Aktuelles Großprojekt:** Event-Bus Architecture Umbau  
**Detaillierter Plan:** [`docs/EVENT_BUS_ARCHITECTURE_PLAN.md`](../../docs/EVENT_BUS_ARCHITECTURE_PLAN.md)

**Wichtig:** Bei allen Änderungen an der Kommunikations-Architektur (IPM, SSE, Events) den Plan konsultieren und den Fortschritt dort aktualisieren!

**Wichtig** Den process dunebot-dashboard-dev nicht neustarten wenn er in pm2 offline ist. dann ist er bereits in der Developper-Terminal aktiv!


## CORE ARCHITECTURE PRINCIPLES

### ServiceManager Pattern

Zentraler Service-Registry für alle wichtigen Services. Zugriff via `ServiceManager.get('serviceName')`:

- `Logger` - Logging-System (Pino-basiert)
- `dbService` - Datenbank-Operationen (nativer MySQL)
- `pluginManager` - Plugin-Verwaltung (Bot/Dashboard-spezifisch)
- `themeManager` - Theme-System (nur Dashboard)
- `navigationManager` - Navigation-Verwaltung (nur Dashboard)
- `i18n` - Übersetzungs-System
- `ipcServer/ipcClient` - Inter-Process-Communication zwischen Bot und Dashboard

### IPC Communication (Bot ↔ Dashboard)

**Technologie:** Veza-IPC (Node.js Inter-Process Communication)  
**Zweck:** Kommunikation zwischen Discord Bot und Dashboard

Bot und Dashboard kommunizieren über **Veza-IPC** für Discord-bezogene Operationen:
- Guild-Daten abrufen
- Bot-Status überwachen
- Commands synchronisieren
- Locale-Management
- Plugin-Management (Bot-seitig)

**Architektur:**
```
┌─────────────┐         Veza-IPC          ┌──────────────┐
│             │◄──────────────────────────►│              │
│  Discord    │   (TCP Socket, Node.js)    │  Dashboard   │
│  Bot        │                            │  (Express)   │
│             │                            │              │
└─────────────┘                            └──────────────┘
     Process 1                                 Process 2
```

**IPC Server:** `apps/bot/bot.js` (Port konfiguriert in `.env`: `IPC_SERVER_HOST`, `IPC_SERVER_PORT`)  
**IPC Client:** `apps/dashboard/helpers/IPCClient.js`

**Wichtig:** 
- ❌ **NICHT** für Gameserver/Daemon-Kommunikation verwenden!
- ✅ **NUR** für Bot ↔ Dashboard Kommunikation
- ✅ Nutze `ServiceManager.get('ipcClient')` im Dashboard
- ✅ Nutze `ServiceManager.get('ipcServer')` im Bot

**Verfügbare IPC-Calls:**
```javascript
// Discord/Guild-bezogen
ipcClient.send('dashboard:VALIDATE_GUILD', { guildId });
ipcClient.send('dashboard:GET_BOT_GUILDS');
ipcClient.send('dashboard:GET_GUILD_STATS', { guildId });

// Commands
ipcClient.send('dashboard:GET_CMDS_SUMMARY', { guildId });
ipcClient.send('dashboard:GET_PLUGIN_CMDS', { type: 'slash' | 'prefix' });

// Locales
ipcClient.send('dashboard:GET_LOCALE_BUNDLE', { locale });
ipcClient.send('dashboard:SET_LOCALE_BUNDLE', { locale, data });

// Plugin-Management (Bot-Plugins!)
ipcClient.send('dashboard:UPDATE_PLUGIN', { 
    pluginName, 
    action: 'enable' | 'disable' | 'guildEnable' | 'guildDisable'
});
```

---

### IPM Communication (Daemon ↔ Dashboard)

**Technologie:** WebSocket (Native WebSocket oder ws Library)  
**Zweck:** Kommunikation zwischen FireBot Daemon (Go) und Dashboard (Node.js)

Daemon und Dashboard kommunizieren über **WebSocket-basiertes IPM (Inter-Process Messaging)** für Gameserver-Management:
- Rootserver-Status
- Gameserver-Lifecycle (Start/Stop/Restart)
- Echtzeit-Logs & Konsole
- Ressourcen-Monitoring (CPU, RAM, Disk)
- Installation-Queue-Updates

**Architektur:**
```
┌──────────────┐      WebSocket (IPM)      ┌──────────────┐
│              │◄─────────────────────────►│              │
│  FireBot     │   (ws://, Binary/JSON)    │  Dashboard   │
│  Daemon (Go) │                           │  (Express)   │
│              │                           │              │
└──────────────┘                           └──────────────┘
  Externer Server                            Process 2
  (z.B. VPS/Dedicated)                      
```

**IPM Server:** `firebot_daemon/internal/websocket/` (Go-Implementierung)  
**IPM Client:** Dashboard Plugin (z.B. `plugins/masterserver/dashboard/helpers/IPMClient.js`)

**Port-Konfiguration:** 
- Daemon: `daemon.yaml` → `ipm_server.port` (Standard: 8081)
- Dashboard: `.env` → `IPM_SERVER_URL=ws://daemon-host:8081`

**Wichtig:** 
- ❌ **NICHT** IPC (Veza) nennen - das ist für Bot ↔ Dashboard!
- ✅ **IMMER** IPM, IPMServer, IPMClient oder ipmServer/ipmClient verwenden
- ✅ **Authentifizierung:** API-Keys aus `rootserver`-Tabelle
- ✅ **Binary Protocol:** Für Logs/Console kann Binary WebSocket genutzt werden

**IPM Message Pattern:**
```javascript
// Client → Daemon (Request)
{
    "type": "request",
    "id": "unique-request-id",
    "action": "rootserver:status" | "gameserver:start" | "console:send",
    "payload": {
        // Action-spezifische Daten
    }
}

// Daemon → Client (Response)
{
    "type": "response",
    "id": "unique-request-id", // Matching request ID
    "success": true | false,
    "data": { /* Response data */ },
    "error": "Error message if failed"
}

// Daemon → Client (Event/Push)
{
    "type": "event",
    "event": "server:status_changed" | "server:crashed" | "console:output",
    "payload": {
        "serverId": "abc123",
        "newStatus": "running",
        "timestamp": 1634567890
    }
}
```

**Verfügbare IPM-Actions (Beispiele):**
```javascript
// RootServer Management
ipmClient.send('rootserver:list', { guildId });
ipmClient.send('rootserver:status', { rootserverId });
ipmClient.send('rootserver:resources', { rootserverId }); // CPU, RAM, Disk

// GameServer Lifecycle
ipmClient.send('gameserver:start', { serverId });
ipmClient.send('gameserver:stop', { serverId });
ipmClient.send('gameserver:restart', { serverId });
ipmClient.send('gameserver:status', { serverId });

// Console/Logs
ipmClient.send('console:attach', { serverId }); // Subscribe to output
ipmClient.send('console:send', { serverId, command: 'say Hello' });
ipmClient.send('logs:fetch', { serverId, lines: 100 });

// Installation
ipmClient.send('install:rootserver', { config });
ipmClient.send('install:gameserver', { rootserverId, gameType, config });
ipmClient.send('install:status', { installId });
```

**Event-Handling (Daemon Push-Events):**
```javascript
// Im Dashboard IPMClient
ipmClient.on('event:server:status_changed', (data) => {
    console.log(`Server ${data.serverId} → ${data.newStatus}`);
    // Update UI, DB, etc.
});

ipmClient.on('event:console:output', (data) => {
    console.log(`[${data.serverId}] ${data.line}`);
    // Append to console widget
});

ipmClient.on('event:server:crashed', (data) => {
    console.error(`Server ${data.serverId} crashed!`);
    // Send notification, log, restart?
});
```

---

### 🔄 Kommunikations-Übersicht (Zusammenfassung)

**IPC vs. IPM - Wann was nutzen?**

| Aspekt | IPC (Bot ↔ Dashboard) | IPM (Daemon ↔ Dashboard) |
|--------|----------------------|-------------------------|
| **Technologie** | Veza (TCP, Node.js) | WebSocket (ws Library) |
| **Zweck** | Discord-Bot-Daten | Gameserver-Management |
| **Protokoll** | Veza-Messages | JSON WebSocket Messages |
| **Verbindung** | Lokal (beide Node.js) | Remote (Go ↔ Node.js) |
| **Auth** | Keine (vertrauenswürdig) | API-Keys (rootserver-Tabelle) |
| **Beispiel-Use-Cases** | Guild-Liste, Commands, Locales | Server starten, Logs, Monitoring |
| **Service-Name** | `ipcClient` / `ipcServer` | `ipmClient` / `ipmServer` |
| **Code-Location** | `apps/bot/`, `apps/dashboard/helpers/` | `firebot_daemon/internal/websocket/`, `plugins/masterserver/dashboard/` |

**Naming Convention:**
```javascript
// ✅ RICHTIG
const ipcClient = ServiceManager.get('ipcClient');  // Bot-Communication
const ipmClient = require('./helpers/IPMClient');   // Daemon-Communication

ipcClient.send('dashboard:GET_BOT_GUILDS');         // Bot-Daten
ipmClient.send('gameserver:start', { serverId });   // Gameserver-Action

// ❌ FALSCH
const ipcClient = new IPCClient();                  // IPC für Daemon (FALSCH!)
ipmClient.send('dashboard:GET_BOT_GUILDS');         // IPM für Bot (FALSCH!)
```

**Debugging:**
```bash
# IPC (Bot ↔ Dashboard)
export VEZA_DEBUG=true        # Veza-Debug-Logs aktivieren

# IPM (Daemon ↔ Dashboard)
export DEBUG_IPM=true         # IPM-Debug-Logs aktivieren (falls implementiert)
```

---

## 🗂️ FIREBOT DAEMON FILESYSTEM ARCHITECTURE

### Definitive Verzeichnisstruktur

**Diese Struktur ist VERBINDLICH für alle Daemon-Entwicklungen!**

```
/home/firecenter/                          # Base Directory (User-definiert bei Setup)
├── steamcmd/                              # Shared SteamCMD Installation
│   ├── steamcmd.sh                        # SteamCMD Binary
│   └── ...                                # Steam Runtime Files
│   # Ownership: root:steamcmd (775)
│   # Alle gs-* User sind in steamcmd Gruppe
│
├── daemon-logs/                           # Daemon System Logs
│   └── firebot-daemon.log
│   # Ownership: root:root
│
├── gs-guild_1403034310/                   # USER HOME für Guild 1403034310
│   # Ownership: gs-guild_1403034310:gs-guild_1403034310 (755)
│   # User Shell: /bin/bash
│   # User UID/GID: Automatisch vom System vergeben
│   │
│   ├── .config/                           # User Config Directory
│   ├── .steam/                            # Steam User Data
│   ├── .local/                            # Local Application Data
│   ├── .cache/                            # Cache Directory
│   │
│   ├── rootserver_1/                      # RootServer 1 (MySQL ID)
│   │   ├── data/                          # RootServer-spezifische Daten
│   │   ├── backups/                       # RootServer Backups
│   │   ├── logs/                          # RootServer Logs
│   │   └── gameservers/                   # Gameserver Installationen
│   │       ├── csgo-server-001/           # Counter-Strike 2 Server
│   │       │   ├── start.sh               # Start-Script (generiert)
│   │       │   ├── game/                  # Game Files
│   │       │   └── ...
│   │       ├── palworld-server-001/       # Palworld Server
│   │       │   ├── start.sh
│   │       │   ├── Pal/                   # Game Files
│   │       │   └── ...
│   │       └── ...
│   │
│   └── rootserver_2/                      # RootServer 2 (falls mehrere)
│       └── gameservers/
│           └── ...
│
└── gs-guild_9876543210/                   # Anderer Guild User
    ├── .config/
    ├── .steam/
    ├── .local/
    ├── .cache/
    └── rootserver_1/
        └── gameservers/
            └── ...
```

### Path-Generierung (Code-Konvention)

**User Home Directory:**
```go
// IMMER: /home/{base_directory}/{username}/
userHome := filepath.Join(cfg.Filesystem.BaseDirectory, username)
// Beispiel: /home/firecenter/gs-guild_1403034310/
```

**RootServer Directory:**
```go
// IMMER: {userHome}/rootserver_{mysql_id}/
rootserverPath := filepath.Join(userHome, fmt.Sprintf("rootserver_%d", mysqlID))
// Beispiel: /home/firecenter/gs-guild_1403034310/rootserver_1/
```

**Gameserver Installation:**
```go
// IMMER: {rootserverPath}/gameservers/{server-slug}/
gameserverPath := filepath.Join(rootserverPath, "gameservers", serverSlug)
// Beispiel: /home/firecenter/gs-guild_1403034310/rootserver_1/gameservers/csgo-001/
```

### User-Management

**User-Erstellung:**
```go
username := fmt.Sprintf("gs-guild_%s", guildID)
homeDir := filepath.Join(baseDir, username)  // /home/firecenter/gs-guild_XXXXX/

cmd := exec.Command("useradd",
    "--system",                    // System-User
    "--home-dir", homeDir,         // Home im Base Directory
    "--create-home",               // Home automatisch erstellen
    "--shell", "/bin/bash",        // Bash Shell (für Scripts)
    "--groups", "steamcmd",        // SteamCMD Gruppe
    username)
```

**User-Verzeichnisse:**
- Werden automatisch bei User-Erstellung in `{homeDir}` erstellt
- `.config`, `.steam`, `.local`, `.cache` müssen explizit angelegt werden
- Ownership: User:User (z.B. `gs-guild_1403034310:gs-guild_1403034310`)

### Wichtige Regeln

1. **Kein `/opt/firebot/` mehr!** Historisch, jetzt `BaseDirectory` aus Config
2. **Kein `/vserver/{daemon_id}/` mehr!** Verwirrendes Zwischenlevel entfernt
3. **User-Home = Base Directory + Username** - IMMER!
4. **RootServer UNTER User-Home** - Pro MySQL-ID ein Verzeichnis
5. **Gameservers UNTER RootServer** - In `gameservers/` Subfolder
6. **Daemon läuft als root** - User-Wechsel via `syscall.Credential`
7. **SteamCMD Shared** - Ownership `root:steamcmd`, alle gs-* User in Gruppe

### Code-Locations

- **User-Erstellung:** `firebot_daemon/internal/rootserver/virtual.go`
- **RootServer-Setup:** `firebot_daemon/internal/rootserver/virtual.go`
- **Gameserver-Installation:** `firebot_daemon/internal/gameserver/install.go`
- **Path-Helpers:** `firebot_daemon/internal/rootserver/directory.go`

---

### Plugin Architecture

Plugins haben eine duale Struktur: `plugins/pluginname/{bot/, dashboard/, shared/}`

- `bot/index.js` - Erweitert BotPlugin (Commands, Events)
- `dashboard/index.js` - Erweitert DashboardPlugin (Routes, Widgets, Navigation)
- Beide können Hooks registrieren und nutzen

## CRITICAL STARTUP SEQUENCE & SERVICE INITIALIZATION

### Bot Startup (`apps/bot/bot.js`)

1. **Logger & ServiceManager** - Core-Services registrieren
2. **Database** - DBService verbinden, Tabellen erstellen
3. **BotClient** - Discord-Client initialisieren mit PluginManager
4. **I18n** - Übersetzungs-System laden
5. **Plugins** - Core-Plugin und weitere laden
6. **Discord Login** - Bot mit Discord verbinden

### Dashboard Startup (`apps/dashboard/index.js`)

1. **Logger & PathConfig** - Basis-Services
2. **Database** - Geteilte DBService-Instanz
3. **IPC Server** - Kommunikation mit Bot aufbauen
4. **Express App** - RouterManager, NavigationManager, ThemeManager, PluginManager
5. **Plugin Loading** - Core-Plugin automatisch, andere dynamisch

**WICHTIG**: Services müssen in dieser Reihenfolge initialisiert werden! Abhängigkeiten beachten.

## PRIME DIRECTIVE

- **Deutsch first**: Kommentare, Dokumentation und Antworten auf Deutsch
- **Codebase-first**: Immer nach existierenden Implementierungen suchen, bevor neue erstellt werden
- **Service-aware**: ServiceManager.get() für alle Services nutzen
- **Hook-Integration**: Hooks nutzen statt Code direkt zu ändern
- **Plugin-Kontext**: Unterscheiden zwischen Bot- und Dashboard-Context bei Plugin-Entwicklung
- **NO Alpine.js**: NIEMALS Alpine.js verwenden! Nutze das guild.js AJAX-System für alle Formulare
- **ONLY WORK IN dunebot_dev**: Arbeite ausschließlich in der `dunebot_dev`-Umgebung. Keine Änderungen in anderen Umgebungen vornehmen.
- **ASK FOR COMMITS**: Bei größeren Änderungen immer um Commit-Historie bitten, um den Überblick zu behalten.
- **ONLY COMMIT WITH APROVAL**: Keine Commits ohne vorherige Genehmigung durch den Projektleiter.

## PLUGINS NOT TO COMMIT (!IMPORTAND)

- fun
- economy
- gameserver
- masterserver
- giveaway
- imageserver
- masterserver
- statistik
- ticket
- voiceserver

## FRONTEND ARCHITECTURE (CRITICAL!)

### ❌ DEPRECATED & VERBOTEN: Alpine.js

**NIEMALS VERWENDEN!** Das Projekt nutzt Alpine.js NICHT mehr!

**Alle Alpine.js-Komponenten wurden entfernt:**

- ✅ Core Guild Config → Migriert zu guild.js
- ✅ Locales Editor → Entfernt (nicht mehr benötigt)
- ✅ Moderation Settings → Migriert zu guild.js

**Das System ist jetzt 100% Alpine.js-frei!**

**Wenn du Alpine.js-Code siehst:**

1. ❌ **NICHT** kopieren oder als Vorlage nutzen
2. ✅ Sofort melden - sollte nicht mehr existieren
3. ✅ guild.js-System verwenden

### ✅ AKTUELLER STANDARD: guild.js AJAX System

**Alle neuen Dashboard-Formulare MÜSSEN dieses System nutzen!**

#### **Template-Pattern:**

```html
<form class="guild-ajax-form"
      data-form-type="feature-name"
      data-method="PUT"
      action="/guild/:guildId/plugin"
      method="POST">

  <input type="text" name="field_name" value="<%= serverValue %>" required>

  <select name="select_field">
    <option value="opt1" <%= condition ? 'selected' : '' %>>Option 1</option>
    <option value="opt2" <%= !condition ? 'selected' : '' %>>Option 2</option>
  </select>

  <input type="checkbox" name="checkbox_field" value="1" <%= checked ? 'checked' : '' %>>

  <input type="hidden" name="form_identifier" value="true">

  <button type="submit">Speichern</button>
</form>
```

**Wichtig:**

- `class="guild-ajax-form"` - Registrierung im Handler
- `data-form-type="..."` - Routing für Response-Handler
- `data-method="PUT|POST|DELETE"` - HTTP-Methode
- `name` Attribute auf ALLEN Inputs
- `value` mit Server-Side-Rendering (EJS)
- `selected`/`checked` mit EJS-Conditionals

#### **Backend-Pattern:**

```javascript
router.put("/", async (req, res) => {
  try {
    const body = req.body; // Express body-parser

    // Validierung
    if (!body.field_name || typeof body.field_name !== "string") {
      return res.status(400).json({
        success: false,
        message: "Ungültige Eingabedaten",
      });
    }

    // Verarbeitung
    await dbService.query("UPDATE table SET field = ? WHERE id = ?", [
      body.field_name,
      id,
    ]);

    // Erfolg
    res.json({
      success: true,
      message: "Erfolgreich gespeichert",
    });
  } catch (error) {
    Logger.error("Route Error:", error);
    res.status(500).json({
      success: false,
      message: "Serverfehler beim Speichern",
    });
  }
});
```

**Wichtig:**

- Strukturierte JSON-Response mit `success` + `message`
- Proper HTTP-Status-Codes (400, 500)
- Fehlerbehandlung mit spezifischen Meldungen

#### **guild.js Handler-Pattern:**

```javascript
// In guild.js Switch-Case hinzufügen:
case 'feature-name':
    await this.handleFeatureNameResponse(form, result);
    break;

// Handler-Funktion implementieren:
static async handleFeatureNameResponse(form, result) {
    console.log('[GuildAjax] handleFeatureNameResponse called:', result);
    if (result.success) {
        this.showToast('success', result.message || 'Erfolgreich gespeichert');
        // Optional: Seite nach 1,5s neu laden
        setTimeout(() => window.location.reload(), 1500);
    } else {
        this.showToast('error', result.message || 'Fehler beim Speichern');
    }
}
```

**Wichtig:**

- Handler-Name: `handle[FormType]Response`
- Console-Logging für Debugging
- Toast-Benachrichtigungen mit `this.showToast()`
- Optional: Page-Reload mit Timeout

#### **Migrierte Beispiele:**

Für Referenz siehe:

- ✅ `/plugins/moderation/dashboard/views/guild/moderation.ejs`
- ✅ `/plugins/core/dashboard/views/guild.ejs`
- ✅ `/plugins/dunemap/dashboard/views/guild/settings.ejs`

## ENVIRONMENT & CONFIGURATION

### Environment Variables Location

**WICHTIG**: Alle Environment-Variablen sind in `apps/dashboard/.env` gespeichert!

- ❌ NICHT in `apps/bot/.env` (existiert nicht)
- ❌ NICHT im Root `.env` (nur für spezielle Zwecke)
- ✅ **IMMER**: `apps/dashboard/.env`

### Database Connection

**MySQL-Credentials** aus `.env` verwenden:

```javascript
// Für Node.js Scripts mit mysql2
require("dotenv").config({ path: "./apps/dashboard/.env" });
const connection = await mysql.createConnection({
  host: process.env.MYSQL_HOST, // NICHT DB_HOST!
  port: process.env.MYSQL_PORT, // Standard: 3306
  user: process.env.MYSQL_USER, // NICHT DB_USER!
  password: process.env.MYSQL_PASSWORD, // NICHT DB_PASSWORD!
  database: process.env.MYSQL_DATABASE, // NICHT DB_DATABASE!
});
```

**Verfügbare ENV-Variablen** (Auszug):

- **MySQL**: `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE`
- **Discord**: `CLIENT_ID`, `CLIENT_SECRET`, `DISCORD_REDIRECT_URI`, `TOKEN_ENCRYPTION_KEY`
- **Dashboard**: `DASHBOARD_PORT`, `DASHBOARD_BASE_URL`, `SESSION_SECRET`, `SESSION_COOKIE`
- **IPC**: `IPC_SERVER_HOST`, `IPC_SERVER_PORT`
- **Redis**: `REDIS_URL`
- **Debug**: `LOG_LEVEL`, `NODE_ENV`, `DEBUG_HOOKS`, `VEZA_DEBUG`

### DBService Pattern

Im laufenden Bot/Dashboard-Code **immer DBService** verwenden:

```javascript
const dbService = ServiceManager.get("dbService");
await dbService.query("SELECT * FROM table WHERE id = ?", [id]);
```

DBService nutzt intern die MySQL-Credentials aus der `.env` automatisch.

## LARGE FILE & COMPLEX CHANGE PROTOCOL

### MANDATORY PLANNING PHASE

When working with large files (>300 lines) or complex changes: 1. ALWAYS start by creating a detailed plan BEFORE making any edits 2. Your plan MUST include: - All functions/sections that need modification - The order in which changes should be applied - Dependencies between changes - Estimated number of separate edits required - How they adjust the function/section - and what functions/sections the new one will replace
(in wich form the old one can be removed) 3. Format your plan as:
Working with: [filename]
Total planned edits: [number]

### RATE LIMIT AVOIDANCE

    - For very large files, suggest splitting changes across multiple sessions
    - Prioritize changes that are logically complete units
    - Always provide clear stopping points

## Folder Structure

    Follow this structured directory layout:

    	project-root/
    	├── apps/                   # Main Folder for the 2 apps
    	│   ├── bot/                # Bot app
        │   │   ├── extenders/      # extending the bot
    	│   │   ├── helpers/        # helpers are core bot files
    	│   │   └── locales/        # Localisation files
    	│   └── dashboard/          # Dashboard app
        │       ├── controllers/
    	│       ├── helpers/
    	│       ├── locales/
    	│       ├── middleware/
        │       │   └── context/
        │       ├── public/
        │       ├── routes/
    	│       └── themes/
        │           └── default/
    	│               ├── assets/
    	│               │   ├── css/
    	│               │   ├── js/
    	│               │   ├── images/
    	│               │   └── fonts/
    	│               ├── layouts/
        │               ├── partials/
        │               │   ├── admin/
        │               │   ├── frontend/
        │               │   └── shared/
        │               └── views/
        │                   └── auth/
    	├── logs/                 # Server and application logs
        ├── packages/             # Main package for the 2 system.
        │   ├── dunebot-core/
        │   │   └── lib/
    	│   ├── dunebot-db-client/
        │   │   ├── lib/
        │   │   └── schemas/
    	│   └── dunebot-sdk/
        │       └── lib/
        │          └── utils/
    	└── plugins/                    # Home for all plugin files
        │   ├── core/                   # the core plugin. main plugin for the dunebot
        │   │   ├── bot/
        │   │   │   └── commands/
        │   │   │   └── events/
        │   │   │   │   └── ipc/
        │   │   │   └── locales/
        │   │   │   └── schemas/
        │   │   └── dashboard/
        │   │       └── locales/
        │   │       └── public/
        │   │       └── routes/
        │   │       └── schemas/
        │   │       └── views/
        │   │           └── admin/
        │   │           └── dashboard/
        │   │           └── widgets/
        ├── plugin_abc/                 # all other plugins her, same struccture as core

### IPC CALLS

    - DIese IPC CALLS kann der Client an den server senden.
        - dashboard:VALIDATE_GUILD
        - dashboard:GET_BOT_GUILDS
        - dashboard:GET_GUILD_STATS
        - dashboard:GET_CMDS_SUMMARY
        - dashboard:GET_PLUGIN_CMDS
            mit potenziellen types:
                - prefix
                - slash
        - dashboard:GET_LOCALE_BUNDLE
        - dashboard:SET_LOCALE_BUNDLE
        - dashboard:UPDATE_PLUGIN
            mit potenziellen actions:
                - enable
                - disable
                - install
                - uninstall
                - guildEnable
                - guildDisable

## Documentation Requirements

    - Include JSDoc comments for JavaScript.
    - Document complex functions with clear examples.
    - Maintain concise Markdown documentation.
    - Minimum docblock info: `param`, `return`, `throws`, `author`

## Database Requirements (MySQL)

    - Leverage JSON columns, generated columns, strict mode, foreign keys, check constraints, and transactions.
    - always be near wordpress.

## Security Considerations

    - Sanitize all user inputs thoroughly.
    - Parameterize database queries.
    - Enforce strong Content Security Policies (CSP).
    - Use CSRF protection where applicable.
    - Ensure secure cookies (`HttpOnly`, `Secure`, `SameSite=Strict`).
    - Limit privileges and enforce role-based access control.
    - Implement detailed internal logging and monitoring.

## THINK ON USING HOOKS FROM THE system

    - THEME HOOKS:
        - dashboard_head: Skripts und Styles im Head-Bereich einfügen
        - sidebar_after_nav: Elemente in der Sidebar nach der Navigation einfügen
        - before_content: Inhalte vor dem Hauptinhalt einfügen
        - content_header_actions: Aktions-Buttons in der Kopfzeile einfügen
        - after_content: Inhalte nach dem Hauptinhalt einfügen
        - dashboard_footer_scripts: Skripts am Ende der Seite einfügen

    - PLUGINMANAGER (DASHBOARD) HOOKS:
        - REGISTERING TABLES
            - before_register_tables - Vor der Registrierung von Tabellen
            - after_register_tables - Nach erfolgreicher Tabellen-Registrierung
            - register_tables_failed - Bei Fehler während der Tabellen-Registrierung

        - PLUGIN INSTALLATION
            - before_install_plugin - Vor der Installation eines Plugins
            - after_install_plugin - Nach erfolgreicher Installation
            - install_plugin_failed - Bei Fehler während der Installation

        - PLUGIN ENABLE
            - before_enable_plugin - Vor der Aktivierung eines Plugins
            - before_load_plugin_translations - Vor dem Laden der Übersetzungen
            - plugin_load_failed - Bei Fehler beim Laden des Plugin-Moduls
            - modify_plugin_instance - Filter zum Modifizieren der Plugin-Instanz
            - invalid_plugin_type - Bei ungültigem Plugin-Typ
            - before_register_dashboard_tables - Vor der Registrierung von Dashboard-Tabellen
            - before_plugin_enable_method - Vor dem Aufruf der enable-Methode
            - after_plugin_registered - Nach der Registrierung eines Plugins
            - before_update_config - Vor der Aktualisierung der Konfiguration
            - modify_enabled_plugins - Filter zum Modifizieren der aktivierten Plugins
            - after_update_config - Nach der Aktualisierung der Konfiguration
            - after_enable_plugin - Nach erfolgreicher Aktivierung

        - PLUGIN DISABLE
            - before_disable_plugin - Vor der Deaktivierung eines Plugins
            - before_plugin_disable_method - Vor dem Aufruf der onDisable-Methode
            - after_plugin_disable_method - Nach dem Aufruf der onDisable-Methode
            - after_disable_plugin - Nach erfolgreicher Deaktivierung
            - disable_plugin_failed - Bei Fehler während der Deaktivierung

        - DESKTOP widgets
            - filter_plugin_widgets - Filter für Plugin-Widgets
            - dashboard_widgets - Filter für alle Dashboard-Widgets

        - register routes
            - before_register_routes - Vor der Registrierung von Routen
            - filter_dashboard_router - Filter für Dashboard-Router
            - filter_admin_router - Filter für Admin-Router
            - filter_api_router - Filter für API-Router
            - after_register_routes - Nach der Registrierung aller Routen

        - ENABLE IN GUIDE
            - before_enable_in_guild - Vor der Guild-spezifischen Aktivierung
            - enable_in_guild_failed - Bei Fehler während der Aktivierung
            - before_register_navigation - Vor der Registrierung der Navigation
            - filter_navigation_items - Filter für die Navigations-Items
            - after_register_navigation - Nach der Registrierung der Navigation
            - before_plugin_guild_enable_method - Vor dem Aufruf von plugin.onEnable
            - plugin_guild_enable_method_failed - Bei Fehler im onEnable-Handler
            - after_plugin_guild_enable_method - Nach dem Aufruf von plugin.onEnable
            - before_update_guild_settings - Vor der Aktualisierung der Guild-Einstellungen
            - modify_guild_enabled_plugins - Filter für die aktivierten Plugins einer Guild
            - after_update_guild_settings - Nach der Aktualisierung der Guild-Einstellungen
            - before_guild_specific_enable - Vor dem Aufruf von plugin.onGuildEnable
            - after_guild_specific_enable - Nach dem Aufruf von plugin.onGuildEnable
            - after_enable_in_guild - Nach der erfolgreichen Aktivierung in der Guild

        - DISABLE IN GUILD
            - before_disable_in_guild - Vor der Guild-spezifischen Deaktivierung
            - disable_in_guild_failed - Bei Fehler während der Deaktivierung
            - before_guild_specific_disable - Vor dem Aufruf von plugin.onGuildDisable
            - after_guild_specific_disable - Nach dem Aufruf von plugin.onGuildDisable
            - before_update_guild_settings_disable - Vor der Aktualisierung der Guild-Einstellungen
            - after_update_guild_settings_disable - Nach der Aktualisierung der Guild-Einstellungen
            - after_disable_in_guild - Nach der erfolgreichen Deaktivierung in der Guild

## PLUGIN SYSTEM ARCHITECTURE

### Plugin Structure Example (Core Plugin)

```javascript
// plugins/core/index.js - Plugin Entry Point
module.exports = {
  bot: require("./bot"), // Bot-spezifischer Teil
  dashboard: require("./dashboard"), // Dashboard-spezifischer Teil
};

// plugins/core/bot/index.js - Bot Plugin
class CoreBotPlugin extends BotPlugin {
  async onEnable(client) {
    /* Bot-Aktivierung */
  }
  async onGuildEnable(guildId) {
    /* Guild-spezifische Aktivierung */
  }
  registerHooks(hooks) {
    /* Hooks registrieren */
  }
}

// plugins/core/dashboard/index.js - Dashboard Plugin
class CoreDashboardPlugin extends DashboardPlugin {
  async enable() {
    /* Dashboard-Aktivierung */
  }
  _setupRoutes() {
    /* Express-Routen */
  }
  _registerWidgets() {
    /* Dashboard-Widgets */
  }
  async onGuildEnable(guildId) {
    /* Navigation registrieren */
  }
}
```

### Plugin Lifecycle Methods

- **Bot**: `onEnable()`, `onDisable()`, `onGuildEnable()`, `onGuildDisable()`
- **Dashboard**: `enable()`, `disable()`, `onGuildEnable()`, `onGuildDisable()`
- **Hooks**: `registerHooks()` - WordPress-ähnliche Action/Filter-Hooks
- **Navigation**: Automatische Registrierung über `NavigationManager.registerNavigation()`
- **Database**: Models aus `bot/models/`, `dashboard/models/`, `shared/models/` werden automatisch geladen

### ThemeManager & Navigation System

- **View Engine**: EJS mit Multi-Path-Lookup (Plugin > Theme > Default)
- **Layout System**: `res.locals.layout = themeManager.getLayout('guild'|'frontend')`
- **Navigation**: DB-basiert über `NavigationManager`, dynamische Plugin-Navigation
- **Widgets**: Filter-Hook `guild_dashboard_widgets` für Plugin-Widgets
- **Asset Handling**: Theme-Assets über RouterManager automatisch bereitgestellt

### Database Operations

- **Native MySQL**: Keine ORM, direkte SQL-Queries über DBService
- **Schema Loading**: `.sql`-Dateien und JS-Module aus Plugin-Verzeichnissen
- **Migration**: Tabellen werden automatisch bei Plugin-Aktivierung erstellt
- **Config System**: JSON-basierte Konfiguration über `dbService.setConfig()`/`getConfig()`

---

## 🔄 PLUGIN MIGRATION SYSTEM (STANDARD FÜR ALLE PLUGINS!)

### Übersicht

**Seit v6.6.0 haben wir ein robustes Migration-System für alle Plugins!**

- ✅ **Sequential Execution**: Migrationen laufen automatisch in der richtigen Reihenfolge
- ✅ **Idempotent**: Jede Migration wird nur einmal ausgeführt (Tracking via `plugin_migrations` Tabelle)
- ✅ **Production-Safe**: Fresh Installs und Updates werden gleich behandelt
- ✅ **Rollback-Support**: Jede Migration kann `down()` Methode für Rollback haben
- ✅ **Lokales System**: Keine Downloads, Code ist bereits im Monorepo

### Migration-Tabelle

**Datenbank:** `plugin_migrations` (automatisch erstellt bei Core-Plugin-Installation)

```sql
CREATE TABLE plugin_migrations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    plugin_name VARCHAR(100) NOT NULL,
    guild_id VARCHAR(50) DEFAULT NULL,      -- NULL = global migration
    migration_file VARCHAR(255) NOT NULL,    -- z.B. "dashboard/migrations/6.6.0-permissions.js"
    migration_version VARCHAR(20) NOT NULL,  -- z.B. "6.6.0"
    migration_type ENUM('schema', 'data', 'update') DEFAULT 'data',
    executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    execution_time_ms INT DEFAULT 0,
    success BOOLEAN DEFAULT TRUE,
    error_log TEXT DEFAULT NULL,
    rollback_file VARCHAR(255) DEFAULT NULL,
    rolled_back_at TIMESTAMP NULL DEFAULT NULL,
    UNIQUE KEY unique_migration (plugin_name, guild_id, migration_file)
);
```

### Wann brauche ich eine Migration?

**✅ Migration ERFORDERLICH bei:**
- 🗄️ Neue Tabellen erstellen
- 🔧 Spalten hinzufügen/ändern/löschen
- 📊 Daten migrieren (alte Struktur → neue Struktur)
- 🧭 Navigation grundlegend ändern
- 🔑 Default-Daten für Guilds erstellen
- 🗑️ Alte Daten löschen/aufräumen

**❌ KEINE Migration bei:**
- 💻 Bug-Fixes in Code
- 🎨 UI/CSS-Änderungen
- ⚡ Performance-Optimierungen
- 🔄 Refactoring (ohne DB-Änderungen)
- 📝 Neue Files hinzufügen (Commands, Routes)
- 🗂️ Files löschen/umbenennen (DB bleibt gleich)

**Faustregel:** Ändert sich die Datenbank? → Migration! Nur Code? → Kein Update nötig!

### Migration erstellen (Schritt-für-Schritt)

#### 1. Version in package.json erhöhen

```json
// plugins/myplugin/package.json
{
  "name": "myplugin",
  "version": "1.2.0",  // ← Von 1.1.0 erhöhen!
  ...
}
```

#### 2. Migration-Datei erstellen

**Pfad:** `plugins/myplugin/dashboard/migrations/1.2.0-feature-name.js`

**Template:**
```javascript
/**
 * Migration 1.2.0: Feature Description
 * 
 * Beschreibung was die Migration macht
 * 
 * @author YourName
 * @version 1.2.0
 */

module.exports = {
    version: '1.2.0',
    name: 'Feature Implementation',
    
    /**
     * Migration ausführen
     * @param {object} dbService - Database Service
     * @param {string} guildId - Guild ID (kann NULL sein für globale Migrations)
     */
    async up(dbService, guildId) {
        const Logger = require('dunebot-core').ServiceManager.get('Logger');
        
        Logger.info(`[Plugin Migration 1.2.0] Starte Migration${guildId ? ` für Guild ${guildId}` : ''}...`);
        
        try {
            // ========================================
            // SCHEMA-ÄNDERUNGEN (Tabellen/Spalten)
            // ========================================
            
            // Neue Spalte hinzufügen
            await dbService.query(`
                ALTER TABLE my_table 
                ADD COLUMN new_field VARCHAR(100) DEFAULT NULL
            `);
            
            // Neue Tabelle erstellen
            await dbService.query(`
                CREATE TABLE IF NOT EXISTS my_new_table (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    guild_id VARCHAR(20) NOT NULL,
                    data JSON,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (guild_id) REFERENCES guilds(_id) ON DELETE CASCADE
                )
            `);
            
            // ========================================
            // DATEN-MIGRATION (Werte umwandeln)
            // ========================================
            
            if (guildId) {
                // Guild-spezifische Migration
                await dbService.query(`
                    UPDATE my_table 
                    SET new_field = 'default_value' 
                    WHERE guild_id = ?
                `, [guildId]);
            } else {
                // Globale Migration
                await dbService.query(`
                    UPDATE my_table 
                    SET new_field = 'default_value'
                `);
            }
            
            // ========================================
            // NAVIGATION AKTUALISIEREN (optional)
            // ========================================
            
            if (guildId) {
                const NavigationManager = require('dunebot-core').ServiceManager.get('navigationManager');
                
                // Alte Navigation löschen
                await dbService.query(
                    'DELETE FROM nav_items WHERE plugin = ? AND guildId = ?',
                    ['myplugin', guildId]
                );
                
                // Neue Navigation registrieren
                const pluginManager = require('dunebot-core').ServiceManager.get('pluginManager');
                if (pluginManager.isPluginEnabled('myplugin')) {
                    const plugin = pluginManager.getPlugin('myplugin');
                    if (plugin && typeof plugin._registerNavigation === 'function') {
                        await plugin._registerNavigation(guildId);
                    }
                }
            }
            
            Logger.success(`[Plugin Migration 1.2.0] Migration erfolgreich!`);
            return { success: true };
            
        } catch (error) {
            Logger.error(`[Plugin Migration 1.2.0] Migration fehlgeschlagen:`, error);
            throw error;
        }
    },
    
    /**
     * Rollback (optional aber empfohlen!)
     * @param {object} dbService 
     * @param {string} guildId 
     */
    async down(dbService, guildId) {
        const Logger = require('dunebot-core').ServiceManager.get('Logger');
        
        Logger.info(`[Plugin Migration 1.2.0] ROLLBACK${guildId ? ` für Guild ${guildId}` : ''}...`);
        
        try {
            // Rückgängig machen (umgekehrte Reihenfolge!)
            
            // Spalte entfernen
            await dbService.query(`
                ALTER TABLE my_table 
                DROP COLUMN new_field
            `);
            
            // Tabelle löschen
            await dbService.query(`
                DROP TABLE IF EXISTS my_new_table
            `);
            
            Logger.success(`[Plugin Migration 1.2.0] Rollback erfolgreich!`);
            
        } catch (error) {
            Logger.error(`[Plugin Migration 1.2.0] Rollback fehlgeschlagen:`, error);
            throw error;
        }
    }
};
```

#### 3. plugin.json aktualisieren

```json
// plugins/myplugin/plugin.json
{
  "name": "myplugin",
  "version": "1.2.0",  // ← Gleiche Version wie package.json!
  "migrations": {
    "1.0.0": "dashboard/migrations/1.0.0-initial.js",
    "1.1.0": "dashboard/migrations/1.1.0-feature-a.js",
    "1.2.0": "dashboard/migrations/1.2.0-feature-b.js"  // ← NEU!
  },
  ...
}
```

#### 4. Dashboard neu starten → Fertig! ✨

Das System macht automatisch:
1. ✅ Erkennt: Version in DB (z.B. 1.1.0) < Version in Code (1.2.0)
2. ✅ Findet alle Migrationen zwischen 1.1.0 und 1.2.0 (nur 1.2.0 in diesem Fall)
3. ✅ Führt Migration(en) sequenziell aus
4. ✅ Markiert in `plugin_migrations` als ausgeführt
5. ✅ Updated `plugin_versions.current_version = '1.2.0'`

### Sequential Migration - Mehrere Versionen auf einmal

**Szenario:** DEV hat 1.0.0 → 1.1.0 → 1.2.0 schrittweise gemacht, PROD springt direkt von 1.0.0 → 1.2.0

```json
// plugin.json
{
  "migrations": {
    "1.0.0": "dashboard/migrations/1.0.0-initial.js",
    "1.1.0": "dashboard/migrations/1.1.0-add-feature-a.js",
    "1.2.0": "dashboard/migrations/1.2.0-add-feature-b.js"
  }
}
```

**PROD Update von 1.0.0 → 1.2.0:**
```
System erkennt: current = 1.0.0, target = 1.2.0
Findet Migrationen: 1.1.0, 1.2.0 (beide > 1.0.0 und <= 1.2.0)
Führt aus:
  1. Migration 1.1.0 (erstellt Feature A)
  2. Migration 1.2.0 (erstellt Feature B, nutzt Feature A!)
Ergebnis: ✅ Beide Migrationen laufen automatisch nacheinander!
```

**WICHTIG:** Migrationen müssen unabhängig voneinander lauffähig sein, ABER können aufeinander aufbauen!

### Migration-Fehler beheben

Falls eine Migration fehlschlägt:

```bash
# Migration-Eintrag löschen (ermöglicht erneuten Versuch)
cd /home/firedervil/dunebot_dev && node -e "
const mysql = require('mysql2/promise');
require('dotenv').config({ path: './apps/dashboard/.env' });

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE
  });
  
  // Migration zurücksetzen
  await conn.query(
    'DELETE FROM plugin_migrations WHERE plugin_name = ? AND migration_file = ?',
    ['myplugin', 'dashboard/migrations/1.2.0-feature.js']
  );
  
  // Version zurücksetzen (optional)
  await conn.query(
    'UPDATE plugin_versions SET current_version = ? WHERE plugin_name = ?',
    ['1.1.0', 'myplugin']
  );
  
  await conn.end();
  console.log('✅ Migration zurückgesetzt! Dashboard neu starten für Retry.');
})();
"
```

### Best Practices

1. **✅ Immer `up()` UND `down()` implementieren** - Rollback ist Gold wert!
2. **✅ Idempotent schreiben** - Migration sollte mehrfach laufbar sein
   - Nutze `CREATE TABLE IF NOT EXISTS`
   - Prüfe ob Spalte bereits existiert vor `ALTER TABLE ADD`
   - Nutze `INSERT IGNORE` oder `ON DUPLICATE KEY UPDATE`
3. **✅ Transactions bei kritischen Operationen** - Alles oder nichts!
4. **✅ Ausführliche Logs** - Logger.info() für jeden Schritt
5. **✅ Fehlerbehandlung** - try/catch und sinnvolle Fehlermeldungen
6. **✅ Versionsnummern sinnvoll wählen** - Semver! (Major.Minor.Patch)
7. **❌ KEINE Breaking Changes ohne Major-Version-Bump**
8. **✅ Teste Migration IMMER mit Fresh Install (0.0.0 → new)**

### Debugging

**Prüfe ausgeführte Migrationen:**
```sql
SELECT * FROM plugin_migrations 
WHERE plugin_name = 'myplugin' 
ORDER BY executed_at DESC;
```

**Prüfe Plugin-Version:**
```sql
SELECT * FROM plugin_versions 
WHERE plugin_name = 'myplugin';
```

**Log-Ausgabe:**
```
[PluginManager] Version-Upgrade: 1.1.0 → 1.2.0
[PluginManager] Führe 1 Migration(en) aus: 1.2.0
[PluginManager] → Migration 1.2.0: dashboard/migrations/1.2.0-feature.js
[Plugin Migration 1.2.0] Starte Migration für Guild 1403034310172475416...
[Plugin Migration 1.2.0] Migration erfolgreich!
[PluginManager]   ✅ Migration 1.2.0 erfolgreich (42ms)
[PluginManager] myplugin erfolgreich auf v1.2.0 aktualisiert
```

---
