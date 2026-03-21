# Gameserver-Plugin

Das Gameserver-Plugin ist die Benutzer-Schnittstelle für die Gameserver-Verwaltung. Es arbeitet zusammen mit dem [Masterserver-Plugin](masterserver.md) und dem [FireBot Daemon](../gameserver/daemon-setup.md).

## Funktionen

- Gameserver erstellen, starten, stoppen und neustarten
- Live-Konsole direkt im Dashboard
- Datei-Browser mit Editor
- Addon-System für verschiedene Spiele
- Server-Logs

## Bot-Commands

| Command | Beschreibung |
|---------|-------------|
| `/server list [status] [rootserver] [search]` | Alle Server auflisten (mit Filtern) |
| `/server status <id>` | Detailstatus eines Servers |
| `/server create <rootserver> <addon> <name>` | Neuen Server erstellen |
| `/server start <id>` | Server starten |
| `/server stop <id>` | Server stoppen |
| `/server restart <id>` | Server neustarten |

Alle ID-Felder unterstützen Autocomplete.

## Vollständige Dokumentation

Das Gameserver-System hat eine eigene Doku-Sektion:

- [Übersicht](../gameserver/uebersicht.md) — Wie das System funktioniert
- [Daemon installieren](../gameserver/daemon-setup.md) — FireBot Daemon Setup
- [Masterserver](../gameserver/masterserver.md) — Root-Server und Daemons verwalten
- [Server erstellen](../gameserver/server-erstellen.md) — Neuen Gameserver anlegen
- [Server verwalten](../gameserver/server-verwalten.md) — Start/Stop, Konsole, Dateien
- [SteamCMD](../gameserver/steamcmd.md) — Spiel-Updates

## Berechtigungen

| Berechtigung | Beschreibung |
|-------------|-------------|
| `GAMESERVER.VIEW` | Server-Liste und Details sehen |
| `GAMESERVER.CREATE` | Server erstellen |
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
