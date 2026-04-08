# Masterserver

Das Masterserver-Plugin ist die zentrale Schnittstelle zwischen FireBot und deinen Root-Servern. Es verwaltet Daemon-Verbindungen, Root-Server-Ressourcen und stellt die Grundlage für das Gameserver-Plugin bereit.

## Konzept

```
Dashboard/Discord
      ↓
  Masterserver-Plugin
      ↓ (WebSocket)
  FireBot Daemon  ←→  Gameserver
      ↓
  Root-Server (Hardware)
```

Der Masterserver hält die Verbindung zu allen registrierten Daemons aufrecht und leitet Befehle wie Start, Stop oder Konsolen-Eingaben weiter.

## Root-Server registrieren

### Per Bot-Command

| Command | Beschreibung |
|---------|-------------|
| `/daemon register` | Neuen Root-Server registrieren — generiert automatisch die Daemon-Konfiguration |
| `/daemon list` | Alle registrierten Root-Server anzeigen |
| `/daemon status <id>` | Status eines Root-Servers prüfen |
| `/daemon delete <id>` | Root-Server entfernen |

### Registrierungs-Ablauf

1. Führe `/daemon register` aus
2. Der Bot zeigt dir die generierte `daemon.yaml`-Konfiguration
3. Kopiere diese auf deinen Root-Server (siehe [Daemon-Setup](daemon-setup.md))
4. Starte den Daemon — er verbindet sich automatisch

## Dashboard-Ansicht

Im Dashboard unter **Masterserver** siehst du:

- **Root-Server-Übersicht** — Alle registrierten Server mit Status (Online/Offline)
- **Ressourcen** — CPU, RAM, Speicher pro Server
- **Daemon-Logs** — Verbindungsprotokolle
- **Token-Verwaltung** — API-Zugriffsschlüssel

## Einstellungen

| Einstellung | Beschreibung | Standard |
|-------------|-------------|---------|
| Heartbeat-Interval | Wie oft der Daemon sein Lebenszeichen sendet | `30s` |
| Command-Timeout | Maximale Wartezeit auf eine Antwort | `30s` |
| Auto-Reconnect | Automatische Wiederverbindung bei Trennung | Ja |
| Offline-Schwellenwert | Nach wie vielen Sekunden gilt ein Daemon als offline | `90s` |
| WebSocket-Port | Port für die Daemon-Verbindung | `9340` |

## Berechtigungen

| Berechtigung | Beschreibung |
|-------------|-------------|
| `MASTERSERVER.VIEW` | Masterserver-Bereich sehen |
| `MASTERSERVER.DAEMON_MANAGE` | Daemons verwalten |
| `MASTERSERVER.ROOTSERVER_VIEW` | Root-Server einsehen |
| `MASTERSERVER.ROOTSERVER_CREATE` | Root-Server registrieren |
| `MASTERSERVER.ROOTSERVER_EDIT` | Root-Server bearbeiten |
| `MASTERSERVER.ROOTSERVER_DELETE` | Root-Server löschen (inkl. aller Gameserver!) |
| `MASTERSERVER.RESOURCES_VIEW` | Ressourcenauslastung einsehen |
| `MASTERSERVER.RESOURCES_MANAGE` | Ressourcen-Limits verwalten |
| `MASTERSERVER.TOKENS_VIEW` | API-Tokens einsehen |
| `MASTERSERVER.TOKENS_MANAGE` | API-Tokens verwalten |
| `MASTERSERVER.LOGS_VIEW` | Logs einsehen |

→ Weiter: [Gameserver erstellen](server-erstellen.md)
