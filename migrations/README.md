# ⚠️ LEGACY — Nicht mehr verwenden!

Dieser Ordner enthält **alte, manuell ausgeführte** Migrationen.

## Neue Migrations gehen jetzt an:

| Typ                   | Ort                                 | System                                       |
| --------------------- | ----------------------------------- | -------------------------------------------- |
| **Kern-Änderungen**   | `apps/dashboard/updates/`           | KernUpdater (automatisch bei Startup)        |
| **Plugin-Änderungen** | `plugins/<name>/dashboard/updates/` | PluginUpdater (automatisch bei enablePlugin) |

Siehe `docs/UNIFIED_UPDATE_SYSTEM.md` für Details.

## Warum bleibt dieser Ordner?

- **Archiv** — Historische Referenz für bereits ausgeführte Migrationen
- **create_plugin_migrations_table.sql** — Wird einmalig für Fresh-Installs benötigt
- Keine Datei hier wird beim Startup automatisch ausgeführt
