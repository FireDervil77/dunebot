# Economy

Das Economy-Plugin fügt deinem Server ein Währungssystem mit Bank, täglichen Belohnungen und Gambling hinzu.

## Funktionen

- Eigene Server-Währung
- Bankensystem mit Ein-/Auszahlungen
- Tägliche Belonungen mit Streak-Bonus
- Überweisungen zwischen Benutzern
- Gambling-Möglichkeit

## Bot-Commands

### Bank

| Command | Beschreibung |
|---------|-------------|
| `/bank balance` | Kontostand anzeigen |
| `/bank deposit <betrag>` | Coins auf die Bank einzahlen |
| `/bank withdraw <betrag>` | Coins von der Bank abheben |
| `/bank transfer <user> <betrag>` | Coins an einen anderen Benutzer überweisen |

### Verdienen

| Command | Beschreibung |
|---------|-------------|
| `/daily` | Tägliche Belohnung abholen (mit Streak-System) |
| `/beg` | Coins erbetteln (Zufallsbetrag) |

### Ausgeben

| Command | Beschreibung |
|---------|-------------|
| `/gamble <betrag>` | Coins setzen — Gewinn oder Verlust! |

## Streak-System

Wenn du `/daily` an aufeinanderfolgenden Tagen verwendest, baut sich ein Streak auf. Je länger der Streak, desto höher die tägliche Belohnung!

- Tag 1: Basisbelohnung
- Tag 2+: Basisbelohnung + Streak-Bonus
- Einen Tag verpasst? Der Streak wird zurückgesetzt.

## Dashboard-Einstellungen

Im Dashboard kannst du die Economy-Einstellungen konfigurieren:

- Währungsname und -symbol
- Basisbelohnung für `/daily`
- Streak-Multiplikator
- Gambling-Limits
