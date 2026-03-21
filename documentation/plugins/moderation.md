# Moderation

Das Moderation-Plugin bietet umfassende Werkzeuge, um deinen Discord-Server sicher und ordentlich zu halten.

## Funktionen

- Benutzer bannen, kicken, warnen und stummschalten
- Nachrichtenverlauf mit Moderationsfällen
- Automatische Aktionen bei Warn-Schwellenwert
- Moderator-Notizen zu Benutzern
- Massen-Löschung von Nachrichten (Purge)
- Voice-Moderation (Stummschalten, Disconnecten, Verschieben)

## Bot-Commands

### Strafaktionen

| Command | Beschreibung | Beispiel |
|---------|-------------|---------|
| `/ban <user> [grund]` | Benutzer permanent bannen | `/ban @Troll Wiederholtes Spammen` |
| `/kick <user> [grund]` | Benutzer vom Server kicken | `/kick @User Regelverstoß` |
| `/warn <user> [grund]` | Verwarnung aussprechen | `/warn @User Sprache` |
| `/timeout <user> <dauer>` | Benutzer temporär stummschalten | `/timeout @User 10m` |
| `/softban <user> [grund]` | Ban + sofortiger Unban (löscht Nachrichten) | `/softban @User Cleanup` |

### Strafaktionen aufheben

| Command | Beschreibung |
|---------|-------------|
| `/unban <user>` | Ban aufheben |
| `/untimeout <user>` | Timeout aufheben |

### Fallverwaltung

| Command | Beschreibung |
|---------|-------------|
| `/case <id>` | Moderationsfall anzeigen |
| `/history <user>` | Alle Fälle eines Benutzers |
| `/warnings <user>` | Verwarnungen eines Benutzers |
| `/note <user> <text>` | Notiz zu einem Benutzer hinzufügen |

### Warn-Schwellenwert

| Command | Beschreibung |
|---------|-------------|
| `/maxwarn <anzahl> <aktion>` | Automatische Aktion bei X Warns (ban/kick/timeout) |

### Nachrichten löschen (Purge)

| Command | Beschreibung |
|---------|-------------|
| `/purge <anzahl>` | Letzte X Nachrichten löschen |
| `/purgeuser <user> <anzahl>` | Nachrichten eines bestimmten Users löschen |
| `/purgebots <anzahl>` | Nur Bot-Nachrichten löschen |
| `/purgelinks <anzahl>` | Nur Nachrichten mit Links löschen |
| `/purgeattachment <anzahl>` | Nur Nachrichten mit Anhängen löschen |
| `/purgetoken <text> <anzahl>` | Nachrichten mit bestimmtem Text löschen |

### Voice-Moderation

| Command | Beschreibung |
|---------|-------------|
| `/voice` | Voice-Channel-Verwaltung |
| `/vmute <user>` | Benutzer im Voice stummschalten |
| `/vunmute <user>` | Voice-Stummschaltung aufheben |
| `/deafen <user>` | Benutzer taub schalten |
| `/undeafen <user>` | Taubschaltung aufheben |
| `/disconnect <user>` | Benutzer aus Voice entfernen |
| `/move <user> <kanal>` | Benutzer in anderen Voice-Kanal verschieben |
| `/nick <user> <name>` | Nickname eines Benutzers ändern |

## Dashboard-Einstellungen

Im Dashboard findest du nach Aktivierung des Plugins:

- **Moderationsfälle** — Übersicht aller Fälle mit Filter und Suche
- **Einstellungen** — Mod-Log-Kanal, geschützte Rollen, Kanal-Regeln

## Berechtigungen

| Berechtigung | Beschreibung |
|-------------|-------------|
| `MODERATION.VIEW` | Moderationsbereich sehen |
| `MODERATION.BAN_EXECUTE` | Benutzer bannen |
| `MODERATION.KICK_EXECUTE` | Benutzer kicken |
| `MODERATION.MUTE_EXECUTE` | Benutzer stummschalten |
| `MODERATION.WARN_EXECUTE` | Verwarnungen aussprechen |
| `MODERATION.LOGS_VIEW` | Mod-Logs einsehen |
| `MODERATION.CASES_MANAGE` | Fälle verwalten |
| `MODERATION.NOTES_VIEW` | Notizen einsehen |
| `MODERATION.NOTES_MANAGE` | Notizen bearbeiten |
| `MODERATION.SETTINGS_EDIT` | Einstellungen ändern |
| `MODERATION.PROTECTED_ROLES_MANAGE` | Geschützte Rollen verwalten |
| `MODERATION.CHANNEL_RULES_MANAGE` | Kanal-Regeln verwalten |
