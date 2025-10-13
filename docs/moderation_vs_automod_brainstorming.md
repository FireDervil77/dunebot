# Moderation vs. AutoMod - Plugin-Koexistenz Analyse

**Datum:** 2025-10-13  
**Thema:** Können/Sollen Moderation + AutoMod Plugins parallel laufen?

---

## 🎯 Die Kernfrage

**Ist es sinnvoll, beide Plugins gleichzeitig zu betreiben?**

Oder überschneiden sich die Features zu stark und führen zu:
- Verwirrung bei Admins
- Doppelte Logs/Actions
- Inkonsistente Moderation
- Performance-Issues

---

## 📊 Feature-Vergleich

### Moderation Plugin (MANUELL)

**Zweck:** Admins können **manuell** Moderation durchführen

**Features:**
- ✅ `/ban` - Mitglied bannen
- ✅ `/kick` - Mitglied kicken  
- ✅ `/timeout` - Mitglied stummschalten
- ✅ `/softban` - Mitglied bannen + sofort entbannen (löscht Messages)
- ✅ `/warn` - Warnung aussprechen
- ✅ `/warnings` - Warnungen anzeigen
- ✅ `/unban` - Ban aufheben
- ✅ `/untimeout` - Timeout aufheben
- ✅ `/nick` - Nickname ändern
- ✅ `/modlog` - Moderation-Log anzeigen
- ✅ Message-Commands: Clear/Purge messages

**Datenbank:**
- `moderation_settings` - Guild-Einstellungen (modlog_channel, max_warn_limit, max_warn_action, default_reason)
- `moderation_logs` - Alle Moderationsaktionen (WARN, KICK, BAN, TIMEOUT, etc.)

**Charakteristika:**
- 👤 **Admin-gesteuert**: Erfordert manuellen Command
- 📋 **Vollständiges Logging**: Jede Aktion wird protokolliert
- ⚖️ **Warn-System**: Akkumulierende Warnungen → Auto-Aktion bei Limit
- 🔍 **Nachvollziehbar**: Wer, Wann, Warum, Welche Aktion

---

### AutoMod Plugin (AUTOMATISCH)

**Zweck:** Bot moderiert **automatisch** nach Regeln

**Features:**
- 🤖 **Auto-Detection**: Regelüberschreitungen werden automatisch erkannt
- 📈 **Strike-System**: Violations akkumulieren, bei Schwellenwert → Aktion
- 🛡️ **Content-Filter**:
  - Anti-Spam (identische Nachrichten)
  - Anti-Ghostping (gelöschte Mentions)
  - Anti-Mass-Mention (zu viele Pings)
  - Anti-Attachments (Dateien blockieren)
  - Anti-Links (URLs blockieren)
  - Anti-Invites (Discord-Invites blockieren)
  - Max Lines (zu lange Nachrichten)
- ⚡ **Instant Delete**: Regelwidrige Nachrichten sofort löschen
- 🎯 **Channel-Whitelist**: Bestimmte Channels ausnehmen
- 📊 **Debug-Modus**: Auch Admins/Mods prüfen

**Datenbank:**
- `automod_settings` - Guild-Konfiguration (alle Anti-Features, strikes, action)
- `automod_strikes` - Member-Strike-Counter
- `automod_logs` - Violation-History

**Charakteristika:**
- 🤖 **Vollautomatisch**: Keine Admin-Interaktion nötig
- ⚡ **Echtzeit**: Sofortige Reaktion auf Violations
- 🔄 **Kontinuierlich**: Überwacht alle Nachrichten 24/7
- 📉 **Präventiv**: Verhindert Spam/Flood BEVOR es eskaliert

---

## 🔗 Bestehende Integration

### AutoMod ruft Moderation-Plugin OPTIONAL auf!

**Code in `automod/bot/events/messageCreate.js`:**
```javascript
// Optional: Moderation-Plugin Integration
let addModAction;
try {
    addModAction = require("../../moderation/bot/helpers/addModAction");
} catch (_err) {
    addModAction = () => {}; // Fallback: Nichts tun
}

// Später im Code:
if (totalStrikes >= settings.strikes) {
    // Aktion ausführen
    await addModAction(message, member, settings.action, reason);
    // Strikes zurücksetzen
    await db.updateStrikes(guildId, memberId, 0);
}
```

**Was bedeutet das?**
- AutoMod **versucht** `addModAction()` aus Moderation-Plugin zu importieren
- **Falls verfügbar**: AutoMod-Aktionen werden AUCH im Moderation-Log gespeichert
- **Falls nicht verfügbar**: AutoMod funktioniert trotzdem (standalone)

**`addModAction()` in Moderation:**
```javascript
static async addModAction(issuer, target, reason, action) {
    switch (action) {
        case "TIMEOUT":
            return ModUtils.timeoutTarget(issuer, target, DEFAULT_TIMEOUT_HOURS * 60 * 60 * 1000, reason);
        case "KICK":
            return ModUtils.kickTarget(issuer, target, reason);
        case "SOFTBAN":
            return ModUtils.softbanTarget(issuer, target, reason);
        case "BAN":
            return ModUtils.banTarget(issuer, target, reason);
    }
}
```

**Integration-Flow:**
```
User postet Spam
    ↓
AutoMod erkennt Violation
    ↓
Strike +1
    ↓
Strikes >= Threshold (z.B. 10)
    ↓
AutoMod ruft addModAction(member, "TIMEOUT", "Automod: Max strikes")
    ↓
Moderation-Plugin:
  - Führt TIMEOUT aus
  - Loggt in moderation_logs (admin_id = Bot, reason = "Automod: Max strikes")
  - Sendet Log-Embed an modlog_channel
  - DM an User (optional)
    ↓
AutoMod setzt Strikes zurück auf 0
```

---

## ✅ Vorteile der Koexistenz

### 1. **Vollständige Abdeckung**
- **Moderation**: Manuelle Eingriffe bei komplexen Fällen
- **AutoMod**: Automatisierte Basis-Moderation (Spam, Flood)
- **Zusammen**: 24/7 automatische Überwachung + Admin-Kontrolle bei Bedarf

### 2. **Zentrales Logging**
- Alle Aktionen (manuell + automatisch) landen in `moderation_logs`
- Admins sehen komplette Moderation-History eines Users
- Einfacher zu auditieren

### 3. **Konsistente Bestrafung**
- AutoMod nutzt dieselben Actions wie Moderation (TIMEOUT, KICK, BAN)
- Keine unterschiedlichen Implementierungen
- Einheitliche DMs und Log-Embeds

### 4. **Entlastung der Admins**
- AutoMod übernimmt Routine-Arbeit (Spam, Link-Spam, etc.)
- Admins können sich auf wichtige Fälle konzentrieren
- Weniger Burnout durch Moderation-Workload

### 5. **Flexibilität**
- AutoMod kann deaktiviert werden (per Guild)
- Moderation bleibt immer verfügbar
- Guilds können selbst entscheiden: Nur Moderation ODER Moderation + AutoMod

### 6. **Warn-System + Strike-System kombinierbar**
- **Moderation Warns**: Admin gibt manuelle Warnungen (`/warn`)
  - Bei `max_warn_limit` erreicht → `max_warn_action` (z.B. KICK)
- **AutoMod Strikes**: Bot zählt Violations automatisch
  - Bei `strikes` erreicht → `action` (z.B. TIMEOUT)
- **Unabhängig**: Warns und Strikes sind getrennte Systeme
- **Sinnvoll**: User kann gleichzeitig Warns (manuell) UND Strikes (auto) haben

---

## ❌ Nachteile / Herausforderungen

### 1. **Komplexität für Admins**
- Zwei verschiedene Systeme zu konfigurieren
- Moderation: `/moderation settings` (im Dashboard)
- AutoMod: `/automod status`, `/anti`, `/autodelete` (im Discord)
- **Risiko**: Admins sind verwirrt welches System was macht

### 2. **Potenzielle Doppelbestrafung**
- **Szenario**: User postet Spam
  - AutoMod erkennt → Strike +1, Message gelöscht
  - Admin sieht es trotzdem → `/warn` oder `/kick`
  - **Ergebnis**: User wird doppelt bestraft (Strike + Warn/Kick)
- **Aber**: Unwahrscheinlich, da AutoMod schneller ist (Millisekunden vs. Admin-Reaktion)

### 3. **Logging-Duplikate?**
- AutoMod loggt in: `automod_logs`
- Moderation loggt in: `moderation_logs`
- **Aber**: Wenn AutoMod `addModAction()` nutzt, landet es NUR in `moderation_logs`
- **Problem**: `automod_logs` enthält dann mehr (alle Strikes, auch unter Threshold)

### 4. **Unterschiedliche Default-Reasons**
- Moderation: `default_reason` aus `moderation_settings`
- AutoMod: Hardcoded "Automod: Max strikes received"
- **Aber**: Kein echtes Problem, da klar erkennbar ist ob Auto oder Manuell

### 5. **Performance**
- AutoMod prüft JEDE Nachricht (messageCreate Event)
- Bei sehr aktiven Servern: Viele Datenbank-Queries
- **Aber**: Mit Channel-Whitelist und Debug-Modus reduzierbar

---

## 🎭 Use Cases: Wann welches Plugin?

### Szenario 1: Kleiner Server (< 100 Members)
**Empfehlung:** Nur Moderation-Plugin
- **Warum:** Wenig Spam, Admins haben Zeit für manuelle Moderation
- **Vorteil:** Einfacher, keine Auto-Actions die zu streng sein könnten
- **AutoMod:** Nicht nötig

### Szenario 2: Mittelgroßer Server (100-1000 Members)
**Empfehlung:** Moderation + AutoMod (selektiv)
- **Warum:** Gelegentlicher Spam, Admins nicht 24/7 online
- **AutoMod-Config:**
  - ✅ Anti-Spam
  - ✅ Anti-Invites
  - ✅ Anti-Ghostping
  - ❌ Anti-Links (zu restriktiv)
  - ❌ Anti-Attachments (zu restriktiv)
  - Strikes: 5-10
  - Action: TIMEOUT (nicht KICK/BAN)

### Szenario 3: Großer Server (> 1000 Members)
**Empfehlung:** Moderation + AutoMod (aggressiv)
- **Warum:** Viel Traffic, Raids, Spam-Wellen
- **AutoMod-Config:**
  - ✅ Alle Anti-Features aktiviert
  - Strikes: 3-5 (strenger)
  - Action: KICK oder BAN
  - Whitelist: Trusted-Channels, Bot-Commands
- **Moderation:** Für Appeals, komplexe Fälle, manuelle Bans

### Szenario 4: Community mit viel Link-Sharing
**Empfehlung:** Nur Moderation
- **Warum:** AutoMod Anti-Links würde zu viele legitime Links blocken
- **Alternative:** Channel-spezifische Regeln (nicht von AutoMod unterstützt)

### Szenario 5: Gaming-Server mit Voice + Text
**Empfehlung:** Moderation + AutoMod (Text-Channels)
- **AutoMod:** Nur für Text-Channels (Voice nicht überwachbar)
- **Moderation:** Voice-Bans, Text-Bans, Timeouts

---

## 🔧 Lösungsansätze für Koexistenz

### Ansatz 1: **Beide Plugins getrennt lassen** ✅ EMPFOHLEN

**Wie:**
- AutoMod und Moderation sind **unabhängige Plugins**
- AutoMod nutzt **optional** `addModAction()` aus Moderation
- Admins können **pro Guild** entscheiden:
  - Nur Moderation aktivieren
  - Moderation + AutoMod aktivieren
  - Nur AutoMod aktivieren (falls Standalone-Support)

**Vorteile:**
- ✅ Maximale Flexibilität
- ✅ Guilds entscheiden selbst
- ✅ Plugins bleiben wartbar (getrennte Codebases)
- ✅ AutoMod kann ohne Moderation laufen (Standalone)

**Nachteile:**
- ❌ Admins müssen beide Systeme verstehen
- ❌ Zwei Dashboards/Settings-Pages

**Implementierung:**
- ✅ Bereits so geplant! (siehe AutoMod Code)
- ✅ Moderation-Plugin muss `addModAction()` exportieren
- ✅ AutoMod macht graceful fallback wenn nicht verfügbar

---

### Ansatz 2: **AutoMod in Moderation integrieren** ❌ NICHT EMPFOHLEN

**Wie:**
- AutoMod wird **Teil** des Moderation-Plugins
- `/moderation automod ...` statt `/automod ...`
- Shared Dashboard-Page mit Tabs: "Manual" / "Auto"

**Vorteile:**
- ✅ Ein einziges Plugin zu managen
- ✅ Ein Dashboard mit allen Settings
- ✅ Kein Import-Chaos

**Nachteile:**
- ❌ Moderation-Plugin wird RIESIG (> 2000 Zeilen)
- ❌ Schwer wartbar (zu viele Features in einem Plugin)
- ❌ Nicht modular (kann nicht getrennt aktiviert werden)
- ❌ Breaking Change für bestehende Guilds

**Fazit:** NICHT machen! Gegen Plugin-System-Prinzipien.

---

### Ansatz 3: **Moderation als Dependency von AutoMod** ⚠️ MÖGLICH

**Wie:**
- AutoMod **erfordert** Moderation-Plugin
- In `automod/package.json`:
  ```json
  "dependencies": {
      "moderation": "*"
  }
  ```
- PluginManager lädt Moderation automatisch wenn AutoMod aktiviert wird

**Vorteile:**
- ✅ Klare Abhängigkeit
- ✅ Kein Fallback-Code nötig
- ✅ Garantiert konsistente Actions

**Nachteile:**
- ❌ AutoMod kann nicht standalone laufen
- ❌ Guilds MÜSSEN beide Plugins aktivieren
- ❌ Weniger Flexibilität

**Fazit:** Nur wenn AutoMod niemals alleine laufen soll.

---

### Ansatz 4: **Conflict Detection im PluginManager** 🤔 INTERESSANT

**Wie:**
- PluginManager erkennt wenn beide Plugins aktiv sind
- Zeigt Warning im Dashboard: "Moderation + AutoMod aktiv - sicher dass du beide willst?"
- Optional: Konflikt-Check ("Beide Plugins nutzen ähnliche Features")

**Vorteile:**
- ✅ Admins werden gewarnt
- ✅ Reduziert versehentliche Doppel-Aktivierung
- ✅ Kann Tipps geben ("AutoMod empfohlen für Server > 500 Members")

**Nachteile:**
- ❌ Extra Code im PluginManager
- ❌ Plugins sind nicht wirklich "conflicted" (funktionieren parallel)

**Implementierung:**
- Neue Eigenschaft in `package.json`:
  ```json
  "warnings": {
      "coexistence": ["moderation"]
  }
  ```
- PluginManager zeigt Warnung beim Aktivieren

---

## 📋 Empfohlene Strategie

### ✅ **Option A: Beide Plugins getrennt + Optional Integration** (FAVORIT)

**Das machen wir:**

1. **AutoMod-Plugin reparieren** (MySQL-Migration)
   - Eigenständiges Plugin mit eigenen Tabellen
   - Optional: `addModAction()` aus Moderation nutzen
   - Funktioniert AUCH ohne Moderation (Standalone)

2. **Moderation-Plugin erweitern**
   - `addModAction()` als **exportierte Utility** verfügbar machen
   - Neue Datei: `plugins/moderation/bot/helpers/addModAction.js`
   ```javascript
   const ModUtils = require('../utils');
   
   /**
    * Führt Moderation-Aktion aus und loggt sie
    * @param {Message|Interaction} context
    * @param {GuildMember} target
    * @param {string} action - TIMEOUT|KICK|BAN|SOFTBAN
    * @param {string} reason
    */
   async function addModAction(context, target, action, reason) {
       const issuer = context.member || context.author;
       return await ModUtils.addModAction(issuer, target, reason, action);
   }
   
   module.exports = addModAction;
   ```

3. **AutoMod nutzt graceful import**
   ```javascript
   let addModAction;
   try {
       addModAction = require("../../moderation/bot/helpers/addModAction");
       Logger.info('[AutoMod] Moderation-Plugin Integration aktiviert');
   } catch (_err) {
       Logger.warn('[AutoMod] Moderation-Plugin nicht gefunden - Standalone-Modus');
       addModAction = async (context, target, action, reason) => {
           // Standalone: Direkte Discord.js Actions ohne Moderation-Log
           switch (action) {
               case "TIMEOUT":
                   await target.timeout(24 * 60 * 60 * 1000, reason);
                   break;
               case "KICK":
                   await target.kick(reason);
                   break;
               case "BAN":
                   await target.ban({ reason });
                   break;
           }
       };
   }
   ```

4. **Dashboard-Hinweis**
   - Wenn beide Plugins aktiv: Info-Box in beiden Dashboards
   - **In AutoMod-Dashboard:**
     ```
     ℹ️ Moderation-Plugin ist aktiv
     Alle AutoMod-Aktionen werden auch im Moderation-Log gespeichert.
     ```
   - **In Moderation-Dashboard:**
     ```
     ℹ️ AutoMod-Plugin ist aktiv
     Automatische Moderations-Aktionen erscheinen hier im Log.
     Filter: [ Alle | Nur Manuell | Nur AutoMod ]
     ```

5. **Registry-Eintrag** (für Doku)
   ```json
   {
       "automod": {
           "optional_integration": ["moderation"],
           "standalone": true,
           "description": "Nutzt Moderation-Plugin falls verfügbar"
       }
   }
   ```

**Vorteile:**
- ✅ Maximale Flexibilität (beide unabhängig)
- ✅ Opt-in Integration (automatisch wenn beide aktiv)
- ✅ Standalone-Support (AutoMod funktioniert alleine)
- ✅ Einfach zu verstehen (klare Trennung)
- ✅ Wartbar (getrennte Codebases)

**Nachteile:**
- ❌ Admins müssen beide Systeme konfigurieren
- ❌ Zwei Dashboard-Pages (aber mit Links zueinander)

---

## 🎓 Best Practices für Admins

### Dokumentation erstellen: "Moderation + AutoMod Setup Guide"

**Inhalt:**

1. **Wann nur Moderation?**
   - Kleiner Server (< 100 Members)
   - Viel legitimer Link-Sharing
   - Community-Fokus mit wenig Spam

2. **Wann Moderation + AutoMod?**
   - Mittel-großer Server (> 100 Members)
   - Gelegentlicher Spam/Raids
   - Admins nicht 24/7 verfügbar

3. **Empfohlene AutoMod-Einstellungen**
   - **Konservativ**: Strikes 10, Action TIMEOUT, nur Anti-Spam + Anti-Invites
   - **Balanciert**: Strikes 5, Action TIMEOUT, Anti-Spam + Anti-Invites + Anti-Ghostping
   - **Aggressiv**: Strikes 3, Action KICK, alle Anti-Features

4. **Channel-Whitelist**
   - Immer whitelisten: Bot-Commands, Admin-Channels, Log-Channels
   - Optional: Meme-Channels (für Spam-Memes), Media-Channels (für Attachments)

5. **Debug-Modus**
   - Beim Setup: DEBUG ON (testet auch Admin-Nachrichten)
   - Im Betrieb: DEBUG OFF (ignoriert Admins/Mods)

6. **Logging-Strategie**
   - Moderation-Log-Channel: Alle manuellen + automatischen Actions
   - AutoMod-Log-Channel: Alle Violations (auch unter Strike-Threshold)
   - Getrennt halten für bessere Übersicht

---

## 🔮 Zukünftige Erweiterungen

### Dashboard-Integration für besseres Management

**AutoMod Dashboard-Page:**
```
╔════════════════════════════════════════════════╗
║  AutoMod Konfiguration                         ║
╠════════════════════════════════════════════════╣
║                                                ║
║  ℹ️ Moderation-Plugin aktiv                    ║
║  Alle Aktionen werden auch im Moderation-Log   ║
║  gespeichert. → Zu Moderation                  ║
║                                                ║
║  ┌─ Basis-Einstellungen ────────────────────┐  ║
║  │ Log-Channel: #automod-logs              │  ║
║  │ Max Strikes: [10]                       │  ║
║  │ Aktion: [TIMEOUT ▼]                     │  ║
║  │ Debug-Modus: [OFF]                      │  ║
║  └─────────────────────────────────────────┘  ║
║                                                ║
║  ┌─ Content-Filter ──────────────────────────┐║
║  │ [✓] Anti-Spam                           │ ║
║  │ [✓] Anti-Invites                        │ ║
║  │ [✓] Anti-Ghostping                      │ ║
║  │ [ ] Anti-Links                          │ ║
║  │ [ ] Anti-Attachments                    │ ║
║  │ [✓] Anti-Mass-Mention (Threshold: 5)   │ ║
║  │ Max Lines: [0] (0 = deaktiviert)       │ ║
║  └─────────────────────────────────────────┘  ║
║                                                ║
║  ┌─ Channel-Whitelist ───────────────────────┐║
║  │ #bot-commands                           │ ║
║  │ #admin-chat                             │ ║
║  │ [+ Channel hinzufügen]                  │ ║
║  └─────────────────────────────────────────┘  ║
║                                                ║
║  [💾 Speichern]                                ║
║                                                ║
╚════════════════════════════════════════════════╝
```

**Moderation Dashboard-Page (erweitert):**
```
╔════════════════════════════════════════════════╗
║  Moderation Einstellungen                      ║
╠════════════════════════════════════════════════╣
║                                                ║
║  ℹ️ AutoMod-Plugin aktiv                       ║
║  Automatische Actions erscheinen im Log.       ║
║  → Zu AutoMod-Einstellungen                    ║
║                                                ║
║  ┌─ Log-Einstellungen ──────────────────────┐  ║
║  │ ModLog-Channel: #mod-log                │  ║
║  │ Default Reason: "No reason provided"    │  ║
║  └─────────────────────────────────────────┘  ║
║                                                ║
║  ┌─ Warn-System ─────────────────────────────┐║
║  │ Max Warnungen: [5]                      │ ║
║  │ Aktion bei Max: [KICK ▼]               │ ║
║  └─────────────────────────────────────────┘  ║
║                                                ║
║  [💾 Speichern]                                ║
║                                                ║
║  ┌─ Moderations-Log ─────────────────────────┐║
║  │ Filter: [Alle ▼] [Manuell] [AutoMod]   │ ║
║  │ ─────────────────────────────────────── │ ║
║  │ 🤖 @User123 - TIMEOUT - AutoMod         │ ║
║  │    Grund: Automod: Max strikes (10)     │ ║
║  │    14.10.2025 12:34                     │ ║
║  │ ─────────────────────────────────────── │ ║
║  │ 👤 @User456 - WARN - Admin FireDervil   │ ║
║  │    Grund: Spam in #general              │ ║
║  │    14.10.2025 12:30                     │ ║
║  └─────────────────────────────────────────┘  ║
║                                                ║
╚════════════════════════════════════════════════╝
```

---

## 🏁 Finale Empfehlung

### ✅ **JA, beide Plugins können und SOLLEN parallel laufen!**

**Begründung:**
1. **Unterschiedliche Zwecke:**
   - Moderation = Manuell, Admin-gesteuert, komplex
   - AutoMod = Automatisch, regelbasiert, einfach

2. **Synergieeffekte:**
   - AutoMod reduziert Admin-Workload
   - Moderation bleibt für wichtige Fälle
   - Gemeinsames Logging für Übersicht

3. **Bereits konzipiert:**
   - AutoMod-Code zeigt: Integration war geplant!
   - `addModAction()` Import ist optional/graceful
   - Standalone-Support vorhanden

4. **Best-of-Both-Worlds:**
   - Kleine Server: Nur Moderation (flexibel)
   - Große Server: Beide (automatisch + manuell)
   - Jede Guild entscheidet selbst

**Nächste Schritte:**
1. ✅ AutoMod-Plugin reparieren (MySQL-Migration)
2. ✅ `addModAction()` als exportierte Helper in Moderation
3. ✅ AutoMod Standalone-Fallback verbessern
4. ✅ Dashboard-Integration für beide
5. ✅ Dokumentation für Admins schreiben

---

**Fazit:** Plugin-Koexistenz ist nicht nur möglich, sondern GEWOLLT! 🎉
