# Gameserver erstellen

Nachdem der Daemon läuft und der Root-Server registriert ist, kannst du Gameserver erstellen.

## Per Bot-Command

```
/server create <rootserver> <addon> <name>
```

| Parameter | Beschreibung |
|-----------|-------------|
| `rootserver` | Auf welchem Root-Server der Gameserver laufen soll (Autocomplete) |
| `addon` | Welches Spiel installiert werden soll (Autocomplete) |
| `name` | Ein Name für den Gameserver |

**Beispiel:**
```
/server create mein-root-server minecraft Survival-Server
```

Der Bot bestätigt die Erstellung und startet automatisch die Installation.

## Per Dashboard

1. Gehe zu **Gameserver** in der Sidebar
2. Klicke auf **Neuen Server erstellen**
3. Wähle:
   - **Root-Server** — Wo soll der Server laufen?
   - **Addon** — Welches Spiel?
   - **Name** — Wie soll der Server heißen?
4. Lege die **Ressourcen** fest — diese drei Angaben sind Pflicht:

   | Feld | Bedeutung | Vorgabe |
   |------|-----------|---------|
   | Arbeitsspeicher | Obergrenze in MiB, mindestens 512 | 2048 |
   | CPU-Anteil | In Prozent, **100 % = ein Kern** | 100 |
   | Speicherplatz | Obergrenze in GiB, mindestens 1 | 20 |

5. Klicke auf **Erstellen**

Die Werte reservieren Platz auf dem Root-Server und begrenzen den Server im
Betrieb. Ist dort nicht genug frei, wird das Anlegen abgelehnt — mit Angabe,
wie viel angefordert wurde und wie viel zur Verfügung steht. Ändern lassen sie
sich jederzeit unter **Bearbeiten**.

Mehr dazu: [Ressourcen-Verwaltung](ressourcen.md)

## Installationsvorgang

Nach dem Erstellen passiert automatisch:

1. **Server-Verzeichnis** wird auf dem Root-Server angelegt
2. **Spieldateien** werden heruntergeladen (über SteamCMD oder direkt)
3. **Standardkonfiguration** wird erstellt
4. Der Server-Status wechselt von `installing` zu `offline`

Je nach Spiel kann die Installation einige Minuten dauern. Den Fortschritt siehst du im Dashboard oder über den Bot:

```
/server status <id>
```

## Addons

Addons definieren, welche Spiele installiert werden können. Jedes Addon enthält:

- Installations-Anweisungen (SteamCMD App-ID oder Download-URL)
- Standard-Konfiguration
- Start/Stop-Logik
- Konsolen-Integration

Welche Addons verfügbar sind, siehst du im Dashboard unter **Gameserver** → **Addons** oder über das Autocomplete von `/server create`.

## Berechtigungen

| Berechtigung | Beschreibung |
|-------------|-------------|
| `GAMESERVER.CREATE` | Gameserver erstellen |
| `GAMESERVER.VIEW` | Server-Liste und Details einsehen |

→ Weiter: [Server verwalten](server-verwalten.md)
