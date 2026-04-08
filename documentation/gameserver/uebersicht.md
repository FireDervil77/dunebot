# Gameserver — Übersicht

FireBot bietet ein integriertes Gameserver-Management-System, mit dem du Spielserver direkt aus Discord oder dem Dashboard heraus erstellen und verwalten kannst.

## Wie funktioniert es?

Das System besteht aus drei Komponenten:

```
Discord/Dashboard  ←→  FireBot (Masterserver-Plugin)  ←→  FireBot Daemon (auf dem Server)
```

1. **Masterserver-Plugin** — Die zentrale Schnittstelle im Dashboard. Verwaltet die Verbindung zu deiner Hardware.
2. **Gameserver-Plugin** — Erstellt und verwaltet die einzelnen Spielserver.
3. **FireBot Daemon** — Läuft auf deinem Root-/VServer und führt die tatsächlichen Gameserver aus.

## Was du brauchst

- **FireBot** auf deinem Discord-Server (mit Masterserver- und Gameserver-Plugin)
- **Einen Root-Server oder VServer** mit Linux (Ubuntu/Debian empfohlen)
- **FireBot Daemon** auf dem Root-Server installiert

## Einrichtung (Kurzübersicht)

1. [Daemon auf dem Root-Server installieren](daemon-setup.md)
2. [Root-Server im Dashboard registrieren](masterserver.md)
3. [Gameserver erstellen](server-erstellen.md)
4. [Server verwalten](server-verwalten.md)

## Unterstützte Spiele

Gameserver werden über **Addons** bereitgestellt. Jedes Addon enthält die Installations- und Konfigurationslogik für ein bestimmtes Spiel. Welche Spiele verfügbar sind, hängt von den installierten Addons ab.

Die Addon-Installation erfolgt über SteamCMD oder direkte Downloads, je nach Spiel.

→ Weiter: [Daemon installieren](daemon-setup.md)
