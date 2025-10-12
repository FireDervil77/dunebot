# FireBot Gameserver Management - Architektur & Konzept

**Stand:** 11. Oktober 2025  
**Status:** Brainstorming / Konzeptphase

---

## 🎯 Projektziel

Mit dem FireBot Dashboard sollen Gameserver-Metriken bereitgestellt und gesteuert werden können. User installieren einen Daemon auf ihren eigenen Servern, der sich mit der zentralen Bot-Infrastruktur verbindet.

---

## 🏗️ Architektur-Überblick

### High-Level-Struktur

```
┌─────────────────────────────────────────────────────┐
│          Zentrale Infrastruktur (FireBot)           │
│                                                     │
│  ┌─────────────┐         ┌─────────────┐          │
│  │ Discord Bot │         │  Dashboard  │          │
│  └──────┬──────┘         └──────┬──────┘          │
│         │                       │                  │
│         └───────────┬───────────┘                  │
│                     │                              │
│              ┌──────▼──────┐                       │
│              │   Registry  │  (Daemon-Verwaltung)  │
│              │   Service   │                       │
│              └──────┬──────┘                       │
└─────────────────────┼──────────────────────────────┘
                      │
        ┌─────────────┼─────────────┐
        │             │             │
        ▼             ▼             ▼
   [Internet - verschlüsselte Verbindungen]
        │             │             │
        ▼             ▼             ▼
┌───────────────┐ ┌───────────────┐ ┌───────────────┐
│  Guild A      │ │  Guild B      │ │  Guild C      │
│  User Server  │ │  User Server  │ │  User Server  │
│               │ │               │ │               │
│  ┌─────────┐  │ │  ┌─────────┐  │ │  ┌─────────┐  │
│  │ Daemon  │  │ │  │ Daemon  │  │ │  │ Daemon  │  │
│  └────┬────┘  │ │  └────┬────┘  │ │  └────┬────┘  │
│       │       │ │       │       │ │       │       │
│  ┌────▼────┐  │ │  ┌────▼────┐  │ │  ┌────▼────┐  │
│  │Minecraft│  │ │  │ Valheim │  │ │  │   Rust  │  │
│  │ Server  │  │  │  │ Server  │  │ │  │ Server  │  │
│  └─────────┘  │ │  └─────────┘  │ │  └─────────┘  │
└───────────────┘ └───────────────┘ └───────────────┘
```

### Deployment-Modell

**Reverse-Connection-Architektur:**
- Daemon läuft auf User-Servern (hinter Firewall/NAT)
- Daemon verbindet sich **aktiv** zur zentralen Infrastruktur
- Keine Inbound-Ports auf User-Servern nötig
- Kommunikation über persistent WebSocket-Verbindung

---

## 🧩 Komponenten-Übersicht

### 1. Master-Plugin (Bot & Dashboard)

**Zweck:** Zentrale Steuerungskomponente im bestehenden DuneBot-System

**Bot-Funktionen:**
- Discord-Commands (`/server start`, `/server stop`, `/server restart`, `/serverlogs`)
- Permission-Checks (wer darf was?)
- IPC-Integration mit Registry Service
- Event-Logging in Discord-Channels

**Dashboard-Funktionen:**
- Daemon-Management-Interface
- Token-Generation für Daemon-Registrierung
- Setup-Wizard für User
- Server-Übersicht & Kontrolle
- Live-Log-Stream-Anzeige
- Permission-Management
- Plugin-Installation für Sub-Plugins (Minecraft, Valheim, etc.)

**Navigation:**
- Eigene Hauptnavigation "Gameserver"
- Sub-Menüs: Dashboard, Server, Settings, Logs

---

### 2. Registry Service (Zentral)

**Zweck:** Vermittler zwischen Bot/Dashboard und User-Daemons

**Kern-Aufgaben:**
- Daemon-Registrierung entgegennehmen & validieren
- WebSocket-Verbindungen zu Daemons verwalten
- Routing: Befehle von Bot/Dashboard zum richtigen Daemon leiten
- Heartbeat-Monitoring (Daemon online/offline Detection)
- Response-Handling zurück an Bot/Dashboard

**Technische Details:**
- Kann in Dashboard integriert oder separater Service sein
- Muss persistent WebSocket-Verbindungen halten
- Benötigt Datenbank für Daemon-Registry

**Deployment-Optionen:**
- **Option A:** In Dashboard integriert (einfacher, aber Dashboard-Restart = alle Daemons disconnecten)
- **Option B:** Separater Service (unabhängig, skalierbar, aber mehr Komplexität)

---

### 3. Daemon (User-installiert)

**Zweck:** Agent auf User-Server, steuert lokale Gameserver

**Kern-Funktionen:**
- Selbst-Registrierung mit Auth-Token
- Persistente WebSocket-Verbindung zum Registry Service
- Heartbeat senden (alle 30s)
- Befehle empfangen & ausführen (start/stop/restart)
- Lokale Gameserver steuern (systemd, docker, direkte Prozess-Kontrolle)
- Log-Streaming
- Auto-Update-Mechanismus

**Deployment-Formen:**
- Binary (Linux/Windows) - gepackt mit pkg/nexe (Node.js) oder direkt (Go)
- Docker-Image
- NPM-Package (für Devs)

**Installation-Experience:**
```bash
# Linux
curl -O https://yourbot.com/download/daemon-linux
chmod +x daemon-linux
./daemon-linux --token YOUR_TOKEN_HERE

# Windows
daemon-windows.exe --token YOUR_TOKEN_HERE

# Docker
docker run -e TOKEN=YOUR_TOKEN_HERE yourbot/daemon
```

---

### 4. Sub-Plugins

**Zweck:** Gameserver-spezifische Erweiterungen

**Beispiele:**
- **Minecraft Plugin:** RCON-Integration, Query-Protocol, Player-List
- **Valheim Plugin:** Steam API, Backup-Management
- **Voice Server Plugin:** TeamSpeak/Mumble/Discord-Bot-Integration

**Architektur:**
- Erben von gemeinsamer "GameserverPlugin"-Base-Class
- Eigene Commands & Dashboard-Views
- Können eigene Datenbank-Tabellen registrieren

---

## 🔐 Security-Konzept

### Token-basierte Registrierung

**Problem:** Jeder könnte einen Daemon starten und behaupten er ist Guild X

**Lösung - Registration-Flow:**

1. Guild-Admin geht ins Dashboard → "Daemon hinzufügen"
2. Dashboard generiert einmaligen **Registration-Token** (64-Zeichen-String)
   - Token wird in DB gespeichert (hashed)
   - Expires nach 1 Stunde
3. User kopiert Token und startet Daemon mit Token
4. Daemon verbindet sich zu Registry, schickt Token
5. Registry validiert Token:
   - Token gültig? → Registrierung erfolgreich
   - Token wird als "used" markiert und ungültig
6. Daemon bekommt **Session-Token** für weitere Kommunikation
7. Session-Token wird für alle weiteren Requests verwendet

**Zusätzliche Security-Maßnahmen:**
- IP-Whitelisting (optional, falls User statische IP hat)
- Rate-Limiting auf Registry
- Automatisches Token-Timeout
- Session-Token-Rotation alle 24h

---

### Verschlüsselung

**Kommunikations-Ebenen:**

**Bot ↔ Registry:**
- IPC über Veza (bereits etabliert)
- Kann mit AES-256 verschlüsselt werden

**Dashboard ↔ Registry:**
- WebSocket mit TLS
- Payload-Verschlüsselung via AES-256-GCM

**Registry ↔ Daemon:**
- WebSocket mit TLS (wss://)
- Payload-Verschlüsselung via AES-256-GCM
- Session-Keys pro Verbindung (Forward Secrecy)

**Key-Management:**
- Master-Plugin generiert Guild-spezifischen AES-Key
- Key wird verschlüsselt in DB gespeichert (at-rest encryption)
- Session-Keys werden per ECDH ausgetauscht

---

## 📊 Datenbank-Schema

### Neue Tabellen

#### `gameserver_master_settings`
```sql
guild_id VARCHAR(20) PRIMARY KEY
daemon_host VARCHAR(255)
daemon_port INT
daemon_ws_port INT
encryption_key VARCHAR(64)      -- AES Key (encrypted at rest)
management_role_id VARCHAR(20)
command_channel_id VARCHAR(20)
log_channel_id VARCHAR(20)
daemon_status ENUM('online', 'offline', 'error')
last_ping TIMESTAMP
created_at TIMESTAMP
updated_at TIMESTAMP
```

#### `daemon_instances`
```sql
id INT PRIMARY KEY AUTO_INCREMENT
guild_id VARCHAR(20)
daemon_id UUID UNIQUE
auth_token_hash VARCHAR(255)
session_token VARCHAR(255)
status ENUM('online', 'offline', 'error', 'updating')
version VARCHAR(20)
os_info VARCHAR(255)
host_ip VARCHAR(45)
last_heartbeat TIMESTAMP
registered_at TIMESTAMP
```

#### `daemon_tokens`
```sql
id INT PRIMARY KEY AUTO_INCREMENT
token_hash VARCHAR(255) UNIQUE
guild_id VARCHAR(20)
created_by VARCHAR(20)         -- User-ID
expires_at TIMESTAMP
used TINYINT(1) DEFAULT 0
used_at TIMESTAMP NULL
```

#### `gameserver_servers`
```sql
id INT PRIMARY KEY AUTO_INCREMENT
guild_id VARCHAR(20)
daemon_id UUID                  -- Foreign Key zu daemon_instances
server_name VARCHAR(100)
server_type ENUM('minecraft', 'valheim', 'ark', 'rust', 'custom')
server_host VARCHAR(255)
server_port INT
rcon_port INT
rcon_password VARCHAR(255)
ssh_host VARCHAR(255)
ssh_port INT DEFAULT 22
ssh_user VARCHAR(100)
ssh_key_path VARCHAR(255)
status ENUM('online', 'offline', 'starting', 'stopping', 'error')
auto_restart TINYINT(1) DEFAULT 0
created_at TIMESTAMP
```

#### `gameserver_permissions`
```sql
id INT PRIMARY KEY AUTO_INCREMENT
guild_id VARCHAR(20)
user_id VARCHAR(20)
can_start TINYINT(1) DEFAULT 0
can_stop TINYINT(1) DEFAULT 0
can_restart TINYINT(1) DEFAULT 0
can_view_logs TINYINT(1) DEFAULT 1
can_configure TINYINT(1) DEFAULT 0
created_at TIMESTAMP
UNIQUE KEY unique_user_guild (guild_id, user_id)
```

#### `gameserver_logs`
```sql
id INT PRIMARY KEY AUTO_INCREMENT
guild_id VARCHAR(20)
server_id INT
user_id VARCHAR(20)
action ENUM('start', 'stop', 'restart', 'config_change', 'error')
message TEXT
timestamp TIMESTAMP
INDEX idx_guild_server (guild_id, server_id)
INDEX idx_timestamp (timestamp)
```

#### `gameserver_plugin_configs`
```sql
id INT PRIMARY KEY AUTO_INCREMENT
guild_id VARCHAR(20)
server_id INT
plugin_name VARCHAR(100)
config JSON                     -- Flexibles Schema für Sub-Plugins
created_at TIMESTAMP
updated_at TIMESTAMP
```

---

## 🔄 Kommunikations-Flows

### Flow 1: Daemon-Registrierung

```
User (Dashboard)
    │
    ├─→ [1] "Daemon hinzufügen" klicken
    │
Dashboard
    │
    ├─→ [2] Token generieren (64 Zeichen)
    ├─→ [3] Token in DB speichern (hashed, expires in 1h)
    ├─→ [4] Token + Download-Link anzeigen
    │
User (Server)
    │
    ├─→ [5] Daemon binary herunterladen
    ├─→ [6] `./daemon --token ABC123...` ausführen
    │
Daemon
    │
    ├─→ [7] WebSocket-Verbindung zu Registry aufbauen
    ├─→ [8] Registration-Message senden:
    │       { "action": "register", "token": "ABC123...", "version": "1.0.0" }
    │
Registry
    │
    ├─→ [9] Token validieren (DB-Lookup)
    ├─→ [10] Token als "used" markieren
    ├─→ [11] Session-Token generieren
    ├─→ [12] Daemon-Instanz in DB registrieren
    ├─→ [13] Response an Daemon: { "status": "success", "sessionToken": "XYZ..." }
    │
Daemon
    │
    ├─→ [14] Session-Token speichern
    ├─→ [15] Heartbeat-Loop starten (alle 30s)
    │
Dashboard
    │
    └─→ [16] Status-Update: "✅ Daemon online"
```

---

### Flow 2: Server starten via Discord

```
User (Discord)
    │
    ├─→ [1] `/server start minecraft-01`
    │
Bot
    │
    ├─→ [2] Permission-Check (DB: gameserver_permissions)
    ├─→ [3] User hat can_start = true?
    │       Falls nein → Error-Response
    │
    ├─→ [4] IPC Call zu Registry:
    │       { "action": "server_command", "guild": "123", 
    │         "command": "start", "server": "minecraft-01" }
    │
Registry
    │
    ├─→ [5] Daemon für Guild 123 finden
    ├─→ [6] Daemon online?
    │       Falls nein → Error zurück
    │
    ├─→ [7] WebSocket-Message an Daemon:
    │       { "action": "start_server", "server": "minecraft-01" }
    │
Daemon
    │
    ├─→ [8] Server-Config aus lokaler DB/Datei laden
    ├─→ [9] Start-Command ausführen:
    │       `systemctl start minecraft-01` ODER
    │       `docker start minecraft-01` ODER
    │       direkter Prozess-Start
    │
    ├─→ [10] Exit-Code prüfen
    ├─→ [11] Response an Registry:
    │        { "status": "success", "message": "Server startet..." }
    │
Registry
    │
    ├─→ [12] Response an Bot weiterleiten
    ├─→ [13] Log-Eintrag in DB schreiben
    ├─→ [14] WebSocket-Broadcast an Dashboard: "Server-Status changed"
    │
Bot
    │
    ├─→ [15] Discord-Embed senden: "🟢 minecraft-01 wird gestartet..."
    │
Dashboard (falls offen)
    │
    └─→ [16] Live-Update: Server-Status = "starting"
```

---

### Flow 3: Live-Logs streamen

```
User (Dashboard)
    │
    ├─→ [1] "Logs anzeigen" für Server XYZ klicken
    │
Dashboard
    │
    ├─→ [2] WebSocket-Verbindung zu Registry aufbauen
    ├─→ [3] Subscribe-Message: 
    │       { "action": "subscribe_logs", "server_id": "XYZ" }
    │
Registry
    │
    ├─→ [4] Daemon für diesen Server finden
    ├─→ [5] WebSocket-Message an Daemon:
    │       { "action": "stream_logs", "server": "XYZ" }
    │
Daemon
    │
    ├─→ [6] Log-File öffnen (z.B. `tail -f /path/to/server.log`)
    ├─→ [7] Log-Zeilen buffern (alle 2 Sekunden)
    ├─→ [8] Buffer an Registry senden:
    │       { "action": "log_chunk", "server": "XYZ", "lines": [...] }
    │
Registry
    │
    ├─→ [9] Log-Chunk an Dashboard weiterleiten
    │
Dashboard
    │
    └─→ [10] Logs in UI anzeigen (Auto-Scroll)
```

---

## 🚀 Implementierungs-Roadmap

### Phase 1: Foundation (Master-Plugin)
- [ ] Datenbank-Schema erstellen
- [ ] Master-Plugin Grundstruktur (Bot + Dashboard)
- [ ] Token-Generation & Management
- [ ] Setup-Wizard UI im Dashboard
- [ ] Permission-System implementieren
- [ ] Basic Bot-Commands (`/gameserver setup`, `/gameserver status`)

### Phase 2: Registry Service
- [ ] Registry-Service als separaten Node-Dienst aufsetzen
- [ ] WebSocket-Server für Daemon-Verbindungen
- [ ] Daemon-Registrierung implementieren
- [ ] Heartbeat-Monitoring
- [ ] IPC-Integration mit Bot
- [ ] WebSocket-Integration mit Dashboard

### Phase 3: Daemon Development
- [ ] Daemon-Grundstruktur (Node.js oder Go)
- [ ] WebSocket-Client für Registry-Verbindung
- [ ] Token-basierte Authentifizierung
- [ ] Heartbeat-Loop
- [ ] Command-Handler (start/stop/restart)
- [ ] Local Gameserver-Control (systemd/docker)
- [ ] Log-Streaming-Mechanismus
- [ ] Binary-Packaging (pkg/nexe oder Go-Build)

### Phase 4: Server Control Integration
- [ ] SSH Connection Manager im Daemon
- [ ] systemd Integration
- [ ] Docker Integration
- [ ] Prozess-Monitoring
- [ ] Auto-Restart-Mechanismus
- [ ] Status-Reporting

### Phase 5: Dashboard Features
- [ ] Server-Übersicht-Page
- [ ] Server hinzufügen/bearbeiten
- [ ] Control-Buttons (Start/Stop/Restart)
- [ ] Live-Status-Display
- [ ] Log-Viewer mit Live-Stream
- [ ] Daemon-Status-Anzeige
- [ ] Permission-Management-UI

### Phase 6: Sub-Plugins
- [ ] Minecraft Plugin (RCON, Query Protocol)
- [ ] Valheim Plugin (Steam API)
- [ ] Voice Server Plugin (TeamSpeak/Mumble)

### Phase 7: Advanced Features
- [ ] Auto-Update-Mechanismus für Daemon
- [ ] Multi-Daemon-Support (ein User, mehrere Server)
- [ ] Backup-Management
- [ ] Scheduled Restarts
- [ ] Performance-Monitoring (CPU/RAM/Disk)
- [ ] Alert-System (Server down → Discord-Notification)

---

## 🤔 Offene Entscheidungen

### 1. Daemon-Sprache

**Option A: Node.js**
- ✅ Code-Sharing mit Bot/Dashboard
- ✅ Schnelle Entwicklung, bekanntes Ökosystem
- ✅ WebSocket-Support erstklassig
- 🟡 Binary mit pkg ~50MB
- 🔴 Runtime-Dependencies (außer bei pkg)

**Option B: Go**
- ✅ Binary ~10MB, standalone
- ✅ Keine Runtime-Dependencies
- ✅ Bessere Performance
- ✅ Einfaches Cross-Compiling
- 🔴 Keine Code-Sharing
- 🔴 Lernkurve

**Empfehlung:** Go für Production-Daemon (Deployment-Vorteile überwiegen)

---

### 2. Registry Service - Deployment

**Option A: In Dashboard integriert**
- ✅ Einfacher, keine zusätzliche Infrastruktur
- ✅ Shared Database-Connection
- 🔴 Dashboard-Restart = alle Daemons disconnecten
- 🔴 Keine horizontale Skalierung

**Option B: Separater Service**
- ✅ Unabhängig von Dashboard
- ✅ Kann horizontal skalieren
- ✅ Daemon-Verbindungen bleiben bei Dashboard-Updates
- 🔴 Mehr Komplexität
- 🔴 Zusätzlicher Port/Service zu managen

**Empfehlung:** Start mit Option A für MVP, später zu Option B migrieren

---

### 3. Daemon-Distribution

**Option A: GitHub Releases**
- ✅ Kostenlos
- ✅ Automatisches Versioning
- 🔴 User müssen zu GitHub

**Option B: Eigener CDN/Server**
- ✅ Volle Kontrolle
- ✅ Download-Tracking
- 🔴 Bandwidth-Kosten

**Option C: Hybrid**
- GitHub für Source + Releases
- Eigener Mirror für schnellere Downloads
- Dashboard zeigt beide Links

**Empfehlung:** Option C (Hybrid)

---

### 4. Gameserver-Zugriff

**Szenario A: Daemon läuft auf gleichem Host wie Gameserver**
- Direkter Zugriff via systemd/docker/Prozess-Control
- Keine zusätzliche Authentifizierung nötig
- **Einfachster Fall**

**Szenario B: Daemon läuft auf separatem Management-Server**
- SSH-Verbindungen zu Gameservern
- SSH-Key-Management erforderlich
- **Komplexer, aber flexibler**

**Empfehlung:** Szenario A für MVP, Szenario B als Advanced-Feature

---

## 📦 Daemon-Versioning

### Semantic Versioning
```
v1.2.3
│ │ └─ Patch (Bugfixes, rückwärtskompatibel)
│ └─── Minor (neue Features, rückwärtskompatibel)
└───── Major (Breaking Changes, API-Änderungen)
```

### Version-Kompatibilität
- Daemon sendet Version bei Registration
- Registry vergleicht mit `MIN_DAEMON_VERSION`
- Falls zu alt → Warning im Dashboard
- Bei Breaking Changes: Registry lehnt alte Versionen ab

### Auto-Update-Mechanismus
1. Daemon prüft bei Heartbeat auf neue Version
2. Registry sendet Update-Info: `{ "updateAvailable": true, "version": "1.3.0", "url": "..." }`
3. Daemon lädt neue Version herunter
4. Daemon startet neu mit neuer Binary
5. Old Binary wird als Backup behalten

---

## 🛠️ Development-Setup für Testing

### Local-Testing-Environment

**Terminal 1: Bot**
```bash
cd dunebot_dev
pm2 start ecosystem.config.js --only dunebot-bot-dev
```

**Terminal 2: Dashboard (mit integrierter Registry)**
```bash
cd dunebot_dev
pm2 start ecosystem.config.js --only dunebot-dashboard-dev
```

**Terminal 3: Daemon (lokal)**
```bash
cd daemon
npm install
node index.js --token YOUR_TEST_TOKEN --registry ws://localhost:4503
```

**Terminal 4: Mock-Gameserver**
```bash
# Simple Server-Simulation für Tests
while true; do echo "Server läuft..."; sleep 5; done
```

---

## 📋 User-Dokumentation (Entwurf)

### Setup-Guide für Guild-Admins

**Schritt 1: Master-Plugin aktivieren**
1. Im Dashboard: Plugins → Gameserver Master → Aktivieren
2. Erste Einrichtung: Management-Role auswählen, Channels konfigurieren

**Schritt 2: Daemon installieren**
1. Dashboard → Gameserver → Setup → "Daemon hinzufügen"
2. Token kopieren (gültig für 1 Stunde)
3. Binary für dein System herunterladen
4. Auf deinem Server: `./daemon --token DEIN_TOKEN`
5. Warten bis "✅ Daemon online" im Dashboard erscheint

**Schritt 3: Ersten Server hinzufügen**
1. Dashboard → Gameserver → Server → "Neuer Server"
2. Server-Typ wählen (Minecraft, Valheim, etc.)
3. Start-Command angeben (z.B. `systemctl start minecraft`)
4. Server speichern

**Schritt 4: Testen**
1. Discord: `/server start dein-server-name`
2. Dashboard: Live-Status beobachten
3. Dashboard: Logs anzeigen

---

## 🔍 Troubleshooting-Guide (Entwurf)

### Daemon verbindet sich nicht

**Symptom:** "Daemon offline" im Dashboard

**Mögliche Ursachen:**
- Token abgelaufen (nach 1 Stunde)
- Firewall blockiert Outbound-Verbindung
- Registry-Service nicht erreichbar
- Falscher Registry-Host/Port

**Lösung:**
1. Neuen Token generieren
2. Firewall-Regel prüfen: Port 443 (oder konfigurierter Port) muss outbound erlaubt sein
3. Registry-URL im Dashboard-Log prüfen
4. Daemon-Logs prüfen: `./daemon --debug`

---

### Server startet nicht

**Symptom:** Command läuft, aber Server startet nicht

**Mögliche Ursachen:**
- Daemon hat keine Berechtigung (systemd/docker)
- Falscher Start-Command
- Server ist bereits am Laufen
- Port bereits belegt

**Lösung:**
1. Daemon-Logs prüfen
2. Manuell auf Server testen: `systemctl start servername`
3. Daemon-User-Permissions prüfen
4. Server-Config im Dashboard überprüfen

---

## 🎯 Success Metrics

### MVP (Minimum Viable Product)
- [ ] Ein User kann Daemon installieren und registrieren
- [ ] Ein Server kann via Discord gestartet/gestoppt werden
- [ ] Dashboard zeigt Server-Status live an
- [ ] Logs können im Dashboard angezeigt werden

### Production-Ready
- [ ] 10+ Guilds nutzen das System
- [ ] Auto-Updates funktionieren stabil
- [ ] 99.9% Daemon-Uptime
- [ ] < 2s Latenz für Commands
- [ ] Vollständige Dokumentation

---

## 📚 Referenzen & Ähnliche Systeme

**Inspiration:**
- **Pterodactyl Panel** - Open-Source Gameserver-Management
- **AMP (Application Management Panel)** - Kommerzielles Gameserver-Tool
- **LinuxGSM** - CLI-basiertes Gameserver-Management
- **Docker Swarm** - Container-Orchestrierung (für Architektur-Ideen)

**Technologie-Stack-Vergleich:**
- **Veza (IPC)** - Bereits in DuneBot verwendet
- **Socket.io** - Alternative für WebSocket (mehr Features, größer)
- **ws** - Lightweight WebSocket-Library (empfohlen)
- **gRPC** - Alternative für RPC (wenn Go-Daemon gewählt wird)

---

## 🔄 Nächste Schritte

1. **Entscheidungen treffen:**
   - Daemon-Sprache: Node.js oder Go?
   - Registry: Integriert oder separat?
   - MVP-Scope festlegen

2. **Prototyp bauen:**
   - Einfacher PoC: Token-Generation → Daemon-Registration → Ping-Command

3. **Testing:**
   - Mit eigenem Server testen
   - Beta-Tester aus der Community?

4. **Production-Rollout:**
   - Dokumentation vervollständigen
   - Binary-Builds automatisieren (CI/CD)
   - Public Announcement

---

**Ende des Dokuments**  
_Letzte Aktualisierung: 11. Oktober 2025_
