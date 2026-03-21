# Information

Das Information-Plugin stellt nützliche Informationsbefehle bereit, mit denen du Details zu Benutzern, dem Server und dem Bot abrufen kannst.

## Bot-Commands

| Command | Aliases | Beschreibung |
|---------|---------|-------------|
| `!userinfo [@user]` | `uinfo`, `memberinfo` | Detaillierte Infos zu einem Benutzer (Rollen, Join-Datum, etc.) |
| `!guildinfo` | `serverinfo` | Server-Statistiken (Mitglieder, Kanäle, Rollen, Boost-Level) |
| `!botstats` | `botstat`, `botinfo` | Bot-Laufzeitstatistiken (Uptime, Speicher, Server-Anzahl) |
| `!avatar [@user]` | — | Profilbild eines Benutzers in voller Größe anzeigen |
| `!botinvite` | — | Einladungslink für den Bot generieren |
| `!channelinfo [#kanal]` | — | Details zu einem Kanal (Erstelldatum, Typ, Topic) |
| `!emojiinfo <emoji>` | — | Informationen zu einem benutzerdefinierten Emoji |
| `!uptime` | — | Bot-Betriebsdauer anzeigen |

> **Hinweis:** Das Information-Plugin nutzt aktuell Textbefehle mit Prefix (Standard: `!`). Slash-Command-Varianten sind geplant.

## Beispiele

**Benutzerinfo anzeigen:**
```
!userinfo @MaxMustermann
```
Zeigt: Username, Discriminator, ID, Account-Alter, Server-Beitrittsdatum, Rollen, Boost-Status.

**Serverinfo:**
```
!guildinfo
```
Zeigt: Servername, Besitzer, Erstelldatum, Mitgliederanzahl, Kanäle, Rollen, Boost-Level und -Anzahl.

## Berechtigungen

Dieses Plugin benötigt keine besonderen Dashboard-Berechtigungen — die Commands stehen allen Benutzern zur Verfügung.
