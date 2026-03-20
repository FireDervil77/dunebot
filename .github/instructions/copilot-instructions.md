---
applyTo: "**"
---

# COPILOT EDITS OPERATIONAL GUIDELINES

## PROJECT OVERVIEW

DuneBot ist ein modulares Discord-Bot-System mit einem WordPress-ähnlichen Plugin-System. Das Projekt besteht aus:

- **Bot** (Discord.js): Bot-Funktionalität mit Commands und Events
- **Dashboard** (Express.js): Web-Interface für Guild-Management mit Discord OAuth2
- **Plugin-System**: Erweiterbare Architektur für beide Seiten (Bot + Dashboard)
- **Theme-System**: Anpassbare UI-Themes für das Dashboard
- **Hook-System**: WordPress-ähnliche Hooks für Plugin-Interaktion
- **MySQL-Datenbank**: Nativer SQL-Client (keine ORM)
- **DASHBOARD**: Nutzte AdminLTE 3 & Bootstrap 4 (nichts anderes nutzten!)
- **Frontend**: Nutzte LUMIA THEME (Bootstrap)

## 🚧 ACTIVE DEVELOPMENT PLAN

**Aktuelles Großprojekt:** Event-Bus Architecture Umbau  
**Detaillierter Plan:** [`docs/EVENT_BUS_ARCHITECTURE_PLAN.md`](../../docs/EVENT_BUS_ARCHITECTURE_PLAN.md)

**Wichtig:** Bei allen Änderungen an der Kommunikations-Architektur (IPM, SSE, Events) den Plan konsultieren und den Fortschritt dort aktualisieren!

**Wichtig** Den process dunebot-dashboard-dev nicht neustarten wenn er in pm2 offline ist. dann ist er bereits in der Developper-Terminal aktiv!

## 🗄️ DATENBANK-MIGRATIONEN (PFLICHT!)

**Bei JEDER DB-Änderung** (neue Tabelle, ALTER TABLE, neue Spalte, Index, View, Trigger) **MUSS** eine Migration erstellt werden:

```bash
# Kern-Migration (guilds, users, permissions, etc.)
node migrate.js create kern "beschreibung"

# Plugin-Migration
node migrate.js create plugin <pluginname> "beschreibung"
```

**Regeln:**
- **Niemals** direkte SQL-Änderungen in onEnable(), Routen oder Controllern — immer eine Migration-Datei!
- Kern-Migrationen → `migrations/kern/`
- Plugin-Migrationen → `plugins/<name>/migrations/`
- Format: `YYYYMMDD_HHMMSS_beschreibung.js` mit `up(db)` und optionalem `down(db)`
- Idempotent schreiben: `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`
- Status prüfen: `node migrate.js status`
- MigrationRunner-Engine: `packages/dunebot-core/lib/MigrationRunner.js`