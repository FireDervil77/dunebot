# Bot-Commands

Übersicht aller Slash-Commands und Textbefehle, die DuneBot bietet.

## Kern-Commands

Diese Befehle sind immer verfügbar, unabhängig von aktivierten Plugins:

| Command | Typ | Beschreibung |
|---------|-----|-------------|
| `/help [plugin] [command]` | Slash + Prefix | Hilfe anzeigen — Plugin-Liste oder Befehlsdetails |
| `/ping` | Slash + Prefix | Bot-Latenz prüfen |
| `/plugin [list\|info\|status]` | Slash + Prefix | Plugin-Verwaltung und -Info |
| `/setlang <sprache>` | Slash + Prefix | Bot-Sprache für den Server ändern |
| `/setprefix <prefix>` | Slash + Prefix | Prefix für Textbefehle ändern |

## Plugin-Commands

Jedes aktivierte Plugin bringt eigene Befehle mit. Hier eine Kurzübersicht — Details findest du auf den jeweiligen Plugin-Seiten.

### Moderation

`/ban`, `/kick`, `/warn`, `/timeout`, `/unban`, `/untimeout`, `/case`, `/history`, `/warnings`, `/note`, `/maxwarn`, `/softban`, `/nick`, `/purge`, `/purgeuser`, `/purgebots`, `/purgelinks`, `/purgeattachment`, `/purgetoken`, `/voice`, `/vmute`, `/vunmute`, `/deafen`, `/undeafen`, `/disconnect`, `/move`

→ [Moderation-Plugin](../plugins/moderation.md)

### AutoMod

`/automod status`, `/automod log`, `/automod strikes`, `/automod action`, `/automod whitelist`, `/automod debug`

→ [AutoMod-Plugin](../plugins/automod.md)

### Greeting

`/welcome`, `/farwell`, `/autorole`

→ [Greeting-Plugin](../plugins/greeting.md)

### Tickets

`/ticket setup`, `/ticket close`, `/ticket closeall`, `/ticket add`, `/ticket remove`, `/ticket log`, `/ticket limit`, `/tag`, `/ticketcat`

→ [Ticket-Plugin](../plugins/tickets.md)

### Giveaway

`/giveaway start`, `/giveaway end`, `/giveaway pause`, `/giveaway resume`, `/giveaway reroll`, `/giveaway list`, `/giveaway edit`, `/giveaway blacklist`, `/giveaway template`

→ [Giveaway-Plugin](../plugins/giveaway.md)

### Economy

`/bank balance`, `/bank deposit`, `/bank withdraw`, `/bank transfer`, `/daily`, `/beg`, `/gamble`

→ [Economy-Plugin](../plugins/economy.md)

### Information

`!userinfo`, `!guildinfo`, `!botstats`, `!avatar`, `!botinvite`, `!channelinfo`, `!emojiinfo`, `!uptime`

→ [Information-Plugin](../plugins/information.md)

### Statistik

`/stats`, `/rank`, `/ranks`, `/levelup`, `/statistics`

→ [Statistik-Plugin](../plugins/statistik.md)

### DuneMap

`/map show`, `/map set`, `/map remove`, `/showmap`, `/timer`, `/storm`, `/tutorial`, `/channels`

→ [DuneMap-Plugin](../plugins/dunemap.md)

### Gameserver

`/server list`, `/server status`, `/server create`, `/server start`, `/server stop`, `/server restart`

→ [Gameserver-Plugin](../plugins/gameserver.md)

### Masterserver

`/daemon list`, `/daemon status`, `/daemon register`, `/daemon delete`

→ [Masterserver-Plugin](../plugins/masterserver.md)

## Slash-Commands vs. Textbefehle

DuneBot unterstützt zwei Befehlsarten:

| Typ | Syntax | Vorteile |
|-----|--------|---------|
| **Slash-Commands** | `/befehl` | Autocomplete, Parameterübersicht, kein Prefix nötig |
| **Textbefehle** | `!befehl` | Schneller zu tippen, Prefix anpassbar |

Die meisten Plugins unterstützen beide Varianten. Einige ältere Plugins (z.B. Information) nutzen aktuell nur Textbefehle.

Slash-Commands können unter **Einstellungen** → **Allgemein** aktiviert/deaktiviert werden.
