# Ticket Plugin - Analyse & Migrationsplanung

**Erstellt:** 2025-10-13  
**Status:** 📋 Planung  
**Plugin:** Ticket System für DuneBot

---

## 📊 AKTUELLER STATUS - ANALYSE

### 🔍 **Bestandsaufnahme**

#### **Vorhandene Dateien & Struktur**
```
plugins/ticket/
├── index.js                    ✅ Entry Point (Bot + Dashboard)
├── package.json                ✅ Dependencies
├── db_file_old-js              ⚠️  Alte MongoDB Schema-Definition
├── bot/
│   ├── index.js                ✅ BotPlugin-Klasse (Skelett vorhanden)
│   ├── utils.js                ⚠️  Nutzt altes db.service (require)
│   ├── commands/
│   │   ├── ticket.js           ⚠️  Nutzt dbService.getSettings() (ServiceManager)
│   │   └── ticketcat.js        ⚠️  Nutzt dbService.getSettings() (ServiceManager)
│   ├── events/
│   │   ├── interactionCreate.js  ⚠️  Haupt-Handler, nutzt dbService
│   │   └── ipc/                📂 (Nicht geprüft)
│   └── locales/
│       ├── de-DE.json          ✅ Deutsche Übersetzungen vorhanden
│       └── en-GB.json          ✅ Englische Übersetzungen vorhanden
└── dashboard/
    ├── index.js                ⚠️  Plugin-Klasse (Skelett, keine Routes)
    ├── config.json             ✅ Grundconfig (Embed-Farben, Limit)
    ├── models/                 📂 Leer! (Keine MySQL-Schemas)
    ├── routes/
    │   └── router_old.js       ⚠️  Alte Route mit MongoDB db.service
    ├── views/                  📂 (Nicht geprüft)
    └── locales/
        ├── de-DE.json          ✅ Deutsche Übersetzungen vorhanden
        └── en-GB.json          ✅ Englische Übersetzungen vorhanden
```

#### **Kritische Findings**

##### ❌ **MONGODB DEPENDENCIES**
Das Plugin ist **komplett auf MongoDB ausgelegt**:

1. **`db_file_old-js`** - Alte MongoDB Service-Datei:
   - Nutzt `DBService` und `Schema` von `dunebot-sdk`
   - Definiert 2 MongoDB-Schemas:
     * `settings` - Ticket-Konfiguration pro Guild
     * `logs` - Ticket-Logs (Transcripts)
   - Mongoose-spezifische Methoden: `.save()`, `.findOneAndUpdate()`, `.findById().lean()`

2. **`bot/utils.js`** (Zeile 11):
   ```javascript
   const db = require("../db.service");
   ```
   - Direkter Import des nicht-existierenden `db.service.js`
   - **FEHLER**: Datei existiert nicht mehr → Plugin crasht beim Laden!

3. **Bot-Commands & Events**:
   - Nutzen `dbService.getSettings(guild)` (ServiceManager-Pattern)
   - Annahme: `getSettings()` gibt ein MongoDB-Dokument zurück
   - **PROBLEM**: Keine MySQL-Integration vorhanden

4. **Dashboard**:
   - Keine Routes implementiert
   - Keine Models vorhanden (`models/` Ordner leer)
   - Alte Route in `routes/router_old.js` nutzt `db = require("../db.service")`

##### ⚠️  **FUNKTIONALITÄTS-STATUS**

**Bot-Seite:**
- ❌ **NICHT FUNKTIONSFÄHIG** - Import von nicht-existierendem `db.service` führt zu Crash
- Commands registriert, aber DB-Zugriff fehlerhaft
- Events vorhanden, aber Datenbank-Integration fehlt

**Dashboard-Seite:**
- ❌ **NICHT IMPLEMENTIERT** - Keine Routes, keine Views, keine Models
- Nur Skelett-Struktur mit leeren Hooks

**Übersetzungen:**
- ✅ **VOLLSTÄNDIG** - DE/EN für Bot und Dashboard vorhanden

---

## 🎯 FEATURE-ÜBERSICHT

### **Core-Features (aus Code-Analyse)**

#### **1. Ticket-Konfiguration** (`/ticket` Command)
- ✅ **Setup Channel** - Channel für Ticket-Buttons definieren
- ✅ **Log Channel** - Channel für Ticket-Logs (öffnen/schließen)
- ✅ **Limit** - Max. Anzahl gleichzeitiger Tickets
- ✅ **Close** - Ticket manuell schließen
- ✅ **Close All** - Alle Tickets auf einmal schließen
- ✅ **Add/Remove** - User/Rollen zu Ticket hinzufügen/entfernen

#### **2. Ticket-Kategorien** (`/ticketcat` Command)
- ✅ **List** - Alle Kategorien anzeigen
- ✅ **Add** - Neue Kategorie hinzufügen (Name + Beschreibung)
- ✅ **Remove** - Kategorie löschen
- ✅ **Config** - Kategorie konfigurieren:
  * Parent Category (Discord Channel Category)
  * Channel Style (NUMBER, NAME, ID)
  * Staff Roles (wer Support macht)
  * Member Roles (zusätzliche Zugriffsrechte)
  * Open Message (Custom Embed beim Ticket-Öffnen)

#### **3. Ticket-Workflow**
1. **Öffnen**:
   - Button in definiertem Channel → Ticket erstellen
   - Bei mehreren Kategorien: Select-Menu zur Auswahl
   - Channel-Erstellung mit Permissions (Staff Roles, Member Roles)
   - Unique Ticket-ID (8 Zeichen, `short-unique-id`)
   - Custom Open-Message Embed

2. **Nutzen**:
   - Private Text-Channel zwischen User + Staff
   - Add/Remove Members/Roles dynamisch
   - Channel-Topic enthält: `{ticket_id} | {user_id}`

3. **Schließen**:
   - Close Button im Channel
   - Erstellt Transcript (alle Messages)
   - Speichert in DB (Logs-Table)
   - Sendet Log-Embed an Log-Channel
   - Sendet DM an User mit Transcript-Button
   - Löscht Channel

#### **4. Transcript-System**
- Vollständige Message-Historie als JSON
- Enthält: Author, Content, Embeds, Timestamp, Attachments
- Abrufbar über Button (`ticket:TRANSCRIPT-{logId}`)
- Format: MongoDB ObjectId als Log-Referenz

---

## 🗄️ DATENBANK-DESIGN

### **MongoDB Schema (Alt)**

#### **Table: `settings`** (Guild-spezifisch)
```javascript
{
    _id: String,  // Guild ID
    embed_colors: {
        create: String,  // HEX-Color für "Ticket erstellt"
        close: String    // HEX-Color für "Ticket geschlossen"
    },
    log_channel: String,  // Channel-ID für Logs
    limit: Number,        // Max. gleichzeitige Tickets (default: 10)
    categories: [
        {
            name: String,              // Kategorie-Name
            description: String,       // Beschreibung
            parent_id: String,         // Discord Category ID ("auto" = dynamisch)
            channel_style: String,     // "NUMBER", "NAME", "ID"
            staff_roles: [String],     // Role-IDs mit Support-Zugriff
            member_roles: [String],    // Role-IDs mit View-Zugriff
            open_msg: {
                title: String,
                description: String,
                footer: String
            }
        }
    ]
}
```

#### **Table: `logs`** (Ticket-Historie)
```javascript
{
    _id: ObjectId,
    guild_id: String,      // Guild ID
    channel_id: String,    // Ticket-Channel ID
    ticket_id: String,     // Unique Ticket-ID (8 chars)
    category: String,      // Kategorie-Name
    opened_by: String,     // User-ID des Erstellers
    closed_by: String,     // User-ID des Schließers
    reason: String,        // Schließ-Grund
    transcript: [
        {
            author: String,       // Username
            content: String,      // Message-Text
            embeds: [Object],     // Embed-JSON
            timestamp: Date,      // Zeitstempel
            bot: Boolean,         // Ist Bot-Message?
            attachments: [
                {
                    name: String,
                    description: String,
                    url: String
                }
            ]
        }
    ]
}
```

### **MySQL Schema (Neu - Vorschlag)**

#### **Table: `ticket_settings`**
```sql
CREATE TABLE ticket_settings (
    guild_id VARCHAR(20) PRIMARY KEY,
    
    -- Embed Colors
    embed_color_create VARCHAR(7) DEFAULT '#068ADD',
    embed_color_close VARCHAR(7) DEFAULT '#068ADD',
    
    -- Channels
    log_channel VARCHAR(20) DEFAULT NULL,
    
    -- Limits
    ticket_limit INT DEFAULT 10,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_guild (guild_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

#### **Table: `ticket_categories`**
```sql
CREATE TABLE ticket_categories (
    id INT AUTO_INCREMENT PRIMARY KEY,
    guild_id VARCHAR(20) NOT NULL,
    
    -- Category Info
    name VARCHAR(100) NOT NULL,
    description VARCHAR(255) DEFAULT NULL,
    
    -- Discord Integration
    parent_id VARCHAR(20) DEFAULT 'auto',  -- Discord Category ID oder "auto"
    channel_style ENUM('NUMBER', 'NAME', 'ID') DEFAULT 'NUMBER',
    
    -- Permissions (JSON Arrays)
    staff_roles JSON DEFAULT NULL,   -- ["role_id1", "role_id2"]
    member_roles JSON DEFAULT NULL,  -- ["role_id1", "role_id2"]
    
    -- Custom Open Message
    open_msg_title VARCHAR(255) DEFAULT NULL,
    open_msg_description TEXT DEFAULT NULL,
    open_msg_footer VARCHAR(255) DEFAULT NULL,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    UNIQUE KEY unique_guild_category (guild_id, name),
    INDEX idx_guild (guild_id),
    FOREIGN KEY (guild_id) REFERENCES ticket_settings(guild_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

#### **Table: `ticket_logs`**
```sql
CREATE TABLE ticket_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    guild_id VARCHAR(20) NOT NULL,
    channel_id VARCHAR(20) NOT NULL,
    ticket_id VARCHAR(8) NOT NULL,
    
    -- Meta
    category VARCHAR(100) DEFAULT 'Default',
    opened_by VARCHAR(20) NOT NULL,
    closed_by VARCHAR(20) DEFAULT NULL,
    reason TEXT DEFAULT NULL,
    
    -- Transcript (JSON)
    transcript LONGTEXT DEFAULT NULL,  -- JSON Array von Messages
    
    -- Timestamps
    opened_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    closed_at TIMESTAMP DEFAULT NULL,
    
    INDEX idx_guild (guild_id),
    INDEX idx_ticket (ticket_id),
    INDEX idx_channel (channel_id),
    FOREIGN KEY (guild_id) REFERENCES ticket_settings(guild_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

**Transcript JSON Format:**
```json
[
    {
        "author": "Username",
        "content": "Message text",
        "embeds": [{...}],
        "timestamp": "2025-10-13T12:00:00Z",
        "bot": false,
        "attachments": [
            {
                "name": "file.png",
                "description": "Screenshot",
                "url": "https://..."
            }
        ]
    }
]
```

---

## 🔄 MIGRATIONS-STRATEGIE

### **Ähnlich zu AutoMod, aber komplexer:**

#### **Unterschiede zu AutoMod:**
| Aspekt | AutoMod | Ticket |
|--------|---------|--------|
| **Tabellen** | 3 (settings, strikes, logs) | 3 (settings, categories, logs) |
| **Komplexität** | Flat Settings | Nested (Categories) |
| **JSON Fields** | 1 (whitelisted_channels) | 3 (staff_roles, member_roles, transcript) |
| **Relations** | Keine | Categories → Settings (FK) |
| **Commands** | 3 Commands | 2 Commands |
| **Events** | 2 Events | 1 Event (+ IPC) |
| **Dashboard** | Settings-Only | Settings + Category-Manager |

#### **Herausforderungen:**

1. **Nested Subdocuments → Separate Table**
   - MongoDB: `categories` als Array in `settings`
   - MySQL: Eigene `ticket_categories` Tabelle mit FK

2. **Category-Management im Dashboard**
   - CRUD für Kategorien (Liste, Hinzufügen, Bearbeiten, Löschen)
   - Multi-Select für Roles (Staff + Member)
   - Custom Message Editor (Title, Description, Footer)

3. **Transcript-Speicherung**
   - MongoDB: Native Array von Objects
   - MySQL: JSON Column (LONGTEXT für große Transcripts)
   - Parsing-Logic bei Abruf

4. **Channel-Style Enum**
   - MongoDB: String mit Validation
   - MySQL: ENUM('NUMBER', 'NAME', 'ID')

---

## 📋 MIGRATIONSPLAN - PHASEN

### **PHASE 1: Database Layer** ⏱️ Geschätzt: 2-3 Stunden

#### **1.1 MySQL Schemas erstellen**
- [ ] `dashboard/models/ticket_settings.sql`
- [ ] `dashboard/models/ticket_categories.sql`
- [ ] `dashboard/models/ticket_logs.sql`

#### **1.2 Shared Models erstellen**
- [ ] `shared/models/TicketSettings.js`
  - `getSettings(guildId)` → SELECT mit Defaults
  - `createDefaultSettings(guildId)` → INSERT mit config.json Defaults
  - `updateSettings(guildId, updates)` → UPDATE embed_colors, log_channel, ticket_limit
  
- [ ] `shared/models/TicketCategories.js`
  - `getCategories(guildId)` → SELECT alle Kategorien einer Guild
  - `getCategory(guildId, name)` → SELECT eine spezifische Kategorie
  - `addCategory(guildId, categoryData)` → INSERT neue Kategorie
  - `updateCategory(id, updates)` → UPDATE Kategorie
  - `deleteCategory(id)` → DELETE Kategorie
  
- [ ] `shared/models/TicketLogs.js`
  - `addLog(logData)` → INSERT neues Ticket-Log (beim Öffnen)
  - `closeLog(guildId, channelId, ticketId, closedBy, reason, transcript)` → UPDATE Log (beim Schließen)
  - `getLog(id)` → SELECT Log by ID (für Transcript-Button)
  - `getGuildLogs(guildId, limit)` → SELECT letzte X Logs einer Guild
  
- [ ] `shared/models/index.js` → Export aller Models

#### **1.3 config.json erweitern**
```json
{
    "CREATE_EMBED": "#068ADD",
    "CLOSE_EMBED": "#068ADD",
    "DEFAULT_LIMIT": 10,
    "DEFAULT_CATEGORY": {
        "name": "Default",
        "description": "Standard Ticket-Kategorie",
        "parent_id": "auto",
        "channel_style": "NUMBER",
        "staff_roles": [],
        "member_roles": [],
        "open_msg": {
            "title": "Ticket erstellt",
            "description": "Willkommen im Support! Ein Team-Mitglied wird sich gleich um dich kümmern.",
            "footer": "Ticket-System"
        }
    }
}
```

---

### **PHASE 2: Bot Commands Migration** ⏱️ Geschätzt: 3-4 Stunden

#### **2.1 utils.js migrieren**
**Aktuell:**
```javascript
const db = require("../db.service");  // ❌ Datei existiert nicht
```

**Zu ersetzen:**
```javascript
const { TicketSettings, TicketCategories, TicketLogs } = require("../shared/models");
```

**Funktionen zu migrieren:**
- `closeTicket()` (Zeile 80-180):
  * `db.getSettings(guild)` → `TicketSettings.getSettings(guild.id)`
  * `db.closeTicketLog(...)` → `TicketLogs.closeLog(...)`
  
**Kritische Änderungen:**
- MongoDB `ticketLog._id` (ObjectId) → MySQL `ticketLog.id` (INT)
- Button Custom-ID muss angepasst werden: `ticket:TRANSCRIPT-{id}` (INT statt ObjectId)

#### **2.2 ticket.js Command migrieren**
**Zeile 146:** `db.getSettings(guild)` → `TicketSettings.getSettings(guild.id)`

**Subcommands zu prüfen:**
- `setup` → Speichert Channel in `ticket_settings.setup_channel` (NEU!)
- `log` → `updateSettings(guildId, { log_channel })`
- `limit` → `updateSettings(guildId, { ticket_limit })`
- `close` / `closeall` → Nutzen `utils.closeTicket()` (wird in 2.1 migriert)
- `add` / `remove` → Nur Channel-Permissions, keine DB

**WARNUNG:** Command nutzt möglicherweise `settings.setup_channel` - muss in Schema ergänzt werden!

#### **2.3 ticketcat.js Command migrieren**
**Zeile 145:** `db.getSettings(guild)` → `TicketSettings.getSettings(guild.id)`

**Category-Operations:**
- `list` → `TicketCategories.getCategories(guild.id)`
- `add` → `TicketCategories.addCategory(guild.id, { name, description, ...defaults })`
- `remove` → `TicketCategories.deleteCategory(id)` (benötigt Category-ID-Lookup)
- `config` → Komplexer Interactive Flow (Buttons/Modals) → `TicketCategories.updateCategory(id, updates)`

**ACHTUNG:** `config` Subcommand hat komplexe Interaktionen:
- Button-Menü für Settings-Auswahl
- Modals für Textinput
- Select-Menus für Roles
- Muss vollständig durchgetestet werden!

---

### **PHASE 3: Bot Events Migration** ⏱️ Geschätzt: 2-3 Stunden

#### **3.1 interactionCreate.js migrieren**
**Zeile 28:** `dbService.getSettings(guild)` → `TicketSettings.getSettings(guild.id)`

**Critical Flow - Ticket Creation (Zeile 30-200):**
1. **Category Selection:**
   - `settings.categories` → `TicketCategories.getCategories(guild.id)`
   - MongoDB: Categories als Array im Settings-Document
   - MySQL: Separate Query benötigt!

2. **Log Creation:**
   - Bei Ticket-Öffnung: `db.addTicketLog(data)` → `TicketLogs.addLog({ guild_id, channel_id, ticket_id, category, opened_by })`
   - Wichtig: `transcript` ist beim Öffnen noch leer (wird beim Schließen befüllt)

3. **Channel-Topic Format:**
   - Bleibt gleich: `{ticket_id} | {user_id}`
   - Wird in `utils.parseTicketDetails()` geparst

**Andere Interactions:**
- `ticket:CLOSE` Button → Nutzt `utils.closeTicket()`
- `ticket:TRANSCRIPT-{id}` Button → Muss `TicketLogs.getLog(id)` nutzen und Transcript rendern

---

### **PHASE 4: Dashboard Implementation** ⏱️ Geschätzt: 6-8 Stunden

#### **4.1 Routes implementieren (in `index.js`)**

**GET `/settings`** - Ticket-Einstellungen Seite
```javascript
this.guildRouter.get('/settings', async (req, res) => {
    const guildId = res.locals.guildId;
    
    // Settings + Categories laden
    const settings = await TicketSettings.getSettings(guildId);
    const categories = await TicketCategories.getCategories(guildId);
    
    // Channels via IPC
    const guildChannels = await getGuildChannelsViaIPC(guildId);
    
    res.render('plugins/ticket/views/guild/ticket-settings', {
        settings,
        categories,
        guildChannels,
        layout: themeManager.getLayout('guild')
    });
});
```

**PUT `/settings`** - Settings speichern
```javascript
this.guildRouter.put('/settings', async (req, res) => {
    const { log_channel, ticket_limit, embed_color_create, embed_color_close } = req.body;
    
    await TicketSettings.updateSettings(guildId, {
        log_channel,
        ticket_limit: parseInt(ticket_limit),
        embed_color_create,
        embed_color_close
    });
    
    res.json({ success: true, message: 'Einstellungen gespeichert' });
});
```

**POST `/categories`** - Kategorie hinzufügen
```javascript
this.guildRouter.post('/categories', async (req, res) => {
    const { name, description, parent_id, channel_style, staff_roles, member_roles, open_msg } = req.body;
    
    await TicketCategories.addCategory(guildId, {
        name, description, parent_id, channel_style,
        staff_roles: JSON.parse(staff_roles || '[]'),
        member_roles: JSON.parse(member_roles || '[]'),
        open_msg: JSON.parse(open_msg || '{}')
    });
    
    res.json({ success: true, message: 'Kategorie erstellt' });
});
```

**PUT `/categories/:id`** - Kategorie aktualisieren
**DELETE `/categories/:id`** - Kategorie löschen

**GET `/logs`** - Ticket-Logs Seite
```javascript
this.guildRouter.get('/logs', async (req, res) => {
    const logs = await TicketLogs.getGuildLogs(guildId, 50);
    
    res.render('plugins/ticket/views/guild/ticket-logs', {
        logs,
        layout: themeManager.getLayout('guild')
    });
});
```

**GET `/transcript/:id`** - Transcript anzeigen
```javascript
this.guildRouter.get('/transcript/:id', async (req, res) => {
    const log = await TicketLogs.getLog(req.params.id);
    const transcript = JSON.parse(log.transcript || '[]');
    
    res.render('plugins/ticket/views/guild/ticket-transcript', {
        log,
        transcript,
        layout: themeManager.getLayout('guild')
    });
});
```

#### **4.2 Views erstellen**

**Views benötigt:**
- [ ] `views/guild/ticket-settings.ejs` - Main Settings (Log-Channel, Limit, Colors)
- [ ] `views/guild/ticket-categories.ejs` - Category-Manager (Liste + CRUD)
- [ ] `views/guild/ticket-logs.ejs` - Ticket-Historie (Tabelle mit Filtern)
- [ ] `views/guild/ticket-transcript.ejs` - Transcript-Viewer (Einzelnes Ticket)

**Komponenten:**
- **Settings-Form**: guild.js AJAX-Form
- **Category-Liste**: DataTable mit Edit/Delete Buttons
- **Category-Modal**: Bootstrap Modal für Add/Edit
- **Role-Selector**: Multi-Select Dropdown (via IPC)
- **Transcript-Viewer**: Chat-ähnliches Layout (Discord-Style)

#### **4.3 guild.js Handler**
```javascript
case 'ticket-settings':
    await this.handleTicketSettingsResponse(form, result);
    break;

case 'ticket-category-add':
    await this.handleTicketCategoryResponse(form, result);
    break;
```

#### **4.4 Navigation registrieren**
```javascript
const navItems = [
    {
        title: 'ticket:NAV.TICKETS',
        path: `/guild/${guildId}/plugins/ticket`,
        icon: 'fa-solid fa-ticket',
        order: 26,
        parent: `/guild/${guildId}/plugins/core/settings`,
        type: 'main',
        visible: true
    },
    {
        title: 'ticket:NAV.SETTINGS',
        path: `/guild/${guildId}/plugins/ticket/settings`,
        icon: 'fa-solid fa-cog',
        order: 1,
        parent: `/guild/${guildId}/plugins/ticket`,
        type: 'main',
        visible: true
    },
    {
        title: 'ticket:NAV.CATEGORIES',
        path: `/guild/${guildId}/plugins/ticket/categories`,
        icon: 'fa-solid fa-list',
        order: 2,
        parent: `/guild/${guildId}/plugins/ticket`,
        type: 'main',
        visible: true
    },
    {
        title: 'ticket:NAV.LOGS',
        path: `/guild/${guildId}/plugins/ticket/logs`,
        icon: 'fa-solid fa-history',
        order: 3,
        parent: `/guild/${guildId}/plugins/ticket`,
        type: 'main',
        visible: true
    }
];
```

---

### **PHASE 5: Testing & Fixes** ⏱️ Geschätzt: 3-4 Stunden

#### **5.1 Bot-Tests**
- [ ] Plugin lädt ohne Fehler (kein `db.service` Import-Error mehr)
- [ ] `/ticket setup #channel` - Button-Message wird gesendet
- [ ] Button-Click → Ticket öffnet (mit/ohne Kategorien)
- [ ] `/ticketcat add` → Kategorie wird in DB gespeichert
- [ ] `/ticketcat list` → Kategorien werden angezeigt
- [ ] `/ticketcat config` → Interactive Config funktioniert
- [ ] `/ticket close` → Ticket schließt, Transcript wird gespeichert
- [ ] Transcript-Button → Log wird aus DB geladen

#### **5.2 Dashboard-Tests**
- [ ] Plugin aktivieren → Tabellen werden erstellt
- [ ] Guild-Enable → Navigation erscheint
- [ ] Settings-Seite → Formular zeigt aktuelle Werte
- [ ] Settings speichern → Werte werden in DB geschrieben
- [ ] Category hinzufügen → Neue Kategorie in DB
- [ ] Category bearbeiten → Updates werden gespeichert
- [ ] Category löschen → Wird aus DB entfernt
- [ ] Logs-Seite → Zeigt Ticket-Historie
- [ ] Transcript-Seite → Zeigt Chat-Verlauf

#### **5.3 Integration-Tests**
- [ ] Bot → Dashboard: Settings synchron
- [ ] Dashboard-Änderung → Bot nutzt neue Werte sofort
- [ ] Category-Löschung → Bot wirft keine Fehler bei alten Tickets
- [ ] Transcript-Button im Bot → Öffnet Dashboard-Seite (falls implementiert)

---

## ⚠️  KRITISCHE PUNKTE & RISIKEN

### **1. Transcript-Größe**
**Problem:** Große Tickets mit vielen Messages → JSON kann sehr groß werden (100+ KB)

**Lösungen:**
- **Option A:** LONGTEXT Column (max. 4 GB) → Sollte reichen
- **Option B:** Separate `ticket_transcript_messages` Tabelle → Normalisierung
- **Option C:** Transcript-Limit (z.B. letzte 500 Messages)

**Empfehlung:** Option A mit Monitoring

### **2. Category-Deletion mit aktiven Tickets**
**Problem:** Category löschen während Tickets dieser Category offen sind?

**Lösungen:**
- **Soft-Delete:** Flag `deleted` statt echter Löschung
- **Validation:** Check auf offene Tickets vor Löschung
- **Cascade:** Alle Tickets schließen (gefährlich!)

**Empfehlung:** Soft-Delete + Warning im Dashboard

### **3. MongoDB ObjectId → MySQL INT**
**Problem:** Transcript-Button nutzt `_id` (ObjectId) als Custom-ID

**Lösung:** Custom-ID Pattern ändern:
```javascript
// Alt (MongoDB)
`ticket:TRANSCRIPT-${ticketLog._id}`  // ObjectId String (24 chars)

// Neu (MySQL)
`ticket:TRANSCRIPT-${ticketLog.id}`   // INT (max. 10 chars)
```

**Impact:** Alte Buttons aus MongoDB-Zeit funktionieren nicht mehr (Migration benötigt)

### **4. Role-Selection im Dashboard**
**Problem:** Roles müssen für Category-Config auswählbar sein

**Lösung:** IPC-Handler für Guild-Roles:
```javascript
// plugins/core/bot/events/ipc/getGuildRoles.js
module.exports = (payload, client) => {
    const { guildId } = payload;
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return { success: false, roles: [] };
    
    const roles = guild.roles.cache
        .filter(role => role.id !== guild.id)  // @everyone rausfiltern
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

### **5. "auto" Parent Category**
**Problem:** `parent_id: "auto"` bedeutet "Bot erstellt temporäre Category"

**Handling im Bot:**
- Bei Ticket-Öffnung: Prüfen ob `parent_id === "auto"`
- Wenn ja: Neue Discord Category erstellen mit Name "Tickets - {category_name}"
- Category-ID speichern für cleanup
- Bei Ticket-Close: Category löschen wenn leer

**Alternativ:** Fester Parent, kein "auto" (einfacher)

---

## 📝 ZUSÄTZLICHE TODOS

### **Registry-Eintrag**
```json
{
    "name": "ticket",
    "version": "1.0.0",
    "author": "FireBot Team",
    "repository": "local",
    "repositoryPath": "ticket",
    "dependencies": ["core"]
}
```

### **IPC-Handler benötigt**
- [x] `getGuildChannels.js` (bereits für AutoMod erstellt)
- [ ] `getGuildRoles.js` (für Role-Selection)

### **Asset-Registration**
Optional: Dashboard-Assets für Category-Manager (falls Custom JS benötigt)

---

## 🎯 ZUSAMMENFASSUNG

### **Workload-Schätzung**
| Phase | Aufwand | Priorität |
|-------|---------|-----------|
| Phase 1: Database | 2-3h | 🔴 Kritisch |
| Phase 2: Bot Commands | 3-4h | 🔴 Kritisch |
| Phase 3: Bot Events | 2-3h | 🔴 Kritisch |
| Phase 4: Dashboard | 6-8h | 🟡 Hoch |
| Phase 5: Testing | 3-4h | 🟡 Hoch |
| **GESAMT** | **16-22h** | - |

### **Prioritäten**
1. **Phase 1+2+3** ZUERST → Bot funktionsfähig machen (Critical Path)
2. **Phase 4** DANACH → Dashboard als Bonus
3. **Phase 5** PARALLEL → Continuous Testing

### **Risiko-Assessment**
- 🔴 **Hoch:** Category-System (Nested Data → Relational)
- 🟡 **Mittel:** Transcript-Handling (Große JSON-Payloads)
- 🟢 **Niedrig:** Settings-Migration (Ähnlich zu AutoMod)

---

## 🚀 NÄCHSTE SCHRITTE

**Soll ich mit der Umsetzung beginnen?**

Vorgeschlagene Reihenfolge:
1. **Database Layer** (Phase 1) → MySQL Schemas + Models
2. **Bot Critical-Fix** (Phase 2.1) → `utils.js` migrieren (Plugin lädt wieder)
3. **Bot Commands** (Phase 2.2-2.3) → Commands funktionsfähig
4. **Bot Events** (Phase 3) → Ticket-Flow funktioniert
5. **Dashboard** (Phase 4) → UI für Settings + Categories
6. **Testing** (Phase 5) → End-to-End Tests

**Oder möchtest du einzelne Teile priorisieren/anpassen?**

---

**Status-Update nach Analyse:**
- ✅ Code-Struktur analysiert
- ✅ MongoDB-Dependencies identifiziert  
- ✅ Feature-Set dokumentiert
- ✅ MySQL-Schema entworfen
- ✅ Migrationsplan erstellt
- ⏳ Bereit für Umsetzung

**Autor:** GitHub Copilot + FireDervil  
**Letzte Aktualisierung:** 2025-10-13
