# Greeting

Das Greeting-Plugin begrüßt neue Mitglieder automatisch und verabschiedet gehende — mit anpassbaren Nachrichten und automatischer Rollenvergabe.

## Funktionen

- Willkommensnachrichten mit individuellen Bildern
- Abschiedsnachrichten bei Server-Verlassen
- Automatische Rollenvergabe für neue Mitglieder
- Vorlagen-System für verschiedene Nachrichten

## Bot-Commands

### Willkommen

| Command | Beschreibung |
|---------|-------------|
| `/welcome status` | Willkommensnachrichten an- oder ausschalten |
| `/welcome channel <kanal>` | Kanal für Willkommensnachrichten festlegen |
| `/welcome preview` | Vorschau der aktuellen Willkommensnachricht |
| `/welcome desc <text>` | Nachrichtentext anpassen |

### Abschied

| Command | Beschreibung |
|---------|-------------|
| `/farwell` | Abschiedsnachrichten konfigurieren |

### Auto-Rolle

| Command | Beschreibung |
|---------|-------------|
| `/autorole add <rolle>` | Rolle automatisch bei Join vergeben |
| `/autorole remove <rolle>` | Auto-Rolle entfernen |

## Platzhalter in Nachrichten

Du kannst in Willkommens- und Abschiedsnachrichten Platzhalter verwenden:

| Platzhalter | Wird ersetzt durch |
|-------------|-------------------|
| `{user}` | Erwähnung des Benutzers |
| `{username}` | Benutzername |
| `{server}` | Servername |
| `{membercount}` | Aktuelle Mitgliederanzahl |

## Dashboard-Einstellungen

- **Willkommen** — Kanal, Nachricht, Bildereinstellungen
- **Abschied** — Kanal und Nachrichtentext
- **Auto-Rollen** — Welche Rollen bei Join vergeben werden
- **Vorlagen** — Verschiedene Nachrichtenvorlagen erstellen und testen

## Berechtigungen

| Berechtigung | Beschreibung |
|-------------|-------------|
| `GREETING.VIEW` | Greeting-Bereich sehen |
| `GREETING.SETTINGS_EDIT` | Einstellungen ändern |
| `GREETING.TEMPLATES_CREATE` | Vorlagen erstellen |
| `GREETING.TEMPLATES_EDIT` | Vorlagen bearbeiten |
| `GREETING.TEMPLATES_DELETE` | Vorlagen löschen |
| `GREETING.TEST_EXECUTE` | Test-Nachricht senden |
