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
   wget https://firenetworks.de/downloads/linux-amd64/firebot-daemon
   
   # Für ARM64 (z.B. Raspberry Pi, ARM-Server)
   wget https://firenetworks.de/downloads/linux-arm64/firebot-daemon
   ```

2. Ausführbar machen und verschieben:
   ```bash
   chmod +x firebot-daemon
   sudo mv firebot-daemon /opt/firebot-daemon/firebot-daemon
   ```

3. Setup-Wizard starten:
   ```bash
   sudo /opt/firebot-daemon/firebot-daemon setup
   ```

4. Als Service einrichten:
   ```bash
   sudo /opt/firebot-daemon/firebot-daemon install
   ```

## Setup-Wizard

Der Setup-Wizard führt dich durch folgende Schritte:

1. **Daemon-Name** — Ein Name für diesen Daemon (z.B. `mein-server`)
2. **Daemon-ID** — UUID aus dem Dashboard (Masterserver → RootServer erstellen → Setup-Modal)
3. **Setup-Token** — API-Key aus dem Dashboard (wird nur einmal angezeigt!)
4. **Dashboard-URL** — Wird automatisch auf `wss://firenetworks.de/ws` gesetzt. Nicht ändern!
5. **Basis-Verzeichnis** — Wo Gameserver-Daten gespeichert werden (Standard: `/var/lib/firebot-daemon/volumes`)
6. **Log-Verzeichnis** — Daemon-Logs (Standard: `{Basis-Verzeichnis}/daemon-logs`)

> **Wichtig:** Die Dashboard-URL ist fest vorgegeben (`wss://firenetworks.de/ws`). Eine eigene URL funktioniert nicht — einfach Enter drücken, um den Standard zu übernehmen.

Alternativ kannst du die Konfiguration manuell in `/opt/firebot-daemon/daemon.yaml` eintragen.

## Konfiguration (daemon.yaml)

Die Konfigurationsdatei wird beim Setup automatisch erstellt und liegt unter `/opt/firebot-daemon/daemon.yaml`. Wichtige Felder:

```yaml
# Daemon-Identifikation
daemon:
  name: "mein-server"
  daemon_id: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"  # UUID aus dem Dashboard
  token: "dein-setup-token"                           # API-Key aus dem Dashboard

# Verbindung zum DuneBot Dashboard (NICHT ÄNDERN!)
dashboard:
  url: "wss://firenetworks.de/ws"

# Dateisystem
filesystem:
  base_directory: "/var/lib/firebot-daemon/volumes"  # Basis für alle Gameserver-Daten
  auto_create_base: true

# Logging
logging:
  level: "info"
  file: "daemon.log"
```

> **Achtung:** Die `dashboard.url` muss immer `wss://firenetworks.de/ws` sein. Eine andere URL wird vom System nicht unterstützt.

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

1. **Token korrekt?** — Prüfe den Token in `/opt/firebot-daemon/daemon.yaml`
2. **Dashboard-URL korrekt?** — Muss `wss://firenetworks.de/ws` sein
3. **Dashboard erreichbar?** — `curl -I https://firenetworks.de`
4. **Firewall?** — Ausgehende HTTPS/WSS-Verbindungen (Port 443) müssen erlaubt sein
5. **Logs prüfen:** `sudo journalctl -u firebot-daemon --no-pager -n 50`

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
sudo /opt/firebot-daemon/firebot-daemon update

# Manuell
sudo systemctl stop firebot-daemon
wget -O /opt/firebot-daemon/firebot-daemon https://firenetworks.de/downloads/linux-amd64/firebot-daemon
chmod +x /opt/firebot-daemon/firebot-daemon
sudo systemctl start firebot-daemon
```

## Deinstallation

Den FireBot Daemon kannst du vollständig vom System entfernen:

### Automatische Deinstallation

```bash
curl -sSL https://firenetworks.de/downloads/daemon/uninstall.sh | sudo bash
```

### Manuelle Deinstallation

```bash
# 1. Service stoppen und deaktivieren
sudo systemctl stop firebot-daemon
sudo systemctl disable firebot-daemon

# 2. Service-Datei entfernen
sudo rm /etc/systemd/system/firebot-daemon.service
sudo systemctl daemon-reload

# 3. Daemon-Binary und Config entfernen
sudo rm -rf /opt/firebot-daemon
```

> **Hinweis:** Gameserver-Daten unter `/var/lib/firebot-daemon/volumes` werden bei der Deinstallation **nicht** automatisch gelöscht. Wenn du auch die Spieldaten entfernen möchtest:
> ```bash
> sudo rm -rf /var/lib/firebot-daemon
> ```

→ Weiter: [Root-Server registrieren](masterserver.md)
