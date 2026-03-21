# Giveaway

Das Giveaway-Plugin ermöglicht automatische Gewinnspiele in deinem Discord-Server.

## Funktionen

- Gewinnspiele mit konfigurierbarer Dauer und Gewinneranzahl
- Vorlagen für wiederkehrende Gewinnspiele
- Pause und Wiederaufnahme
- Reroll bei Nicht-Reaktion des Gewinners
- Blacklist für bestimmte Benutzer
- Anpassbare Embed-Farben und Emojis

## Bot-Commands

| Command | Beschreibung |
|---------|-------------|
| `/giveaway start` | Neues Gewinnspiel starten |
| `/giveaway end <id>` | Gewinnspiel vorzeitig beenden |
| `/giveaway pause <id>` | Gewinnspiel pausieren |
| `/giveaway resume <id>` | Pausiertes Gewinnspiel fortsetzen |
| `/giveaway reroll <id>` | Neuen Gewinner auslosen |
| `/giveaway list` | Alle aktiven Gewinnspiele anzeigen |
| `/giveaway edit <id>` | Gewinnspiel bearbeiten |
| `/giveaway blacklist <user>` | Benutzer von Gewinnspielen ausschließen |
| `/giveaway template` | Gewinnspiel-Vorlagen verwalten |

## Gewinnspiel erstellen

Beim Starten eines Giveaways gibst du an:

- **Preis** — Was gibt es zu gewinnen?
- **Dauer** — Wie lange läuft das Gewinnspiel? (z.B. `1h`, `2d`, `1w`)
- **Gewinner** — Wie viele Gewinner werden ausgelost?
- **Kanal** — In welchem Kanal soll das Giveaway stattfinden?

Benutzer nehmen teil, indem sie auf das 🎁-Emoji unter der Giveaway-Nachricht klicken.

## Dashboard-Einstellungen

| Einstellung | Beschreibung | Standard |
|-------------|-------------|---------|
| Standard-Emoji | Teilnahme-Reaktion | 🎁 |
| Start-Embed-Farbe | Farbe des laufenden Giveaways | `#FF468A` |
| End-Embed-Farbe | Farbe des beendeten Giveaways | `#FF468A` |

## Berechtigungen

| Berechtigung | Beschreibung |
|-------------|-------------|
| `GIVEAWAY.VIEW` | Giveaway-Bereich sehen |
| `GIVEAWAY.CREATE` | Gewinnspiele erstellen |
| `GIVEAWAY.MANAGE` | Gewinnspiele verwalten (Pause, Edit) |
| `GIVEAWAY.DELETE` | Gewinnspiele löschen |
