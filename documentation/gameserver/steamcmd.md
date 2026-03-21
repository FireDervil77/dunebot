# SteamCMD & Game-Updates

Viele Gameserver nutzen SteamCMD für die Installation und Updates von Spieldateien. Der FireBot Daemon handhabt SteamCMD automatisch.

## Automatische SteamCMD-Installation

SteamCMD wird beim ersten Gameserver-Install automatisch heruntergeladen und eingerichtet. Du musst nichts manuell installieren.

**Voraussetzung** (wird beim Daemon-Install geprüft):
```bash
# Debian/Ubuntu — 32-Bit-Bibliotheken
sudo dpkg --add-architecture i386
sudo apt update
sudo apt install lib32gcc-s1 lib32stdc++6
```

## Game-Updates

Spiel-Updates werden über SteamCMD eingespielt. Je nach Addon-Konfiguration:

- **Automatisch** — Der Daemon prüft regelmäßig auf Updates
- **Manuell** — Über das Dashboard oder Bot-Commands ein Update anstoßen

### Update über Dashboard

1. Gehe zu **Gameserver** → Server auswählen
2. Klicke auf **Update prüfen** oder **Aktualisieren**
3. Der Server wird gestoppt, aktualisiert und optional wieder gestartet

## Wie SteamCMD funktioniert

SteamCMD ist Valves Kommandozeilen-Tool für das Herunterladen von Spieldateien:

1. Der Daemon ruft SteamCMD mit der **App-ID** des Spiels auf
2. Spieldateien werden heruntergeladen oder aktualisiert
3. Nach Abschluss wird die Server-Konfiguration angewendet

Die App-ID ist im jeweiligen Addon hinterlegt — du musst sie nicht kennen.

## Speicherort

SteamCMD und Spieldateien werden standardmäßig unter den in der Daemon-Konfiguration festgelegten Pfaden gespeichert:

```yaml
paths:
  servers: "/home/gameservers/servers"     # Gameserver-Dateien
  steamcmd: "/home/gameservers/steamcmd"   # SteamCMD-Installation
  backups: "/home/gameservers/backups"     # Backups
```

## Troubleshooting

### SteamCMD hängt beim Download

- Prüfe die Internetverbindung des Servers
- Stelle sicher, dass genug Speicherplatz vorhanden ist: `df -h`
- SteamCMD-Logs findest du im Daemon-Log: `journalctl -u firebot-daemon -f`

### Update schlägt fehl

- Ist der Gameserver gestoppt? (muss für Updates offline sein)
- Reicht der Speicherplatz?
- Bei Steam-Auth-Problemen: SteamCMD-Cache löschen und neu starten
