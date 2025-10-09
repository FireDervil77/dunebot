# Coriolis Storm Timer - Implementierung

## Übersicht
Der Coriolis Storm Timer basiert auf **offiziellen Daten** vom Dune: Awakening Discord Bot (Peter APP). Jede Region hat einen **wöchentlichen 10-Stunden-Storm**, der automatisch berechnet wird.

## Konfiguration

### Server-Regionen (offizielle Zeiten)
- **EU** (Europe): Montag 19:00 - Dienstag 05:00 (10h)
- **NA** (North America): Dienstag 02:00 - 12:00 (10h)
- **SA** (South America): Dienstag 00:00 - 10:00 (10h)
- **AS** (Asia): Montag 13:00 - 23:00 (10h)
- **OCE** (Oceania): Montag 11:00 - 21:00 (10h)

**Alle Zeiten in lokaler Zeitzone!**

### Automatische Berechnung
Der Timer berechnet automatisch:
- ✅ **Nächsten Storm-Start** (basierend auf wöchentlichem Reset)
- ✅ **Storm-Ende** (10 Stunden nach Start)
- ✅ **Countdown** in Tagen, Stunden, Minuten
- ✅ **Aktiv-Status** (ob Storm gerade läuft)

**Keine manuellen Einstellungen mehr nötig!**

## Architektur

### Backend (`shared/coriolisStormConfig.js`)
- Zentrale Konfigurationsdatei mit **UTC-Zeiten**
- Funktion `getNextStormTiming(region)` berechnet nächsten Storm
- Unterstützt alle 5 Server-Regionen
- Day-Offsets für regionen-spezifische Wochentage

### API (`dashboard/index.js`)
- Route: `GET /guild/:guildId/plugins/dunemap/api/storm-timer`
- Lädt gespeicherte Region aus DB (`configs` Tabelle, Key: `coriolis_region`)
- Gibt Storm-Daten inkl. Countdown zurück

### Frontend (`dashboard/public/js/dunemap-admin.js`)
- Lädt Storm-Daten via API-Call
- Aktualisiert Countdown jede Sekunde
- Format: `4d 6h 24m 12s`

### Settings (`dashboard/views/guild/dunemap-settings.ejs`)
- **Einzige Einstellung**: Server-Region Dropdown
- Default: EU
- Keine weiteren Storm-Settings nötig!

## Verwendung

### User-Perspektive
1. In DuneMap Settings → "Coriolis Storm Server-Region" auswählen
2. Fertig! Timer berechnet alles automatisch
3. Admin-Seite zeigt Live-Countdown + Region + Storm-Zeit

### Entwickler-Perspektive
```javascript
// Storm-Config importieren
const { getNextStormTiming } = require('../shared/coriolisStormConfig');

// Nächsten Storm für EU berechnen
const stormData = getNextStormTiming('EU');
console.log(stormData.daysUntil, stormData.hoursUntil, stormData.minutesUntil);
console.log(stormData.isActive); // true wenn Storm gerade aktiv
console.log(stormData.nextStormStart.toISOString()); // UTC Timestamp
```

## Testing
```bash
cd /home/firedervil/dunebot_dev/plugins/dunemap
node test_storm_timer.js
```

Zeigt alle 5 Regionen mit aktuellen Countdown-Werten und verifiziert gegen offizielle Daten.

## Datenbankstruktur
Keine separate Tabelle erforderlich! Verwendet die zentrale `configs` Tabelle:

```sql
-- Beispiel-Eintrag
INSERT INTO configs (plugin_name, config_key, config_value, guild_id, context)
VALUES ('dunemap', 'coriolis_region', '"EU"', '123456789', 'guild');
```

**Nur noch 1 Config-Key:**
- `coriolis_region`: Server-Region (EU/NA/SA/AS/OCE)

## Datenquelle
Offizielle Zeiten vom **Dune: Awakening Discord Bot** (Peter APP):
- Verifiziert gegen: https://www.duneawakeningstormtracker.com/
- Letztes Update: 9. Oktober 2025
- Nächste Verifikation: Bei Game-Updates prüfen

## Changelog
- **2025-10-09**: 
  - ✅ Initiale Implementierung mit 5 Regionen
  - ✅ Korrektur basierend auf offiziellen Discord-Daten
  - ✅ Entfernung überflüssiger Settings (Timer-Format, Timezone, Dauer, Auto-Recalc)
  - ✅ Vollständig automatische Berechnung
  - ✅ Verifikation gegen duneawakeningstormtracker.com (100% Übereinstimmung)
