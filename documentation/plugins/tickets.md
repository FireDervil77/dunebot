# Ticketsystem

Das Ticket-Plugin bietet ein vollständiges Support-Ticketsystem mit Kategorien, Limits und Transkripten.

## Funktionen

- Support-Tickets über Buttons oder Commands erstellen
- Kategorien mit eigenen Einstellungen
- Ticket-Limits pro Benutzer
- Tag-System für schnelle Antworten
- Automatisches Transkript beim Schließen
- Moderator/Support-Zugriff per Berechtigung

## Bot-Commands

| Command | Beschreibung |
|---------|-------------|
| `/ticket setup` | Ticket-System einrichten (Panel mit Button erstellen) |
| `/ticket close` | Aktuelles Ticket schließen |
| `/ticket closeall` | Alle offenen Tickets schließen |
| `/ticket add <user>` | Benutzer zum Ticket hinzufügen |
| `/ticket remove <user>` | Benutzer aus Ticket entfernen |
| `/ticket log <kanal>` | Log-Kanal für Transkripte setzen |
| `/ticket limit <anzahl>` | Maximale offene Tickets pro Benutzer |
| `/tag <name>` | Vorgefertigte Antwort einfügen |
| `/ticketcat` | Ticket-Kategorien verwalten |

## So funktioniert's

### Ticket erstellen (User-Sicht)

1. Benutzer klickt auf den **Ticket erstellen**-Button im Ticket-Panel
2. Optional: Ausfüllen eines Formulars (je nach Kategorie)
3. Ein privater Kanal wird erstellt — nur der Ersteller und das Support-Team können ihn sehen
4. Das Support-Team wird benachrichtigt

### Ticket bearbeiten (Support-Sicht)

1. Im Ticket-Kanal antworten
2. Optional: Weitere Benutzer hinzufügen mit `/ticket add`
3. Vorgefertigte Antworten mit `/tag` nutzen
4. Ticket schließen mit `/ticket close`

### Nach dem Schließen

- Das Transkript wird automatisch im Log-Kanal gespeichert
- Der Ticket-Kanal wird gelöscht

## Dashboard-Einstellungen

| Einstellung | Beschreibung | Standard |
|-------------|-------------|---------|
| Embed-Farbe (Erstellen) | Farbe des Erstell-Embeds | `#068ADD` |
| Embed-Farbe (Schließen) | Farbe des Schließ-Embeds | `#068ADD` |
| Standard-Limit | Max. offene Tickets pro User | `10` |

### Kategorien verwalten

Im Dashboard kannst du Ticket-Kategorien anlegen mit:
- Name und Beschreibung
- Eigene Farbe und Emoji
- Zugewiesene Support-Rollen
- Optional: Formular-Fragen beim Erstellen

## Berechtigungen

| Berechtigung | Beschreibung |
|-------------|-------------|
| `TICKET.VIEW` | Ticket-Bereich sehen |
| `TICKET.SETTINGS_EDIT` | Einstellungen ändern |
| `TICKET.CATEGORIES_MANAGE` | Kategorien verwalten |
| `TICKET.TICKETS_VIEW` | Tickets einsehen |
