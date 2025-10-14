# AutoMod UI Redesign - Tab-System Umsetzungsplan

**Erstellt:** 2025-10-13  
**Ziel:** Settings-Seite mit Tabs strukturieren + Priorisierte Feature-Integration  
**Status:** 📋 Planungsphase

---

## 🎯 ZIEL DER ÄNDERUNGEN

### **Problem Aktuell:**
- ✅ Eine lange Seite mit allen Settings
- ⚠️ Unübersichtlich bei vielen Features
- ⚠️ Keine thematische Gruppierung
- ⚠️ Schwer zu navigieren für neue User

### **Ziel:**
- ✅ Tab-basierte Navigation (Bootstrap Tabs)
- ✅ Thematische Gruppierung der Features
- ✅ Übersichtliche Darstellung
- ✅ Erweiterbar für neue Features
- ✅ Mobile-Friendly

---

## 📑 TAB-STRUKTUR (EMPFOHLEN)

### **Tab 1: ⚙️ Grundeinstellungen** (CORE)
**Zweck:** Basis-Konfiguration, die immer benötigt wird

**Inhalte:**
- Log-Channel Auswahl
- Max Strikes
- Action bei Max Strikes (Timeout/Kick/Ban)
- Debug-Modus Toggle
- Strike-Decay (NEU - Optional: Strikes verfallen nach X Tagen)

**Komplexität:** 🟢 Einfach (bereits vorhanden)  
**Priorität:** ✅ BEHALTEN

---

### **Tab 2: 🛡️ Content-Filter** (CORE + NEW)
**Zweck:** Was wird gefiltert/moderiert

**Inhalte:**
- **Anti-Features (Existing):**
  - ✅ Anti Ghost-Ping
  - ✅ Anti Spam
  - ✅ Anti Mass-Mention (mit Threshold)
  - ✅ Anti Attachments
  - ✅ Anti Invites
  - ✅ Anti Links

- **Erweiterte Filter (Phase 2):**
  - 🔷 Keyword System (Wildcard Support)
  - 🔷 Regex Patterns
  - 🔷 Caps Lock Spam (% Threshold)
  - 🔷 Repeated Characters (z.B. "hellooooo")
  - 🔷 Emoji Spam (Max Emojis pro Message)

**Komplexität:** 🟡 Medium (Existing + Neue Features)  
**Priorität:** 🟡 HIGH (Tab-Struktur + Phase 2 Features)

---

### **Tab 3: 🚨 Raid-Schutz** (NEW - CRITICAL)
**Zweck:** Server vor Raids schützen

**Inhalte:**
- **Join Spam Protection:**
  - Enable/Disable Toggle
  - Threshold (X Users in Y Sekunden) - Slider
  - Action bei Raid (Kick New/Ban New/Lockdown)
  
- **New Account Protection:**
  - Min Account Age (Tage) - Slider (0-30 Tage)
  - Action (Kick/Ban/Role Restriction)
  
- **Lockdown Mode:**
  - Manual Lockdown Button (Emergency)
  - Auto-Unlock after X minutes
  
- **Whitelist Trusted Users:**
  - Whitelist für verified Members
  - Bypass für bestimmte Invite-Codes

**Komplexität:** 🔴 High (Komplett neu)  
**Priorität:** 🔴 CRITICAL (Security!)

---

### **Tab 4: 🔗 Link-Schutz** (NEW)
**Zweck:** Schutz vor gefährlichen Links

**Inhalte:**
- **Basic Link Control:**
  - ✅ Anti-Links (existing)
  - ✅ Anti-Invites (existing)
  
- **Advanced Link Protection (Phase 2):**
  - 🔷 Phishing Detection Toggle
  - 🔷 Shortened URL Check (bit.ly, tinyurl, etc.)
  - 🔷 Suspicious Pattern Detection
  
- **Domain Whitelist:**
  - Liste von erlaubten Domains
  - Add/Remove UI
  - Regex-Support für Subdomains

**Komplexität:** 🟡 Medium (Existing + Neue Features)  
**Priorität:** 🟡 HIGH (Phishing ist 2025 Problem)

---

### **Tab 5: 📊 Limits & Schwellenwerte** (CORE)
**Zweck:** Numerische Limits konfigurieren

**Inhalte:**
- **Message Limits (Existing):**
  - ✅ Max Lines
  - ✅ Max User-Mentions
  - ✅ Max Role-Mentions
  
- **Spam Limits (Phase 2):**
  - 🔷 Max Messages per Second (Rate Limit)
  - 🔷 Max Emojis per Message
  - 🔷 Max Links per Message
  - 🔷 Duplicate Message Window (Sekunden)

**Komplexität:** 🟢 Einfach (Mostly existing)  
**Priorität:** 🟢 MEDIUM (Nice-to-Have Erweiterungen)

---

### **Tab 6: 🎯 Whitelisting** (NEW - IMPORTANT)
**Zweck:** Ausnahmen definieren

**Inhalte:**
- **Channel Whitelist (Existing):**
  - ✅ Whitelisted Channels (Multi-Select)
  
- **Role Whitelist (NEW - Phase 1):**
  - 🔷 Whitelisted Roles (Multi-Select)
  - 🔷 Permission-Based Exemptions
  
- **User Whitelist (Phase 2):**
  - 🔷 Specific Users (Autocomplete)
  - 🔷 Temporary Whitelist (Zeit-basiert)

**Komplexität:** 🟡 Medium (UI + Backend)  
**Priorität:** 🟡 HIGH (Häufig angefragtes Feature)

---

### **Tab 7: 📈 Statistiken** (NEW - NICE-TO-HAVE)
**Zweck:** Performance & Analytics

**Inhalte:**
- **Übersicht:**
  - Total Violations (Heute/Woche/Monat)
  - Top Triggered Rules (Chart)
  - Top Violators (Anonymisiert oder mit Permission)
  
- **Charts:**
  - Violations per Day (Line Chart)
  - Rule Breakdown (Pie Chart)
  - Violation Heatmap (Time-based)
  
- **Export:**
  - CSV Download (Date Range)
  - PDF Report

**Komplexität:** 🔴 High (Data Aggregation + Charts)  
**Priorität:** 🟢 MEDIUM (Nice-to-Have, nicht kritisch)

---

## 🎨 UI/UX DESIGN

### **Tab-Navigation (Bootstrap Tabs)**

```html
<!-- Nav Tabs -->
<ul class="nav nav-tabs" id="automodTabs" role="tablist">
  <li class="nav-item" role="presentation">
    <button class="nav-link active" data-bs-toggle="tab" data-bs-target="#tab-basic">
      <i class="fa-solid fa-cog"></i> Grundeinstellungen
    </button>
  </li>
  <li class="nav-item" role="presentation">
    <button class="nav-link" data-bs-toggle="tab" data-bs-target="#tab-content-filter">
      <i class="fa-solid fa-shield-halved"></i> Content-Filter
    </button>
  </li>
  <li class="nav-item" role="presentation">
    <button class="nav-link" data-bs-toggle="tab" data-bs-target="#tab-raid">
      <i class="fa-solid fa-shield-virus"></i> Raid-Schutz
      <span class="badge bg-danger">NEU</span>
    </button>
  </li>
  <li class="nav-item" role="presentation">
    <button class="nav-link" data-bs-toggle="tab" data-bs-target="#tab-links">
      <i class="fa-solid fa-link-slash"></i> Link-Schutz
    </button>
  </li>
  <li class="nav-item" role="presentation">
    <button class="nav-link" data-bs-toggle="tab" data-bs-target="#tab-limits">
      <i class="fa-solid fa-sliders"></i> Limits
    </button>
  </li>
  <li class="nav-item" role="presentation">
    <button class="nav-link" data-bs-toggle="tab" data-bs-target="#tab-whitelist">
      <i class="fa-solid fa-user-check"></i> Whitelisting
    </button>
  </li>
  <li class="nav-item" role="presentation">
    <button class="nav-link" data-bs-toggle="tab" data-bs-target="#tab-stats">
      <i class="fa-solid fa-chart-line"></i> Statistiken
    </button>
  </li>
</ul>

<!-- Tab Content -->
<div class="tab-content mt-4" id="automodTabsContent">
  <!-- Tab 1: Grundeinstellungen -->
  <div class="tab-pane fade show active" id="tab-basic" role="tabpanel">
    <!-- Existing Grundeinstellungen hier -->
  </div>
  
  <!-- Tab 2: Content-Filter -->
  <div class="tab-pane fade" id="tab-content-filter" role="tabpanel">
    <!-- Existing Anti-Features hier -->
  </div>
  
  <!-- Tab 3: Raid-Schutz -->
  <div class="tab-pane fade" id="tab-raid" role="tabpanel">
    <!-- NEU: Raid-Protection Settings -->
  </div>
  
  <!-- ... weitere Tabs ... -->
</div>
```

### **Mobile-Optimierung**
- Tabs werden auf Mobile zu Dropdown
- Responsive Design (Bootstrap Grid)
- Touch-Friendly Controls

---

## 🔧 TECHNISCHE UMSETZUNG

### **Phase 1: Tab-Struktur (SOFORT) - 4-6h**

#### **1.1 View-Refactoring** (2-3h)
**Datei:** `plugins/automod/dashboard/views/guild/automod-settings.ejs`

**Änderungen:**
1. Bootstrap Tab-Struktur hinzufügen
2. Bestehende Sections in Tabs aufteilen:
   - Grundeinstellungen → Tab 1
   - Anti-Features → Tab 2
   - Limits → Tab 5
3. Navigation mit Icons & Badges
4. CSS für Tab-Styling

**Code-Struktur:**
```ejs
<!-- Tutorial Box bleibt oben -->
<div class="row mb-4">...</div>

<!-- Tab Navigation -->
<div class="row">
  <div class="col-12">
    <div class="card">
      <div class="card-body">
        <!-- Nav Tabs -->
        <ul class="nav nav-tabs">...</ul>
        
        <!-- Tab Content -->
        <div class="tab-content">
          <!-- Bestehende Inhalte in Tabs verschieben -->
        </div>
      </div>
    </div>
  </div>
</div>
```

#### **1.2 CSS Anpassungen** (1h)
**Datei:** `plugins/automod/dashboard/public/css/automod.css` (NEU)

```css
/* Tab Styling */
.nav-tabs .nav-link {
  color: #6c757d;
  font-weight: 500;
}

.nav-tabs .nav-link.active {
  color: #5865F2;
  border-bottom-color: #5865F2;
}

.nav-tabs .nav-link i {
  margin-right: 0.5rem;
}

.tab-content {
  padding: 1.5rem 0;
}

/* Badge Styling */
.nav-link .badge {
  font-size: 0.65rem;
  padding: 0.2rem 0.4rem;
  margin-left: 0.5rem;
}

/* Mobile Responsive */
@media (max-width: 768px) {
  .nav-tabs {
    flex-direction: column;
  }
  
  .nav-tabs .nav-link {
    text-align: left;
  }
}
```

#### **1.3 JavaScript für Tab-State** (1h)
**Datei:** Theme-basiertes JS oder Inline

```javascript
// Tab-State im localStorage speichern
document.addEventListener('DOMContentLoaded', function() {
    const tabs = document.querySelectorAll('#automodTabs button[data-bs-toggle="tab"]');
    const lastTab = localStorage.getItem('automod_active_tab');
    
    // Letzten Tab wiederherstellen
    if (lastTab) {
        const tabToActivate = document.querySelector(`button[data-bs-target="${lastTab}"]`);
        if (tabToActivate) {
            new bootstrap.Tab(tabToActivate).show();
        }
    }
    
    // Tab-Wechsel speichern
    tabs.forEach(tab => {
        tab.addEventListener('shown.bs.tab', function(e) {
            localStorage.setItem('automod_active_tab', e.target.getAttribute('data-bs-target'));
        });
    });
});
```

#### **1.4 Backend-Anpassungen** (1-2h)
**Datei:** `plugins/automod/dashboard/index.js`

**KEINE großen Änderungen nötig:**
- ✅ PUT Route bleibt identisch (alle Settings in einem Submit)
- ✅ Validation bleibt gleich
- ⚠️ Optional: Separate Endpoints pro Tab (später)

**Optional - Separate Endpoints (später):**
```javascript
// Pro Tab ein eigener PUT-Endpoint
router.put('/settings/basic', async (req, res) => { ... });
router.put('/settings/content-filter', async (req, res) => { ... });
router.put('/settings/raid-protection', async (req, res) => { ... });
```

---

### **Phase 2: Raid-Schutz Tab (PRIORITY) - 8-10h**

#### **2.1 Datenbank-Schema erweitern** (1h)
**Datei:** `plugins/automod/dashboard/models/automod_settings.sql`

```sql
-- Raid Protection Settings
ALTER TABLE automod_settings 
ADD COLUMN raid_protection_enabled BOOLEAN DEFAULT FALSE COMMENT 'Raid-Schutz aktiviert';

ALTER TABLE automod_settings 
ADD COLUMN raid_join_threshold TINYINT UNSIGNED DEFAULT 10 COMMENT 'X Users in Y Sekunden';

ALTER TABLE automod_settings 
ADD COLUMN raid_join_window TINYINT UNSIGNED DEFAULT 10 COMMENT 'Zeitfenster in Sekunden';

ALTER TABLE automod_settings 
ADD COLUMN raid_action ENUM('KICK_NEW', 'BAN_NEW', 'LOCKDOWN') DEFAULT 'KICK_NEW' COMMENT 'Aktion bei Raid-Detection';

ALTER TABLE automod_settings 
ADD COLUMN min_account_age SMALLINT UNSIGNED DEFAULT 0 COMMENT 'Min Account Age in Tagen (0 = disabled)';

ALTER TABLE automod_settings 
ADD COLUMN account_age_action ENUM('NONE', 'KICK', 'BAN', 'ROLE') DEFAULT 'KICK' COMMENT 'Aktion bei zu jungem Account';
```

#### **2.2 Bot-Logic: Raid Detection** (4-5h)
**Datei:** `plugins/automod/bot/events/guildMemberAdd.js` (NEU)

```javascript
const { Events } = require('discord.js');
const { ServiceManager } = require('dunebot-core');
const AutoModSettings = require('../../shared/models/AutoModSettings');

module.exports = {
    name: Events.GuildMemberAdd,
    
    async execute(member) {
        const settings = await AutoModSettings.getSettings(member.guild.id);
        
        if (!settings.raid_protection_enabled) return;
        
        // 1. Account Age Check
        if (settings.min_account_age > 0) {
            const accountAge = Date.now() - member.user.createdTimestamp;
            const minAge = settings.min_account_age * 24 * 60 * 60 * 1000;
            
            if (accountAge < minAge) {
                await handleNewAccount(member, settings);
                return;
            }
        }
        
        // 2. Join Spam Detection
        const recentJoins = await trackJoinEvent(member.guild.id);
        
        if (recentJoins >= settings.raid_join_threshold) {
            await handleRaidDetected(member.guild, settings);
        }
    }
};
```

#### **2.3 View: Raid-Schutz Tab** (2-3h)
**Datei:** `plugins/automod/dashboard/views/guild/automod-settings.ejs`

```ejs
<!-- Tab 3: Raid-Schutz -->
<div class="tab-pane fade" id="tab-raid" role="tabpanel">
  <h5 class="mb-3">
    <i class="fa-solid fa-shield-virus text-danger"></i>
    Raid-Schutz Einstellungen
  </h5>
  
  <!-- Enable Raid Protection -->
  <div class="mb-4">
    <div class="form-check form-switch">
      <input class="form-check-input" type="checkbox" 
             id="raid_protection_enabled" 
             name="raid_protection_enabled" 
             value="1" 
             <%= settings.raid_protection_enabled ? 'checked' : '' %>>
      <label class="form-check-label fw-bold" for="raid_protection_enabled">
        🛡️ Raid-Schutz aktivieren
      </label>
    </div>
    <small class="text-muted">
      Schützt deinen Server vor Join-Spam und Raid-Angriffen
    </small>
  </div>
  
  <!-- Join Spam Settings -->
  <div class="card mb-4">
    <div class="card-header">
      <h6 class="mb-0">Join-Spam Erkennung</h6>
    </div>
    <div class="card-body">
      <!-- Threshold Slider -->
      <div class="mb-3">
        <label class="form-label">
          Anzahl neuer User: <span id="raid_threshold_value"><%= settings.raid_join_threshold || 10 %></span>
        </label>
        <input type="range" class="form-range" 
               id="raid_join_threshold" 
               name="raid_join_threshold"
               min="5" max="50" step="1"
               value="<%= settings.raid_join_threshold || 10 %>"
               oninput="document.getElementById('raid_threshold_value').textContent = this.value">
      </div>
      
      <!-- Window Slider -->
      <div class="mb-3">
        <label class="form-label">
          Zeitfenster: <span id="raid_window_value"><%= settings.raid_join_window || 10 %></span> Sekunden
        </label>
        <input type="range" class="form-range" 
               id="raid_join_window" 
               name="raid_join_window"
               min="5" max="60" step="5"
               value="<%= settings.raid_join_window || 10 %>"
               oninput="document.getElementById('raid_window_value').textContent = this.value">
      </div>
      
      <!-- Action Selection -->
      <div class="mb-3">
        <label class="form-label fw-bold">Aktion bei Raid-Erkennung</label>
        <select class="form-select" id="raid_action" name="raid_action">
          <option value="KICK_NEW" <%= settings.raid_action === 'KICK_NEW' ? 'selected' : '' %>>
            👢 Neue User kicken
          </option>
          <option value="BAN_NEW" <%= settings.raid_action === 'BAN_NEW' ? 'selected' : '' %>>
            🔨 Neue User bannen
          </option>
          <option value="LOCKDOWN" <%= settings.raid_action === 'LOCKDOWN' ? 'selected' : '' %>>
            🔒 Server-Lockdown (Verification erhöhen)
          </option>
        </select>
      </div>
    </div>
  </div>
  
  <!-- Account Age Check -->
  <div class="card mb-4">
    <div class="card-header">
      <h6 class="mb-0">Neue Account-Erkennung</h6>
    </div>
    <div class="card-body">
      <div class="mb-3">
        <label class="form-label">
          Minimales Account-Alter: <span id="min_age_value"><%= settings.min_account_age || 0 %></span> Tage
        </label>
        <input type="range" class="form-range" 
               id="min_account_age" 
               name="min_account_age"
               min="0" max="30" step="1"
               value="<%= settings.min_account_age || 0 %>"
               oninput="document.getElementById('min_age_value').textContent = this.value">
        <small class="text-muted">0 = Deaktiviert</small>
      </div>
      
      <div class="mb-3">
        <label class="form-label fw-bold">Aktion bei zu jungem Account</label>
        <select class="form-select" id="account_age_action" name="account_age_action">
          <option value="NONE" <%= settings.account_age_action === 'NONE' ? 'selected' : '' %>>
            ⚪ Keine Aktion
          </option>
          <option value="KICK" <%= settings.account_age_action === 'KICK' ? 'selected' : '' %>>
            👢 Kicken
          </option>
          <option value="BAN" <%= settings.account_age_action === 'BAN' ? 'selected' : '' %>>
            🔨 Bannen
          </option>
          <option value="ROLE" <%= settings.account_age_action === 'ROLE' ? 'selected' : '' %>>
            🏷️ "Neu"-Rolle zuweisen
          </option>
        </select>
      </div>
    </div>
  </div>
</div>
```

#### **2.4 Übersetzungen** (1h)
**Dateien:** `plugins/automod/dashboard/locales/de-DE.json` + `en-GB.json`

```json
"RAID_PROTECTION": {
    "TITLE": "Raid-Schutz",
    "ENABLED": {
        "LABEL": "Raid-Schutz aktivieren",
        "HELP": "Schützt deinen Server vor Join-Spam und Raid-Angriffen"
    },
    "JOIN_SPAM": {
        "TITLE": "Join-Spam Erkennung",
        "THRESHOLD": "Anzahl neuer User",
        "WINDOW": "Zeitfenster (Sekunden)",
        "ACTION": "Aktion bei Raid-Erkennung"
    }
}
```

---

### **Phase 3: Whitelisting Tab (HIGH) - 3-4h**

#### **3.1 Datenbank erweitern** (30min)
```sql
ALTER TABLE automod_settings 
ADD COLUMN whitelisted_roles JSON DEFAULT NULL COMMENT 'Array von Role-IDs die ignoriert werden';
```

#### **3.2 Backend: IPC Role Fetch** (1h)
**Datei:** `plugins/core/bot/events/ipc/getGuildRoles.js` (falls noch nicht vorhanden)

```javascript
module.exports = (payload, client) => {
    const { guildId } = payload;
    const guild = client.guilds.cache.get(guildId);
    
    if (!guild) {
        return { success: false, error: 'Guild not found', roles: [] };
    }
    
    const roles = guild.roles.cache
        .filter(role => role.id !== guild.id) // @everyone ausschließen
        .sort((a, b) => b.position - a.position)
        .map(role => ({
            id: role.id,
            name: role.name,
            color: role.hexColor,
            position: role.position
        }));
    
    return { success: true, roles };
};
```

#### **3.3 View: Whitelisting Tab** (1.5-2h)
Multi-Select für Channels + Roles mit Bootstrap Select oder Custom UI

---

## 📅 ZEITPLAN & PRIORISIERUNG

### **Sprint 1: Tab-Basis (DIESE WOCHE) - 4-6h**
✅ **Tag 1-2:** View-Refactoring (Tab-Struktur)  
✅ **Tag 2-3:** CSS & JavaScript  
✅ **Tag 3:** Testing & Bugfixes  

**Ergebnis:** Bestehende Features in Tab-Struktur, bessere UX

---

### **Sprint 2: Raid-Schutz (NÄCHSTE WOCHE) - 8-10h**
🔴 **Tag 1:** Datenbank-Schema + Migration  
🔴 **Tag 2-3:** Bot-Logic (guildMemberAdd Event, Join-Tracking)  
🔴 **Tag 4:** View + Übersetzungen  
🔴 **Tag 5:** Testing + Integration  

**Ergebnis:** Server sind gegen Raids geschützt (SECURITY)

---

### **Sprint 3: Whitelisting (ÜBERNÄCHSTE WOCHE) - 3-4h**
🟡 **Tag 1:** IPC Role Handler + DB  
🟡 **Tag 2:** View (Multi-Select UI)  
🟡 **Tag 3:** Testing  

**Ergebnis:** User können Rollen whitelisten (oft nachgefragtes Feature)

---

### **Sprint 4+: Advanced Features (SPÄTER)**
🟢 Link-Schutz Suite (Phase 4)  
🟢 Statistiken Tab (Phase 5)  
🔵 Image Moderation (Phase 6)  

---

## 🎯 KLARE EMPFEHLUNG

### **SOFORT STARTEN:**
1. ✅ **Tab-Struktur implementieren** (4-6h, hoher Impact)
   - Bessere UX sofort sichtbar
   - Basis für alle weiteren Features
   - Kein Risiko, nur Refactoring

2. 🔴 **Raid-Schutz Tab hinzufügen** (8-10h, CRITICAL)
   - Schließt Security-Gap
   - Modern Standard
   - Schützt alle Server

3. 🟡 **Whitelisting Tab** (3-4h, häufig gewünscht)
   - Quick Win für User Experience
   - Oft nachgefragtes Feature
   - Relativ einfach zu implementieren

### **SPÄTER (nach 3-4 Wochen):**
- Link-Schutz Suite
- Statistiken Dashboard
- Advanced Keyword System

---

## ✅ ZUSAMMENFASSUNG

**Total Aufwand Phase 1-3:** 15-20 Stunden  
**Impact:** 🔴 HOCH (Security + UX)  
**Risiko:** 🟢 NIEDRIG (klare Struktur)  

**Nach dieser Umsetzung hast du:**
- ✅ Moderne Tab-basierte UI
- ✅ Raid-Schutz (Security!)
- ✅ Role-based Whitelisting
- ✅ Saubere Code-Struktur für weitere Features
- ✅ Mobile-Friendly Design

**Möchtest du mit Sprint 1 (Tab-Struktur) beginnen?** 🚀
