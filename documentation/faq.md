# FAQ — Häufige Fragen

## Allgemein

### Ist DuneBot kostenlos?

Ja, DuneBot ist kostenlos nutzbar. Optionale Donations unterstützen die Weiterentwicklung.

### Auf wie vielen Servern kann ich DuneBot nutzen?

Es gibt kein Limit — du kannst DuneBot auf beliebig vielen Servern einsetzen.

### Welche Sprachen werden unterstützt?

Aktuell Deutsch (`de-DE`). Weitere Sprachen sind geplant.

---

## Dashboard

### Ich kann mich nicht im Dashboard einloggen

- Stelle sicher, dass du den richtigen Discord-Account verwendest
- Browser-Cache und Cookies löschen, dann erneut versuchen
- Falls der Fehler bestehen bleibt, den Support kontaktieren

### Ich sehe meinen Server nicht im Dashboard

- DuneBot muss auf dem Server aktiv sein (Bot eingeladen)
- Du brauchst die nötigen Berechtigungen auf dem Server
- Prüfe, ob du mit dem richtigen Discord-Account eingeloggt bist

### Ich kann keine Einstellungen ändern

Dein Admin muss dir die entsprechenden Berechtigungen über **Benutzer & Gruppen** zuweisen. Nur Benutzer mit der Berechtigung `CORE.SETTINGS.EDIT` können Grundeinstellungen ändern.

---

## Bot

### Bot reagiert nicht auf Befehle

1. **Ist der Bot online?** — Prüfe, ob DuneBot in der Mitgliederliste als online angezeigt wird
2. **Slash-Commands aktiviert?** — Unter Einstellungen → Allgemein prüfen
3. **Richtiger Prefix?** — Für Textbefehle: Ist der Prefix korrekt? (Standard: `!`)
4. **Berechtigungen?** — Hat der Bot die nötigen Discord-Berechtigungen im Kanal?

### Slash-Commands werden nicht angezeigt

- Discord braucht manchmal bis zu 1 Stunde, um neue Slash-Commands zu synchronisieren
- Stelle sicher, dass DuneBot die Berechtigung `applications.commands` auf dem Server hat
- Versuche, Discord neu zu starten

### Bot ist offline

Der Bot wird von uns gehostet. Gelegentliche kurze Ausfälle für Updates sind normal. Bei längeren Ausfällen prüfe unseren Support-Server.

---

## Plugins

### Wie aktiviere ich ein Plugin?

Im Dashboard unter **Plugins** auf **Aktivieren** klicken. Das Plugin ist sofort aktiv.

### Ein Plugin funktioniert nicht wie erwartet

1. Prüfe die Plugin-Einstellungen im Dashboard
2. Hat der Bot die nötigen Discord-Berechtigungen?
3. Wurde das Plugin korrekt konfiguriert? (Kanäle, Rollen zugewiesen?)

### Gehen Daten verloren, wenn ich ein Plugin deaktiviere?

Nein. Die Daten bleiben in der Datenbank erhalten. Beim erneuten Aktivieren sind alle Einstellungen und Daten wieder da.

---

## Gameserver

### Brauche ich einen eigenen Server?

Ja, für Gameserver brauchst du einen Root-Server oder VServer mit Linux. DuneBot selbst wird von uns gehostet — nur der FireBot Daemon muss auf deiner Hardware laufen.

### Welche Spiele werden unterstützt?

Das hängt von den verfügbaren Addons ab. Grundsätzlich kann jedes Spiel unterstützt werden, das über SteamCMD oder direkte Downloads installierbar ist.

### Wie viele Gameserver kann ich erstellen?

Das hängt von den Ressourcen deines Root-Servers ab (RAM, CPU, Speicher). Es gibt kein künstliches Limit.

### Daemon verbindet sich nicht

Siehe [Daemon Troubleshooting](gameserver/daemon-setup.md#troubleshooting).

---

## Support

Weitere Fragen? Tritt unserem Discord-Support-Server bei oder erstelle ein Ticket im Dashboard.
