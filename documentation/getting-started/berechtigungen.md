# Berechtigungen

DuneBot hat ein feingranulares Berechtigungssystem, mit dem du genau festlegen kannst, wer im Dashboard und Bot welche Aktionen ausführen darf.

## Konzept

Das System basiert auf **Gruppen** und **Berechtigungen**:

- **Gruppen** sind Sammlungen von Berechtigungen (z.B. "Moderator", "Support")
- **Benutzer** werden einer oder mehreren Gruppen zugeordnet
- Jede Aktion im Dashboard und Bot prüft, ob der Benutzer die nötige Berechtigung hat

## Standard-Gruppen

Beim Server-Setup werden automatisch vier Gruppen erstellt:

| Gruppe | Beschreibung |
|--------|-------------|
| **Administrator** | Vollzugriff auf alle Funktionen. Bekommt automatisch alle Berechtigungen. |
| **Moderator** | Moderation, Tickets, grundlegende Verwaltung |
| **Support** | Eingeschränkter Zugriff, z.B. Ticket-Ansicht |
| **User** | Basis-Zugriff, keine Verwaltungsfunktionen |

> **Tipp:** Der Server-Besitzer hat immer Zugriff auf alles, unabhängig von Gruppen.

## Benutzer einer Gruppe zuordnen

1. Gehe im Dashboard zu **Benutzer & Gruppen**
2. Klicke auf den Benutzer, den du bearbeiten möchtest
3. Wähle die gewünschte(n) Gruppe(n) aus
4. Speichere die Änderungen

Ein Benutzer kann in mehreren Gruppen gleichzeitig sein — die Berechtigungen werden addiert.

## Eigene Gruppen erstellen

Du kannst beliebig viele eigene Gruppen anlegen:

1. Gehe zu **Benutzer & Gruppen** → **Gruppen**
2. Klicke auf **Neue Gruppe erstellen**
3. Vergib einen Namen und wähle die gewünschten Berechtigungen
4. Speichere die Gruppe

## Berechtigungen verstehen

Berechtigungen sind in der Form `PLUGIN.AKTION` aufgebaut. Beispiele:

| Berechtigung | Bedeutung |
|-------------|-----------|
| `MODERATION.VIEW` | Moderations-Bereich im Dashboard sehen |
| `MODERATION.BAN_EXECUTE` | Benutzer bannen dürfen |
| `TICKET.SETTINGS_EDIT` | Ticket-Einstellungen ändern |
| `CORE.SETTINGS.EDIT` | Server-Grundeinstellungen ändern |
| `GAMESERVER.CREATE` | Neue Gameserver erstellen |

### Gefährliche Berechtigungen

Einige Berechtigungen sind als **gefährlich** markiert (rotes Warnsymbol). Diese erlauben tiefgreifende Aktionen wie:

- Server-Einstellungen ändern
- Benutzer entfernen oder bannen
- Gameserver löschen
- Konsolen-Zugriff auf Gameserver

> **Achtung:** Vergib gefährliche Berechtigungen nur an vertrauenswürdige Personen.

## Plugin-Berechtigungen

Jedes Plugin bringt eigene Berechtigungen mit. Wenn du ein Plugin aktivierst, werden die dazugehörigen Berechtigungen automatisch registriert. Die Standard-Gruppen (Moderator, Support, User) bekommen je nach Plugin sinnvolle Standardwerte zugewiesen.

Du kannst diese jederzeit über **Benutzer & Gruppen** → **Gruppen** anpassen.

## Nächster Schritt

→ [Dashboard-Übersicht](../dashboard/uebersicht.md) — Lerne das Dashboard im Detail kennen.
