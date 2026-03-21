# Server verwalten

Erstelle Gameserver können über Bot-Commands und das Dashboard vollständig verwaltet werden.

## Server-Status

Jeder Gameserver hat einen Status:

| Status | Beschreibung |
|--------|-------------|
| **Online** | Server läuft und ist spielbar |
| **Offline** | Server ist gestoppt |
| **Starting** | Server wird gerade gestartet |
| **Stopping** | Server wird gerade gestoppt |
| **Installing** | Spieldateien werden installiert |
| **Error** | Ein Fehler ist aufgetreten |

## Bot-Commands

| Command | Beschreibung |
|---------|-------------|
| `/server list` | Alle Gameserver auflisten |
| `/server list status:<status>` | Nach Status filtern (online/offline/...) |
| `/server list rootserver:<name>` | Nach Root-Server filtern |
| `/server list search:<text>` | Server suchen |
| `/server status <id>` | Detailstatus eines Servers |
| `/server start <id>` | Server starten |
| `/server stop <id>` | Server stoppen |
| `/server restart <id>` | Server neustarten |

Alle `<id>`-Felder unterstützen **Autocomplete** — du musst die ID nicht auswendig kennen.

## Dashboard-Verwaltung

Im Dashboard unter **Gameserver** findest du eine vollständige Verwaltungsoberfläche:

### Server-Liste

Übersicht aller Gameserver mit:
- Name, Spiel und Status
- Root-Server-Zuordnung
- Schnellaktionen (Start/Stop/Restart)

### Server-Detail

Klicke auf einen Server, um die detaillierte Verwaltung zu öffnen:

#### Konsole

- **Live-Konsole** — Echtzeit-Ausgabe des Gameservers
- **Befehlseingabe** — Direkte Befehle an den Gameserver senden
- Farbcodierte Ausgabe (Fehler in Rot, Infos in Grau)

#### Datei-Browser

- Dateien und Ordner des Servers durchsuchen
- Konfigurationsdateien direkt im Browser bearbeiten
- Dateien hoch- und herunterladen

#### Einstellungen

- Server-Name ändern
- Ressourcen-Limits anpassen (RAM, CPU)
- Startparameter konfigurieren
- Addon-spezifische Einstellungen

## Berechtigungen

| Berechtigung | Beschreibung |
|-------------|-------------|
| `GAMESERVER.VIEW` | Server-Liste und Details sehen |
| `GAMESERVER.EDIT` | Server-Einstellungen ändern |
| `GAMESERVER.DELETE` | Server löschen |
| `GAMESERVER.START` | Server starten |
| `GAMESERVER.STOP` | Server stoppen |
| `GAMESERVER.RESTART` | Server neustarten |
| `GAMESERVER.CONSOLE_VIEW` | Konsole einsehen |
| `GAMESERVER.CONSOLE_EXECUTE` | Konsolen-Befehle ausführen |
| `GAMESERVER.FILES_VIEW` | Dateien einsehen |
| `GAMESERVER.FILES_MANAGE` | Dateien bearbeiten/hochladen |
| `GAMESERVER.LOGS_VIEW` | Server-Logs einsehen |

→ Weiter: [SteamCMD & Updates](steamcmd.md)
