# Daemon installieren

Der FireBot Daemon ist das Programm, das auf deinem Root- oder VServer läuft und die tatsächlichen Gameserver ausführt. Er kommuniziert per WebSocket mit dem DuneBot-Dashboard.

## Voraussetzungen

- **Linux** — Ubuntu 20.04+ oder Debian 11+ empfohlen
- **Root-Zugriff** auf den Server
- **Mindestens 1 GB RAM** (zusätzlich zum RAM für die Gameserver selbst)
- **Freier Speicherplatz** für Spieldateien (je nach Spiel 5–50 GB)
- **DuneBot Dashboard** erreichbar (für die WebSocket-Verbindung)

## Installation

### Automatische Installation (empfohlen)

```bash
curl -sSL https://firenetworks.de/install.sh | sudo bash
```

Das Installationsskript:
1. Erkennt dein System (Architektur, Distribution)
2. Lädt die passende Daemon-Binary herunter
3. Startet den Setup-Wizard
4. Erstellt einen systemd-Service

### Manuelle Installation

1. Binary herunterladen:
   ```bash
   # Für AMD64 (Standard-Server)
   wget https://firenetworks.de/downloads/firebot-daemon-linux-amd64
   
   # Für ARM64 (z.B. Raspberry Pi, ARM-Server)
   wget https://firenetworks.de/downloads/firebot-daemon-linux-arm64
   ```

2. Ausführbar machen und verschieben:
   ```bash
   chmod +x firebot-daemon-linux-amd64
   sudo mv firebot-daemon-linux-amd64 /usr/local/bin/firebot-daemon
   ```

3. Setup-Wizard starten:
   ```bash
   sudo firebot-daemon setup
   ```

4. Als Service einrichten:
   ```bash
   sudo firebot-daemon install
   ```

## Setup-Wizard

Der Setup-Wizard fragt:

- **Dashboard-URL** — Die Adresse deines DuneBot-Dashboards
- **API-Token** — Wird beim Registrieren des Root-Servers im Dashboard generiert

Alternativ kannst du die Konfiguration manuell in `/etc/firebot-daemon/daemon.yaml` eintragen.

## Konfiguration (daemon.yaml)

Die Konfigurationsdatei wird beim Setup automatisch erstellt. Wichtige Felder:

```yaml
# Verbindung zum DuneBot Dashboard
dashboard:
  url: "wss://dashboard.dunebot.de"
  token: "dein-api-token"

# Root-Server Identifikation
server:
  id: "wird-automatisch-generiert"
  
# Pfade
paths:
  servers: "/home/gameservers/servers"
  backups: "/home/gameservers/backups"
  steamcmd: "/home/gameservers/steamcmd"
```

## Service verwalten

```bash
# Status prüfen
sudo systemctl status firebot-daemon

# Starten
sudo systemctl start firebot-daemon

# Stoppen
sudo systemctl stop firebot-daemon

# Neustarten
sudo systemctl restart firebot-daemon

# Logs anzeigen
sudo journalctl -u firebot-daemon -f
```

## Verbindung prüfen

Nach dem Start verbindet sich der Daemon automatisch mit dem Dashboard. Du kannst den Status prüfen:

- **Im Dashboard** → Masterserver → Root-Server-Übersicht (grüner Punkt = Online)
- **Per Bot** → `/daemon status`
- **Auf dem Server** → `sudo systemctl status firebot-daemon`

## Troubleshooting

### Daemon verbindet sich nicht

1. **Token korrekt?** — Prüfe den Token in `daemon.yaml`
2. **Dashboard erreichbar?** — `curl -I https://dein-dashboard.de`
3. **Firewall?** — Der WebSocket-Port (Standard: 9340) muss erreichbar sein
4. **Logs prüfen:** `sudo journalctl -u firebot-daemon --no-pager -n 50`

### SteamCMD-Fehler

SteamCMD wird beim ersten Gameserver-Install automatisch heruntergeladen. Falls es Probleme gibt:

```bash
# Abhängigkeiten installieren (Debian/Ubuntu)
sudo dpkg --add-architecture i386
sudo apt update
sudo apt install lib32gcc-s1 lib32stdc++6
```

### Daemon-Update

```bash
# Automatisch (wenn über Installer installiert)
sudo firebot-daemon update

# Manuell
sudo systemctl stop firebot-daemon
wget -O /usr/local/bin/firebot-daemon https://firenetworks.de/downloads/firebot-daemon-linux-amd64
chmod +x /usr/local/bin/firebot-daemon
sudo systemctl start firebot-daemon
```

→ Weiter: [Root-Server registrieren](masterserver.md)
