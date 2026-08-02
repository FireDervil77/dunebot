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

1. Führe `/daemon register` aus. Der Befehl fragt nach:

   | Angabe | Bedeutung |
   |--------|-----------|
   | `name` | Anzeigename der Maschine |
   | `ram_gb` | Arbeitsspeicher in GB |
   | `disk_gb` | Speicherplatz in GB |
   | `host` | IP oder Hostname (optional) |

2. Der Bot zeigt dir **Daemon-ID und API-Key** — beides nur einmal, also gleich
   kopieren
3. Trage sie auf deinem Root-Server in die `daemon.yaml` ein
   (siehe [Daemon-Setup](daemon-setup.md))
4. Starte den Daemon — er verbindet sich automatisch

**Zu `ram_gb` und `disk_gb`:** Diese Angaben sind nur der Anfangswert. Sobald der
Daemon läuft, meldet er die tatsächliche Ausstattung der Maschine und überschreibt
sie. Du musst also nicht genau wissen, was verbaut ist — eine grobe Angabe genügt,
den Rest erledigt der Daemon.
Siehe [Ressourcen-Verwaltung](ressourcen.md).

## Dashboard-Ansicht

Im Dashboard unter **Masterserver** siehst du:

- **Übersicht** — Status aller Root-Server auf einen Blick
- **Root-Server** — Details je Maschine: Hardware, IP-Adressen, Port-Bereiche, laufende Gameserver
- **Ressourcen** — wie viel Arbeitsspeicher, CPU und Speicherplatz vergeben ist → [Ressourcen-Verwaltung](ressourcen.md)
- **Logs** — Verbindungsprotokolle der Daemons

## Verbindung

Der Daemon meldet sich alle **30 Sekunden** mit einem Lebenszeichen. Bleibt es
länger als 60 Sekunden aus, gilt er als offline und die Verbindung wird getrennt;
er verbindet sich anschliessend von selbst neu. Die Verbindung läuft über
**Port 9340**.

Diese Werte stehen im Daemon und im Dashboard fest — es gibt dafür keine
Einstellung im Dashboard.

| Einstellung | Beschreibung | Standard |
|-------------|-------------|---------|
| Aufbewahrung der Logs | Nach wie vielen Tagen Daemon-Logs gelöscht werden | `30` Tage |

## Berechtigungen

Die Schlüssel sind mit **Punkten** geschrieben, nicht mit Unterstrichen.

| Berechtigung | Beschreibung |
|-------------|-------------|
| `MASTERSERVER.VIEW` | Masterserver-Bereich sehen |
| `MASTERSERVER.DAEMON.MANAGE` | Daemon-Updates auslösen ⚠️ |
| `MASTERSERVER.ROOTSERVER.VIEW` | Root-Server einsehen |
| `MASTERSERVER.ROOTSERVER.CREATE` | Root-Server registrieren ⚠️ |
| `MASTERSERVER.ROOTSERVER.EDIT` | Root-Server bearbeiten, IPs und Ports verwalten |
| `MASTERSERVER.ROOTSERVER.DELETE` | Root-Server löschen ⚠️ |
| `MASTERSERVER.RESOURCES.VIEW` | Ressourcenauslastung einsehen |
| `MASTERSERVER.RESOURCES.MANAGE` | Überallokation und Reserven ändern |
| `MASTERSERVER.LOGS.VIEW` | Daemon-Logs einsehen |

⚠️ = als kritisch eingestuft, wird bei der Rechtevergabe hervorgehoben.

Jede Route prüft ihre Berechtigung. Ohne das passende Recht ist eine Seite auch
dann nicht erreichbar, wenn man ihre Adresse kennt.

## Daemon aktualisieren

Steht eine neuere Daemon-Version bereit, erscheint in der Root-Server-Übersicht
ein Update-Hinweis mit der neuen Versionsnummer. Ein Klick darauf lässt den
Daemon das neue Programm vom Dashboard laden und sich selbst neu starten — die
laufenden Gameserver bleiben davon unberührt, der Daemon ist nur für wenige
Sekunden getrennt.

Der Vergleich findet beim Verbindungsaufbau statt. Nach einem neuen Daemon-Build
muss das Dashboard einmal neu gestartet werden, damit der Hinweis erscheint.

→ Weiter: [Ressourcen-Verwaltung](ressourcen.md)
