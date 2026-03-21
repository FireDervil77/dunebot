# AutoMod

Das AutoMod-Plugin erkennt und filtert automatisch unerwünschte Inhalte in Nachrichten — ohne dass ein Moderator manuell eingreifen muss.

## Funktionen

- Automatische Spam-Erkennung
- Link-Filter (Werbung, unerwünschte URLs)
- Token-Filter (sensible Inhalte)
- Konfigurierbare Regeln und Aktionen
- Whitelist für Kanäle, Rollen und Benutzer
- Strafpunkte-System (Strikes)

## Bot-Commands

| Command | Beschreibung |
|---------|-------------|
| `/automod status` | Aktuellen AutoMod-Status anzeigen |
| `/automod log <kanal>` | Log-Kanal für AutoMod-Aktionen setzen |
| `/automod strikes <anzahl> <aktion>` | Aktion bei X Strikes (warn/timeout/kick/ban) |
| `/automod action <regel> <aktion>` | Aktion für bestimmte Regel festlegen |
| `/automod whitelist <add\|remove> <kanal\|rolle>` | Kanäle oder Rollen von AutoMod ausschließen |
| `/automod debug` | Debug-Informationen anzeigen |

## Regeltypen

| Regel | Was wird gefiltert |
|-------|-------------------|
| **Spam** | Wiederholte Nachrichten, Nachrichtenflut |
| **Links** | URLs und Einladungslinks |
| **Token** | Discord-Tokens und sensible Zeichenketten |
| **Benutzerdefiniert** | Eigene Wörter und Muster |

## Dashboard-Einstellungen

- **Regeln** — Filterregeln erstellen, bearbeiten und priorisieren
- **Whitelist** — Ausnahmen für Kanäle, Rollen und Benutzer
- **Log-Kanal** — Wohin werden AutoMod-Aktionen protokolliert?
- **Strike-System** — Wie viele Verstöße bis zur automatischen Aktion?

## Berechtigungen

| Berechtigung | Beschreibung |
|-------------|-------------|
| `AUTOMOD.VIEW` | AutoMod-Bereich sehen |
| `AUTOMOD.SETTINGS_EDIT` | Einstellungen ändern |
| `AUTOMOD.RULES_CREATE` | Neue Regeln erstellen |
| `AUTOMOD.RULES_EDIT` | Regeln bearbeiten |
| `AUTOMOD.RULES_DELETE` | Regeln löschen |
| `AUTOMOD.WHITELIST_MANAGE` | Whitelist verwalten |
| `AUTOMOD.LOGS_VIEW` | AutoMod-Logs einsehen |
