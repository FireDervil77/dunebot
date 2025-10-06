# 🎮 Gameserver-Plugin - Architektur & Implementierungs-Todo

## Übersicht

Plugin zur Verwaltung von Gameservern (Minecraft, ARK, Rust, CS:GO, etc.) mit folgenden Features:
- **Lokale Server**: Docker-Container auf dem gleichen Server wie Dashboard
- **Remote Server**: Über IPC-Agents auf entfernten Maschinen
- **Dashboard-UI**: Web-Interface zur Verwaltung
- **Discord-Integration**: Bot-Commands für Server-Kontrolle
- **Live-Console**: WebSocket-basierte Echtzeit-Logs

---

## 1. Plugin-Struktur

```
plugins/gameserver/
├── bot/
│   ├── commands/
│   │   ├── server.js           # /server create/start/stop/restart/delete
│   │   └── server-info.js      # /server info/status/logs
│   ├── events/
│   │   └── ipc/
│   │       └── serverStatus.js # Server-Status-Updates empfangen
│   └── index.js
├── dashboard/
│   ├── routes/
│   │   ├── servers.js          # /guild/:gid/gameserver/servers
│   │   ├── create.js           # /guild/:gid/gameserver/create
│   │   └── manage.js           # /guild/:gid/gameserver/:serverId/manage
│   ├── views/
│   │   ├── servers-list.ejs    # Übersicht aller Server
│   │   ├── create-server.ejs   # Server-Erstellung-Formular
│   │   └── manage-server.ejs   # Server-Verwaltung (Start/Stop/Config/Console)
│   ├── public/
│   │   └── js/
│   │       ├── server-console.js  # WebSocket-Console (Live-Logs)
│   │       └── server-status.js   # Live-Status-Updates
│   └── index.js
├── shared/
│   ├── schemas/
│   │   ├── gameservers.sql     # Server-Definitionen
│   │   └── server_templates.sql # Vorlagen (Minecraft, ARK, etc.)
│   └── models/
│       ├── GameServer.js
│       └── ServerTemplate.js
└── agent/                       # REMOTE-AGENT für andere Maschinen
    ├── index.js                 # Standalone-Client
    ├── DockerManager.js         # Docker-Container-Verwaltung
    ├── ServerController.js      # Server-Lifecycle (Start/Stop/Config)
    └── IPCAgentClient.js        # Verbindung zum Dashboard
```

---

## 2. Kommunikations-Architektur

### Komponenten-Diagramm

```
┌─────────────┐         ┌──────────────┐         ┌─────────────────┐
│   Discord   │         │  Dashboard   │         │  Remote Agent   │
│   Bot       │◄───IPC──┤              │◄───IPC──┤  (Docker Host)  │
│             │         │  (IPC Server)│         │                 │
└─────────────┘         └──────────────┘         └─────────────────┘
      │                        │                         │
      │                        │                         ▼
      │                        │                  ┌─────────────┐
      │                        │                  │   Docker    │
      │                        │                  │  Container  │
      │                        │                  └─────────────┘
      │                        │
      ▼                        ▼
   [Commands]            [Web-UI + WebSocket]
```

### IPC-Flow

1. **Dashboard → Remote Agent**: `gameserver:START_SERVER`
2. **Remote Agent → Dashboard**: `gameserver:STATUS_UPDATE`
3. **Dashboard → Bot**: `gameserver:NOTIFY_GUILD` (Discord-Benachrichtigung)

---

## 3. Datenbank-Schema

### gameservers Tabelle

```sql
-- plugins/gameserver/shared/schemas/gameservers.sql
CREATE TABLE IF NOT EXISTS gameservers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    guild_id VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    game_type ENUM('minecraft', 'ark', 'rust', 'csgo', 'valheim', 'custom') NOT NULL,
    host_type ENUM('local', 'remote') NOT NULL,
    agent_id VARCHAR(255), -- Für Remote-Agents (NULL = lokal)
    docker_container_id VARCHAR(255),
    
    -- Ressourcen
    memory_mb INT DEFAULT 2048,
    cpu_cores FLOAT DEFAULT 2.0,
    disk_gb INT DEFAULT 10,
    port INT,
    
    -- Status
    status ENUM('stopped', 'starting', 'running', 'stopping', 'error') DEFAULT 'stopped',
    last_start TIMESTAMP NULL,
    last_stop TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    -- Config (JSON)
    config JSON, -- Game-spezifische Settings (z.B. Minecraft: difficulty, gamemode)
    env_vars JSON, -- Environment-Variablen für Docker
    
    -- Statistiken
    total_uptime_minutes INT DEFAULT 0,
    total_restarts INT DEFAULT 0,
    
    INDEX idx_guild (guild_id),
    INDEX idx_agent (agent_id),
    INDEX idx_status (status),
    INDEX idx_game_type (game_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### gameserver_agents Tabelle

```sql
-- plugins/gameserver/shared/schemas/gameserver_agents.sql
CREATE TABLE IF NOT EXISTS gameserver_agents (
    id VARCHAR(255) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    host VARCHAR(255) NOT NULL,
    port INT NOT NULL,
    status ENUM('online', 'offline', 'maintenance') DEFAULT 'offline',
    last_ping TIMESTAMP,
    
    -- Ressourcen-Limits
    max_memory_gb INT DEFAULT 32,
    max_cpu_cores INT DEFAULT 8,
    max_servers INT DEFAULT 10,
    
    -- Aktuelle Auslastung
    current_servers INT DEFAULT 0,
    current_memory_gb FLOAT DEFAULT 0,
    current_cpu_percent FLOAT DEFAULT 0,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### server_templates Tabelle

```sql
-- plugins/gameserver/shared/schemas/server_templates.sql
CREATE TABLE IF NOT EXISTS server_templates (
    id INT AUTO_INCREMENT PRIMARY KEY,
    game_type VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    
    -- Docker-Image
    docker_image VARCHAR(255) NOT NULL,
    docker_tag VARCHAR(50) DEFAULT 'latest',
    
    -- Default-Werte
    default_memory_mb INT DEFAULT 2048,
    default_cpu_cores FLOAT DEFAULT 2.0,
    default_disk_gb INT DEFAULT 10,
    default_port INT,
    
    -- Environment-Variablen Template
    env_template JSON,
    
    -- Config-Schema (für Formular-Generierung)
    config_schema JSON,
    
    -- Icon für UI
    icon VARCHAR(100) DEFAULT 'fa-solid fa-server',
    
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_game_type (game_type),
    UNIQUE KEY unique_game_template (game_type, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Standard-Templates einfügen
INSERT INTO server_templates (game_type, name, docker_image, default_port, env_template, icon) VALUES
('minecraft', 'Minecraft Java (Vanilla)', 'itzg/minecraft-server', 25565, 
 '{"EULA":"TRUE","TYPE":"VANILLA","DIFFICULTY":"normal","MODE":"survival"}', 
 'fa-solid fa-cube'),
 
('minecraft', 'Minecraft Java (Paper)', 'itzg/minecraft-server', 25565, 
 '{"EULA":"TRUE","TYPE":"PAPER","DIFFICULTY":"normal","MODE":"survival"}', 
 'fa-solid fa-cube'),
 
('ark', 'ARK: Survival Evolved', 'thmhoag/arkserver', 7777, 
 '{"SESSIONNAME":"ARK Server","SERVERMAP":"TheIsland","SERVERPASSWORD":""}', 
 'fa-solid fa-dragon'),
 
('rust', 'Rust Dedicated Server', 'didstopia/rust-server', 28015, 
 '{"RUST_SERVER_NAME":"Rust Server","RUST_SERVER_SEED":"12345"}', 
 'fa-solid fa-wrench'),
 
('valheim', 'Valheim Dedicated Server', 'lloesche/valheim-server', 2456, 
 '{"SERVER_NAME":"Valheim Server","WORLD_NAME":"Dedicated","SERVER_PASS":""}', 
 'fa-solid fa-hammer');
```

---

## 4. Implementierungs-Phasen

### Phase 1: Lokale Server (Docker auf gleichem Server)

**Ziel**: Grundlegende Gameserver-Verwaltung mit Docker auf dem Dashboard-Server

#### Todo:
- [ ] **Database Schema** erstellen
  - [ ] `gameservers.sql`
  - [ ] `server_templates.sql`
  - [ ] Migration-Script für bestehende DB

- [ ] **Shared Models** erstellen
  - [ ] `GameServer.js` - CRUD für Server
  - [ ] `ServerTemplate.js` - Template-Verwaltung

- [ ] **LocalServerManager** implementieren
  ```javascript
  // plugins/gameserver/shared/managers/LocalServerManager.js
  const Docker = require('dockerode');
  
  class LocalServerManager {
      constructor() {
          this.docker = new Docker();
          this.processes = new Map();
      }

      async createServer(config) {
          // Docker-Container erstellen
          const container = await this.docker.createContainer({
              Image: config.image,
              name: `gameserver-${config.guildId}-${config.name}`,
              Env: this._buildEnvVars(config),
              HostConfig: {
                  PortBindings: this._buildPortBindings(config),
                  Memory: config.memory * 1024 * 1024,
                  CpuQuota: config.cpu * 1000
              }
          });
          return container;
      }

      async startServer(serverId) { /* ... */ }
      async stopServer(serverId) { /* ... */ }
      async restartServer(serverId) { /* ... */ }
      async deleteServer(serverId) { /* ... */ }
      async getServerStats(serverId) { /* ... */ }
  }
  ```

- [ ] **Dashboard Routes** erstellen
  - [ ] `/servers` - Server-Liste
  - [ ] `/servers/create` - Server erstellen
  - [ ] `/servers/:id/manage` - Server verwalten
  - [ ] `/servers/:id/console` - Console-View

- [ ] **Dashboard Views** erstellen
  - [ ] `servers-list.ejs` - Tabelle mit allen Servern
  - [ ] `create-server.ejs` - Formular (Template auswählen)
  - [ ] `manage-server.ejs` - Start/Stop/Restart-Buttons + Stats

- [ ] **Bot Commands** implementieren
  - [ ] `/server list` - Server auflisten
  - [ ] `/server start <name>` - Server starten
  - [ ] `/server stop <name>` - Server stoppen
  - [ ] `/server status <name>` - Server-Status anzeigen

- [ ] **Navigation registrieren**
  ```javascript
  {
      title: 'Gameserver',
      path: `/guild/${guildId}/plugins/gameserver`,
      icon: 'fa-solid fa-server',
      order: 60
  }
  ```

---

### Phase 2: Remote-Agent für andere Server

**Ziel**: Server auf anderen Maschinen verwalten können

#### Todo:
- [ ] **IPCAgentClient** erstellen (basierend auf IPCClient)
  ```javascript
  // plugins/gameserver/agent/IPCAgentClient.js
  const veza = require('veza');
  
  class GameServerAgent {
      constructor(config) {
          this.agentId = config.agentId;
          this.node = new veza.Client(`GameServer-Agent-${this.agentId}`, {
              retryTime: 5000
          });
          this.serverManager = new LocalServerManager();
      }

      async connect(dashboardHost, dashboardPort) {
          await this.node.connectTo(dashboardPort, dashboardHost);
          this.node.on('message', this.handleMessage.bind(this));
      }

      async handleMessage(message) {
          const { event, payload } = message.data;
          
          switch (event) {
              case 'gameserver:START_SERVER':
                  const result = await this.serverManager.startServer(payload.serverId);
                  message.reply({ success: true, data: result });
                  break;

              case 'gameserver:STOP_SERVER':
                  await this.serverManager.stopServer(payload.serverId);
                  message.reply({ success: true });
                  break;

              case 'gameserver:GET_STATS':
                  const stats = await this.serverManager.getStats(payload.serverId);
                  message.reply({ success: true, data: stats });
                  break;
          }
      }

      async sendStatusUpdate(serverId, status) {
          await this.node.sendTo('Dashboard', 'gameserver:STATUS_UPDATE', {
              serverId, status
          });
      }
  }
  ```

- [ ] **Dashboard IPC-Handler** erweitern
  - [ ] `gameserver:START_SERVER` → an Agent weiterleiten
  - [ ] `gameserver:STATUS_UPDATE` → in DB speichern + WebSocket senden

- [ ] **Agent-Management UI** erstellen
  - [ ] `/gameserver/agents` - Agent-Liste
  - [ ] Agent hinzufügen/entfernen
  - [ ] Agent-Status anzeigen (Online/Offline)

- [ ] **Agent-Deployment-Script**
  ```bash
  # deploy-agent.sh
  ssh remote-server "
    cd /opt/gameserver-agent
    git pull
    npm install
    pm2 restart gameserver-agent
  "
  ```

---

### Phase 3: WebSocket-Console & Live-Status

**Ziel**: Echtzeit-Logs und Status-Updates im Dashboard

#### Todo:
- [ ] **Socket.IO Integration** im Dashboard
  ```javascript
  // plugins/gameserver/dashboard/index.js
  const io = require('socket.io')(app.server);
  
  io.of('/gameserver').on('connection', (socket) => {
      socket.on('subscribe-console', async ({ serverId }) => {
          // Berechtigung prüfen
          const hasAccess = await checkServerAccess(socket.userId, serverId);
          if (!hasAccess) return socket.emit('error', 'Keine Berechtigung');

          // Logs vom Agent abonnieren
          const ipcServer = ServiceManager.get('ipcServer');
          await ipcServer.send('Agent-1', 'gameserver:SUBSCRIBE_LOGS', {
              serverId,
              socketId: socket.id
          });
      });

      socket.on('console-command', async ({ serverId, command }) => {
          // Command an Server senden
          await ipcServer.send('Agent-1', 'gameserver:EXEC_COMMAND', {
              serverId, command
          });
      });
  });
  ```

- [ ] **Frontend WebSocket-Client**
  ```javascript
  // plugins/gameserver/dashboard/public/js/server-console.js
  const socket = io('/gameserver');
  
  socket.emit('subscribe-console', { serverId: 123 });
  
  socket.on('console-line', (line) => {
      const consoleDiv = document.getElementById('console-output');
      consoleDiv.innerHTML += `<div>${escapeHtml(line)}</div>`;
      consoleDiv.scrollTop = consoleDiv.scrollHeight;
  });
  
  function sendCommand(command) {
      socket.emit('console-command', { serverId: 123, command });
  }
  ```

- [ ] **Agent Log-Streaming**
  - [ ] Docker-Logs in Echtzeit streamen
  - [ ] Über IPC an Dashboard senden
  - [ ] Dashboard → WebSocket → Browser

- [ ] **Live-Status-Updates**
  - [ ] CPU/RAM-Auslastung anzeigen
  - [ ] Spieler-Count (bei Minecraft/ARK)
  - [ ] Uptime-Timer

---

### Phase 4: Multi-Game-Support & Templates

**Ziel**: Verschiedene Gameserver-Typen unterstützen

#### Todo:
- [ ] **Game-Templates implementieren**
  - [ ] Minecraft (Vanilla, Paper, Spigot, Forge, Fabric)
  - [ ] ARK: Survival Evolved
  - [ ] Rust
  - [ ] CS:GO / CS2
  - [ ] Valheim
  - [ ] Terraria

- [ ] **Template-Konfigurator UI**
  - [ ] Dynamisches Formular basierend auf `config_schema`
  - [ ] Vorschau der Docker-Umgebungsvariablen
  - [ ] Validierung der Werte

- [ ] **Backup-System**
  - [ ] Automatische Backups (täglich/wöchentlich)
  - [ ] Backup-Download via Dashboard
  - [ ] Backup-Restore

- [ ] **Server-Klonen**
  - [ ] Bestehenden Server als Template nutzen
  - [ ] Config kopieren

---

## 5. Technische Details

### Docker-Images (empfohlen)

| Game | Docker-Image | Port | Notes |
|------|--------------|------|-------|
| Minecraft | `itzg/minecraft-server` | 25565 | Unterstützt Vanilla, Paper, Forge, etc. |
| ARK | `thmhoag/arkserver` | 7777 | TheIsland Map default |
| Rust | `didstopia/rust-server` | 28015 | Server-Name via ENV |
| CS:GO | `cm2network/csgo` | 27015 | Legacy (CS2 noch kein stabiles Image) |
| Valheim | `lloesche/valheim-server` | 2456 | Server-Pass via ENV |
| Terraria | `ryshe/terraria` | 7777 | World-Name via Volume |

### IPC-Events (Dashboard ↔ Agent)

**Von Dashboard an Agent:**
- `gameserver:START_SERVER` - Server starten
- `gameserver:STOP_SERVER` - Server stoppen
- `gameserver:RESTART_SERVER` - Server neu starten
- `gameserver:DELETE_SERVER` - Server löschen
- `gameserver:GET_STATS` - Stats abrufen
- `gameserver:EXEC_COMMAND` - Console-Command ausführen
- `gameserver:SUBSCRIBE_LOGS` - Log-Stream starten

**Von Agent an Dashboard:**
- `gameserver:STATUS_UPDATE` - Status-Update (running, stopped, etc.)
- `gameserver:STATS_UPDATE` - CPU/RAM/Network-Stats
- `gameserver:LOG_LINE` - Console-Log-Zeile
- `gameserver:PLAYER_JOIN` - Spieler beigetreten (bei Minecraft/ARK)
- `gameserver:PLAYER_LEAVE` - Spieler verlassen
- `gameserver:ERROR` - Fehler aufgetreten

### Dashboard Routes

| Route | Method | Beschreibung |
|-------|--------|--------------|
| `/guild/:gid/gameserver` | GET | Server-Liste |
| `/guild/:gid/gameserver/create` | GET/POST | Server erstellen |
| `/guild/:gid/gameserver/:id` | GET | Server-Details |
| `/guild/:gid/gameserver/:id/start` | POST | Server starten |
| `/guild/:gid/gameserver/:id/stop` | POST | Server stoppen |
| `/guild/:gid/gameserver/:id/restart` | POST | Server neu starten |
| `/guild/:gid/gameserver/:id/delete` | DELETE | Server löschen |
| `/guild/:gid/gameserver/:id/console` | GET | Console-View |
| `/guild/:gid/gameserver/agents` | GET | Agent-Verwaltung |

### Bot Slash-Commands

```javascript
/server list              # Alle Server der Guild auflisten
/server create <game>     # Server erstellen (öffnet Dashboard-Link)
/server start <name>      # Server starten
/server stop <name>       # Server stoppen
/server restart <name>    # Server neu starten
/server status <name>     # Server-Status anzeigen
/server players <name>    # Spieler-Liste (bei Minecraft/ARK)
/server delete <name>     # Server löschen (nur Owner)
```

---

## 6. Sicherheits-Überlegungen

### Berechtigungen
- [ ] Guild-Owner: Alle Operationen
- [ ] Admin-Rolle: Start/Stop/Restart
- [ ] Moderator-Rolle: Nur Status anzeigen
- [ ] Custom-Rollen via Permission-System

### Docker-Security
- [ ] Container-Limits (Memory, CPU, Disk)
- [ ] Read-Only-Filesystem wo möglich
- [ ] Keine Privileged-Container
- [ ] Network-Isolation zwischen Servern

### Agent-Authentifizierung
- [ ] API-Key-basierte Authentifizierung
- [ ] Verschlüsselte Verbindung (TLS)
- [ ] Rate-Limiting für IPC-Calls

---

## 7. Monitoring & Logging

### Metriken sammeln
- [ ] Server-Uptime
- [ ] Durchschnittliche Spieler-Zahl
- [ ] Restart-Count
- [ ] Ressourcen-Auslastung (CPU/RAM)

### Logs
- [ ] Server-Logs in DB speichern (letzte 1000 Zeilen)
- [ ] Error-Logs separat
- [ ] Audit-Log für Admin-Aktionen

### Alerts
- [ ] Discord-Benachrichtigung bei Server-Crash
- [ ] Warnung bei hoher CPU/RAM-Auslastung
- [ ] Benachrichtigung bei erfolgreicher Backup-Erstellung

---

## 8. Deployment-Strategie

### Lokaler Server (Phase 1)
```bash
# Auf dem Dashboard-Server (91.200.102.182)
cd /home/firedervil/dunebot_prod
npm install dockerode socket.io

# Plugin aktivieren
# Im Dashboard: SuperAdmin → Plugins → gameserver → Enable
```

### Remote Agent (Phase 2)
```bash
# Auf dem Remote-Server
mkdir -p /opt/gameserver-agent
cd /opt/gameserver-agent

# Agent-Code deployen
git clone https://github.com/FireDervil77/dunebot.git
cd dunebot/plugins/gameserver/agent

# Dependencies
npm install

# .env erstellen
cat > .env << EOF
AGENT_ID=agent-1
AGENT_NAME=Dedicated Server 1
DASHBOARD_HOST=91.200.102.182
DASHBOARD_PORT=9339
API_KEY=your-secret-key
EOF

# PM2 starten
pm2 start index.js --name gameserver-agent-1
pm2 save
```

---

## 9. Testing-Plan

### Unit-Tests
- [ ] LocalServerManager CRUD-Operationen
- [ ] Docker-Container-Erstellung
- [ ] IPC-Message-Handling

### Integration-Tests
- [ ] Bot → Dashboard → Agent Flow
- [ ] Server erstellen → starten → stoppen → löschen
- [ ] WebSocket-Verbindung

### E2E-Tests
- [ ] Minecraft-Server erstellen via Dashboard
- [ ] Server starten via Discord-Command
- [ ] Logs im Dashboard-Console anzeigen

---

## 10. Ressourcen & Links

### Docker-Images
- Minecraft: https://github.com/itzg/docker-minecraft-server
- ARK: https://github.com/thmhoag/arkserver
- Rust: https://github.com/Didstopia/rust-server
- Valheim: https://github.com/lloesche/valheim-server-docker

### Libraries
- `dockerode`: https://github.com/apocas/dockerode
- `socket.io`: https://socket.io/docs/v4/
- `veza`: https://github.com/kyranet/veza (bereits im Projekt)

### Alternativen
- **Pterodactyl**: https://pterodactyl.io/ (fertiges Panel, könnte als Wrapper genutzt werden)
- **AMP (CubeCoders)**: https://cubecoders.com/AMP (proprietär, keine API)

---

## 11. Nächste Schritte

1. **Entscheidung**: Lokale Server zuerst oder direkt mit Remote-Agent?
   - **Empfehlung**: Phase 1 (Lokal) → schnellere Entwicklung, weniger Komplexität

2. **Datenbank-Schema** erstellen und testen

3. **LocalServerManager** Prototyp mit Minecraft-Image

4. **Dashboard-Route** `/gameserver/servers` mit Basis-UI

5. **Bot-Command** `/server list` als Proof-of-Concept

---

## 12. Offene Fragen

- [ ] Sollen User eigene Docker-Images hochladen können? (Sicherheitsrisiko!)
- [ ] Backup-Storage: Lokal oder S3/Object-Storage?
- [ ] Wie viele Concurrent-Server pro Guild? (Limit setzen?)
- [ ] Abrechnung/Credits-System für Ressourcen? (später)
- [ ] SFTP-Zugriff für Datei-Upload? (später, via Pterodactyl-Integration?)

---

**Erstellt am**: 2025-10-04  
**Autor**: GitHub Copilot (auf Basis des DuneBot-Projekts)  
**Status**: Planning / Todo  
**Geschätzte Entwicklungszeit**: 
- Phase 1: ~2-3 Wochen
- Phase 2: ~1 Woche
- Phase 3: ~1 Woche
- Phase 4: ~2 Wochen
