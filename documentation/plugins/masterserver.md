# Masterserver-Plugin

Das Masterserver-Plugin ist die zentrale Steuereinheit für das Gameserver-Ökosystem. Es verwaltet die Verbindung zu deinen Root-Servern und den darauf laufenden FireBot Daemons.

Vollständige Dokumentation: [Masterserver](../gameserver/masterserver.md)

## Bot-Commands

| Command | Beschreibung |
|---------|-------------|
| `/daemon list` | Alle registrierten Root-Server auflisten |
| `/daemon status <id>` | Status eines Root-Servers/Daemons prüfen |
| `/daemon register` | Neuen Root-Server registrieren (generiert Konfiguration) |
| `/daemon delete <id>` | Root-Server und alle zugehörigen Gameserver entfernen |

## Berechtigungen

| Berechtigung | Beschreibung |
|-------------|-------------|
| `MASTERSERVER.VIEW` | Masterserver-Bereich sehen |
| `MASTERSERVER.DAEMON_MANAGE` | Daemons verwalten |
| `MASTERSERVER.ROOTSERVER_VIEW` | Root-Server einsehen |
| `MASTERSERVER.ROOTSERVER_CREATE` | Root-Server registrieren |
| `MASTERSERVER.ROOTSERVER_EDIT` | Root-Server bearbeiten |
| `MASTERSERVER.ROOTSERVER_DELETE` | Root-Server und alle Gameserver löschen |
| `MASTERSERVER.RESOURCES_VIEW` | Ressourcenauslastung einsehen |
| `MASTERSERVER.RESOURCES_MANAGE` | Ressourcen-Limits verwalten |
| `MASTERSERVER.TOKENS_VIEW` | API-Tokens einsehen |
| `MASTERSERVER.TOKENS_MANAGE` | API-Tokens verwalten |
| `MASTERSERVER.LOGS_VIEW` | Logs einsehen |
