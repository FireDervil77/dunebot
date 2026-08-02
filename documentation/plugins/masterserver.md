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

⚠️ = als kritisch eingestuft.

## Ressourcen

Wie viel Arbeitsspeicher, CPU und Speicherplatz eine Maschine hergibt, erkennt
der Daemon selbst — eintragen musst du nichts.
Siehe [Ressourcen-Verwaltung](../gameserver/ressourcen.md).
