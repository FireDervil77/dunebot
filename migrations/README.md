# Kern-Migrationen — aktiv, nicht löschen

`kern/` enthält die Schema-Änderungen, die **keinem Plugin gehören**: `guilds`,
`guild_users`, `guild_groups`, die Rechte-Views, `frontend_pages`, `blog_posts`,
Benachrichtigungen, Theme-Einstellungen. Der Kern hat kein eigenes
Plugin-Verzeichnis — dieser Ordner ist sein Ordner.

## Wer liest was

| Ort                                    | Gelesen von                   | Wann                                                        |
| -------------------------------------- | ----------------------------- | ----------------------------------------------------------- |
| `migrations/kern/`                     | `MigrationRunner.runKern()`   | bei jedem Dashboard- und Bot-Start, sowie über `migrate.js`  |
| `plugins/<name>/migrations/`           | `MigrationRunner.runPlugin()` | beim Aktivieren des Plugins                                  |
| `plugins/<name>/dashboard/migrations/` | **niemand**                   | Altlast, siehe unten                                         |

Aufrufer von `runKern`: `apps/dashboard/app.js`, `apps/bot/bot.js`, `migrate.js`.
Ausgeführte Migrationen stehen in der Tabelle `plugin_migrations`
(`scope = 'kern'`), eine Datei läuft also nie zweimal.

Fehlt der Ordner, protokolliert der Runner eine Debug-Zeile und macht weiter.
Ein bestehendes System merkt davon nichts — eine **Neuinstallation** dagegen
findet dann kein Grundschema mehr, denn `kern/20260101_000000_baseline.js` ist
dessen einzige Beschreibung.

## Was hier früher stand

Bis zum 2026-08-02 behauptete diese Datei, der Ordner sei Legacy und neue
Migrationen gehörten nach `apps/dashboard/updates/` bzw.
`plugins/<name>/dashboard/updates/`, ausgeführt von einem „KernUpdater" und
einem „PluginUpdater", beschrieben in `docs/UNIFIED_UPDATE_SYSTEM.md`.

Nichts davon existiert: keiner der beiden Ordner, keine der beiden Klassen, kein
solches Dokument, und auch die als unverzichtbar bezeichnete
`create_plugin_migrations_table.sql` gibt es nicht — die Tabelle legt der Runner
selbst an. Der Text beschrieb einen Umbau, der nie stattgefunden hat, und hat
dazu geführt, dass der Ordner einmal gelöscht wurde. Der Code ist die Auskunft,
die zählt — die Tabelle oben nennt die Stellen, an denen man das nachschlägt.

## Altlast in den Plugins

`plugins/core/dashboard/migrations/` und `plugins/masterserver/dashboard/migrations/`
werden von keinem Runner gelesen. Sie von Hand auszuführen wäre gefährlich: die
Masterserver-Datei `2.0.0-rootserver-is-node.js` droppt `daemon_instances`, die
Core-Dateien greifen ähnlich tief ein. Wer dort etwas braucht, schreibt es als
neue Migration nach `plugins/<name>/migrations/`.
