# AutoMod Plugin - Moderne Features & Erweiterte Analyse

**Erstellt:** 2025-10-13  
**Basis:** Discord Native AutoMod & Bot AutoMod Best Practices  
**Status:** 📋 Feature-Vergleich & Erweiterungsplanung

---

## 🌟 MODERNE AUTOMOD FEATURES (2025 Standard)

### **Research Basis:**
- Discord Native AutoMod (2022+, in alle Server integriert)
- Dyno Bot AutoMod
- MEE6 AutoMod Features
- Best Practices für Bot-basierte Moderation

---

## 📦 FEATURE-KATEGORIEN

### **1. CONTENT FILTERING** 🔍

#### **Discord Native Features:**
- ✅ **Keyword Filters**
  - Commonly Flagged Words (Insults/Slurs, Sexual Content, Severe Profanity)
  - Custom Keywords (bis zu 1.000 Terms pro Rule)
  - Wildcard Support (`cat*`, `*cat`, `*ana*`)
  - Regex-Pattern (für komplexe Matching)
  
- ✅ **Spam Detection**
  - ML-powered Spam Content Filter
  - Mention Spam (bis zu 50 Mentions Limit)
  - Invite Spam Detection
  
- ✅ **Username/Nickname Filtering**
  - Block Words in Usernames
  - Automatic Nickname Enforcement

#### **Advanced Bot Features:**
- 🔷 **Phishing Link Detection**
  - Known Phishing Domain Database
  - Suspicious URL Pattern Detection
  - Shortened URL Expansion & Check
  
- 🔷 **Malware Protection**
  - Executable File Blocking (.exe, .bat, .scr)
  - Suspicious Archive Detection
  - VirusTotal API Integration
  
- 🔷 **Image Content Filtering**
  - NSFW Image Detection (ML)
  - Explicit Content Scanner
  - Gore/Violence Detection
  
- 🔷 **Emoji Spam**
  - Max Emojis per Message
  - Emoji-Only Messages Blocking
  - Repeated Emoji Detection

---

### **2. ANTI-SPAM MECHANISMS** 🚫

#### **Must-Have:**
- ✅ **Message Spam Detection**
  - Identical Message Repeat (within X seconds)
  - Similar Message Detection (Fuzzy Matching)
  - Character Spam (aaaaaaa...)
  - Empty Character Spam (Zalgo text)
  
- ✅ **Flood Protection**
  - Max Messages per Second (Rate Limiting)
  - Slowmode Auto-Enforcement
  - Burst Detection (10 messages in 5 seconds)
  
- ✅ **Link Spam**
  - Max Links per Message
  - Link Shortener Detection
  - Discord Invite Spam (external servers)

#### **Advanced:**
- 🔷 **Smart Spam Detection**
  - Bayesian Spam Filter
  - Pattern Recognition (copy-pasta)
  - Cross-Channel Spam Detection
  
- 🔷 **Advertisement Detection**
  - Common Promo Patterns ("Free Nitro", "Join our Server")
  - Referral Link Detection
  - Cryptocurrency Scam Patterns

---

### **3. ANTI-RAID PROTECTION** 🛡️

#### **Must-Have:**
- ✅ **Join Spam Detection**
  - X Users joining within Y seconds
  - Verification Level Auto-Escalation
  - Lockdown Mode (disable @everyone permissions)
  
- ✅ **Mass Mention Protection**
  - User Mention Limit (default: 3-5)
  - Role Mention Limit (default: 2-3)
  - @everyone/@here Protection
  
- ✅ **New Account Detection**
  - Account Age Requirement (< 7 days = suspicious)
  - Avatar Requirement (no avatar = bot)
  - Auto-Kick/Ban new accounts in raid

#### **Advanced:**
- 🔷 **Raid Mode**
  - One-Click Lockdown
  - Emergency Verification Boost
  - Auto-Ban Suspicious Patterns
  - Whitelist Trusted Users
  
- 🔷 **Alt Detection**
  - Similar Username Detection
  - IP-Based Detection (with proxy awareness)
  - Behavioral Pattern Matching
  
- 🔷 **Bot Account Filtering**
  - Non-Verified Bot Detection
  - Suspicious Bot-like Behavior
  - Auto-Kick Unverified Bots

---

### **4. BEHAVIORAL MODERATION** 🎯

#### **Must-Have:**
- ✅ **Duplicate Messages**
  - Delete Identical Messages
  - Time Window (within 30s/60s)
  - Cross-Channel Detection
  
- ✅ **Caps Lock Spam**
  - % Threshold (z.B. >70% CAPS)
  - Min Message Length (ignore "OK", "LOL")
  - Warning before Punishment
  
- ✅ **Repeated Characters**
  - Limit (z.B. "hellooooo" = max 3 repeated)
  - Custom Threshold per Guild

#### **Advanced:**
- 🔷 **Sentiment Analysis**
  - Toxic Language Detection
  - Aggression Level Scoring
  - Contextual Analysis (sarcasm vs. genuine insult)
  
- 🔷 **User Behavior Tracking**
  - Warning Accumulation
  - Strike Decay (strikes expire after X days)
  - Habitual Offender Detection
  
- 🔷 **Self-Harm/Suicide Prevention**
  - Keyword Trigger ("I want to die", etc.)
  - Auto-Alert Moderators
  - Resource Link DM to User

---

### **5. ACTIONS & RESPONSES** ⚡

#### **Discord Native Actions:**
- ✅ **Block Message** - Message wird nicht gesendet
- ✅ **Send Alert** - Moderator-Channel Alert
- ✅ **Timeout User** - Temporärer Mute (bis zu 28 Tage)

#### **Advanced Bot Actions:**
- ✅ **Warn System**
  - Accumulated Warnings
  - Warning Threshold Actions
  - Warning Expiry (30 days default)
  
- ✅ **Escalation System**
  - 1st Offense: Delete + Warning
  - 2nd Offense: Timeout 1h
  - 3rd Offense: Timeout 24h
  - 4th Offense: Kick
  - 5th Offense: Ban
  
- 🔷 **Soft Ban**
  - Ban + Immediate Unban
  - Deletes User's Messages (last 7 days)
  - Used for Spam Cleanup
  
- 🔷 **Role Actions**
  - Add "Muted" Role
  - Remove "Member" Role
  - Add "Quarantine" Role
  
- 🔷 **Custom Actions**
  - Execute Custom Webhook
  - Trigger External Script
  - API Call to External Service

---

### **6. WHITELISTING & EXCEPTIONS** ⚪

#### **Must-Have:**
- ✅ **Role Exemptions**
  - Moderator Roles excluded
  - Trusted Member Roles
  - Admin/Owner always exempt
  
- ✅ **Channel Exemptions**
  - Specific Channels ignored
  - Channel Categories excluded
  - Thread Inheritance (threads in exempt channels)
  
- ✅ **User Exemptions**
  - Whitelist specific Users
  - Bot Accounts excluded
  - Webhook Messages ignored

#### **Advanced:**
- 🔷 **Permission-Based Exemptions**
  - "Manage Messages" = Exempt
  - "Manage Server" = Exempt
  - Custom Permission Combinations
  
- 🔷 **Temporary Exemptions**
  - Time-Limited Whitelist
  - Event-Mode (disable AutoMod during events)
  - Context-Aware Exemptions

---

### **7. LOGGING & TRANSPARENCY** 📊

#### **Must-Have:**
- ✅ **Moderation Logs**
  - Action Taken (Delete/Warn/Timeout/Kick/Ban)
  - Reason/Rule Triggered
  - User Info + Message Content
  - Timestamp + Moderator (if manual)
  
- ✅ **Alert System**
  - Dedicated Mod-Channel
  - Color-Coded Severity (Green/Yellow/Red)
  - Jump-to-Message Links
  - User Profile Links
  
- ✅ **Audit Trail**
  - All AutoMod Actions logged
  - Config Changes tracked
  - Rule Modifications logged

#### **Advanced:**
- 🔷 **Statistics Dashboard**
  - Violations per Day/Week/Month
  - Top Triggered Rules
  - User Leaderboard (most violations)
  - Rule Effectiveness Analysis
  
- 🔷 **Export & Reporting**
  - CSV Export (Date Range)
  - PDF Reports
  - API Access for external tools
  
- 🔷 **Appeal System**
  - Users can appeal AutoMod actions
  - Moderator Review Queue
  - False Positive Tracking

---

### **8. CUSTOMIZATION & CONFIGURATION** ⚙️

#### **Must-Have:**
- ✅ **Per-Guild Settings**
  - Each Guild independent
  - Import/Export Config
  - Preset Templates (Strict/Moderate/Relaxed)
  
- ✅ **Custom Messages**
  - DM to User on Violation
  - Public Warning Message
  - Log Message Template
  
- ✅ **Thresholds & Limits**
  - Adjustable Strike Counts
  - Custom Timeouts
  - Configurable Spam Detection Sensitivity

#### **Advanced:**
- 🔷 **Per-Channel Overrides**
  - Different Rules per Channel
  - Stricter Rules in #general
  - Relaxed Rules in #off-topic
  
- 🔷 **Time-Based Rules**
  - Stricter Moderation at Night
  - Relaxed During Events
  - Weekend-Mode
  
- 🔷 **A/B Testing**
  - Test New Rules on Subset
  - Gradual Rollout
  - Performance Comparison

---

### **9. INTEGRATION & AUTOMATION** 🔗

#### **Must-Have:**
- ✅ **Discord Native Integration**
  - Work alongside Discord AutoMod
  - Complement Native Features
  - No Overlap/Conflict
  
- ✅ **Logging Bots Integration**
  - Carl-bot Logs
  - Dyno Logs
  - Unified Logging

#### **Advanced:**
- 🔷 **Third-Party Services**
  - Perspective API (Google Toxicity Detection)
  - Sightengine (Image Moderation)
  - ModerateContent (NSFW Detection)
  
- 🔷 **Webhooks**
  - Send Events to External Systems
  - Slack/MS Teams Alerts
  - Custom Dashboard Integration
  
- 🔷 **Machine Learning**
  - Train Custom Models
  - Guild-Specific Pattern Detection
  - Adaptive Filtering

---

### **10. USER EXPERIENCE & EDUCATION** 📚

#### **Must-Have:**
- ✅ **Clear Feedback**
  - User knows WHY message was deleted
  - Cite Rule Violation
  - Provide Context
  
- ✅ **Rule Reminder**
  - Link to Server Rules
  - Specific Rule Quoted
  - How to Appeal
  
- ✅ **Progressive Discipline**
  - First Violation = Warning
  - Educational Approach
  - Escalate Only if Repeated

#### **Advanced:**
- 🔷 **Educational Bot Responses**
  - Explain WHY Rule Exists
  - Suggest Better Phrasing
  - Community Standards Education
  
- 🔷 **Rehabilitation System**
  - Strikes Expire Over Time
  - Good Behavior Rewards
  - Second Chances
  
- 🔷 **Transparency Reports**
  - Public Stats (anonymized)
  - Community Feedback on Rules
  - Democratic Rule Voting

---

## 🔄 FEATURE-MAPPING: DUNEBOT vs. MODERN STANDARD

| Feature Category | DuneBot Aktuell | Modern Standard | Gap | Priorität |
|------------------|-----------------|-----------------|-----|-----------|
| **Basic Content Filtering** | ✅ Vorhanden | ✅ Standard | 🟢 Gut | - |
| **Keyword System** | ⚠️ Basic | ✅ Wildcard + Regex | 🟡 Medium | 🟡 HIGH |
| **Spam Detection** | ✅ Basic | ✅ Advanced | 🟡 Medium | 🟢 MEDIUM |
| **Mass Mention** | ✅ Vorhanden | ✅ Vorhanden | 🟢 Gut | - |
| **Ghost Ping** | ✅ Unique! | ⚪ Rare | 🟢 Gut | - |
| **Anti-Raid** | ❌ Fehlt | ✅ Must-Have | 🔴 Critical | 🔴 CRITICAL |
| **Link Protection** | ⚠️ Basic | ✅ Advanced | 🟡 Medium | 🟡 HIGH |
| **Phishing Detection** | ❌ Fehlt | ✅ Standard | 🟡 Medium | 🟡 HIGH |
| **Image Moderation** | ❌ Fehlt | 🔷 Advanced | 🔵 Low | 🔵 FUTURE |
| **Escalation System** | ✅ Strike-based | ✅ Standard | 🟢 Gut | - |
| **Whitelisting** | ⚠️ Channel-only | ✅ Role + Channel | 🟡 Medium | 🟢 MEDIUM |
| **Logging** | ✅ Vorhanden | ✅ Standard | 🟢 Gut | - |
| **Statistics** | ❌ Fehlt | ✅ Must-Have | 🟡 Medium | 🟢 MEDIUM |
| **Appeal System** | ❌ Fehlt | 🔷 Advanced | 🔵 Low | 🔵 FUTURE |
| **ML Integration** | ❌ Fehlt | 🔷 Advanced | 🔵 Low | 🔵 FUTURE |

---

## 🎯 EMPFOHLENE FEATURES FÜR DUNEBOT

### **Phase 1: Critical Gaps (SOFORT)**
🔴 **Anti-Raid Protection**  
- Join Spam Detection (X Users in Y seconds)  
- New Account Age Check  
- Lockdown Mode Command  
- Emergency Verification Escalation  
**Zeitaufwand:** 8-10h  

🔴 **Advanced Keyword System**  
- Wildcard Support (`word*`, `*word`, `*word*`)  
- Regex Pattern Support  
- Word Boundary Detection  
- Case-Insensitive Options  
**Zeitaufwand:** 4-6h  

### **Phase 2: High-Priority Enhancements**
🟡 **Link Protection Suite**  
- Phishing Domain Database  
- Shortened URL Expansion  
- Suspicious Pattern Detection  
- Whitelist for Safe Domains  
**Zeitaufwand:** 6-8h  

🟡 **Role-Based Whitelisting**  
- Exempt Roles from Rules  
- Permission-Based Exemptions  
- Temporary Whitelist System  
**Zeitaufwand:** 3-4h  

🟡 **Enhanced Logging**  
- Message Content Preservation  
- User History Tracking  
- Attachment Backup  
**Zeitaufwand:** 4-5h  

### **Phase 3: Nice-to-Have Features**
🟢 **Statistics Dashboard**  
- Violations per Day  
- Top Triggered Rules  
- User Leaderboard  
- Rule Effectiveness  
**Zeitaufwand:** 8-10h  

🟢 **Advanced Spam Detection**  
- Fuzzy String Matching  
- Pattern Recognition  
- ML-based Detection  
**Zeitaufwand:** 12-15h  

🟢 **Per-Channel Overrides**  
- Channel-Specific Rules  
- Different Strictness Levels  
- Category-Based Config  
**Zeitaufwand:** 5-7h  

### **Phase 4: Future Innovations**
🔵 **Image Content Filtering**  
- NSFW Detection API  
- Explicit Content Scanner  
- Violence/Gore Detection  
**Zeitaufwand:** 15-20h (API Integration)  

🔵 **AI-Powered Moderation**  
- Sentiment Analysis  
- Context-Aware Detection  
- Custom Model Training  
**Zeitaufwand:** 30-40h  

🔵 **Appeal System**  
- User Appeal Interface  
- Moderator Review Queue  
- False Positive Tracking  
**Zeitaufwand:** 10-12h  

---

## 📊 DATENBANK-ERWEITERUNGEN

### **Neue Tabellen (für moderne Features)**

```sql
-- Anti-Raid Tracking
CREATE TABLE automod_raid_events (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    guild_id VARCHAR(20) NOT NULL,
    event_type ENUM('JOIN_SPAM', 'MESSAGE_RAID', 'MENTION_RAID') NOT NULL,
    user_count INT UNSIGNED COMMENT 'Anzahl betroffener User',
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ended_at TIMESTAMP NULL,
    actions_taken JSON COMMENT 'Array von Actions (kick, ban, lockdown)',
    status ENUM('ACTIVE', 'RESOLVED', 'FALSE_POSITIVE') DEFAULT 'ACTIVE',
    INDEX idx_guild_status (guild_id, status),
    INDEX idx_started (started_at)
);

-- Link Whitelist
CREATE TABLE automod_link_whitelist (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    guild_id VARCHAR(20) NOT NULL,
    domain VARCHAR(255) NOT NULL,
    added_by VARCHAR(20) NOT NULL,
    reason VARCHAR(500),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_domain (guild_id, domain)
);

-- Phishing Domain Database
CREATE TABLE automod_phishing_domains (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    domain VARCHAR(255) NOT NULL UNIQUE,
    severity ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL') DEFAULT 'MEDIUM',
    reported_count INT UNSIGNED DEFAULT 1,
    first_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    status ENUM('ACTIVE', 'RESOLVED', 'WHITELISTED') DEFAULT 'ACTIVE',
    INDEX idx_domain (domain),
    INDEX idx_severity (severity)
);

-- User Violation History
CREATE TABLE automod_user_history (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    guild_id VARCHAR(20) NOT NULL,
    user_id VARCHAR(20) NOT NULL,
    violation_date DATE NOT NULL,
    violation_count INT UNSIGNED DEFAULT 0,
    last_violation TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user (guild_id, user_id),
    INDEX idx_date (violation_date)
);

-- Whitelist Roles
ALTER TABLE automod_settings ADD COLUMN whitelisted_roles JSON DEFAULT NULL COMMENT 'Array von Role-IDs die ignoriert werden';

-- Wildcard Keywords
ALTER TABLE automod_settings ADD COLUMN keyword_patterns JSON DEFAULT NULL COMMENT 'Array von Regex-Patterns für komplexe Keywords';

-- Anti-Raid Settings
ALTER TABLE automod_settings ADD COLUMN raid_protection_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE automod_settings ADD COLUMN raid_join_threshold TINYINT UNSIGNED DEFAULT 10 COMMENT 'X Users in Y Sekunden';
ALTER TABLE automod_settings ADD COLUMN raid_join_window TINYINT UNSIGNED DEFAULT 10 COMMENT 'Zeitfenster in Sekunden';
ALTER TABLE automod_settings ADD COLUMN raid_action ENUM('LOCKDOWN', 'KICK_NEW', 'BAN_NEW') DEFAULT 'KICK_NEW';
ALTER TABLE automod_settings ADD COLUMN min_account_age SMALLINT UNSIGNED DEFAULT 0 COMMENT 'Min Account Age in Tagen (0 = disabled)';

-- Statistics Aggregation
CREATE TABLE automod_daily_stats (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    guild_id VARCHAR(20) NOT NULL,
    date DATE NOT NULL,
    total_violations INT UNSIGNED DEFAULT 0,
    spam_violations INT UNSIGNED DEFAULT 0,
    link_violations INT UNSIGNED DEFAULT 0,
    keyword_violations INT UNSIGNED DEFAULT 0,
    raid_events INT UNSIGNED DEFAULT 0,
    unique_violators INT UNSIGNED DEFAULT 0,
    UNIQUE KEY unique_stat (guild_id, date)
);
```

---

## 🚀 MIGRATIONS-REIHENFOLGE (AKTUALISIERT)

### **Phase 1: Critical Anti-Raid (6-8h)**
1. ✅ Raid Detection Logic
2. ✅ Join Spam Tracking
3. ✅ Lockdown Mode Command
4. ✅ New Account Age Check
5. ✅ Emergency Actions

### **Phase 2: Advanced Keywords (4-6h)**
1. ✅ Wildcard Parser (`*`, `?`)
2. ✅ Regex Pattern Support
3. ✅ Word Boundary Detection
4. ✅ Case-Insensitive Mode
5. ✅ Dashboard UI für Pattern-Test

### **Phase 3: Link Protection (6-8h)**
1. ✅ Phishing Domain Database
2. ✅ URL Expander (Shortened Links)
3. ✅ Domain Whitelist System
4. ✅ Suspicious Pattern Detection
5. ✅ Dashboard Whitelist Manager

### **Phase 4: Enhanced Whitelisting (3-4h)**
1. ✅ Role-Based Exemptions
2. ✅ Permission-Based Exemptions
3. ✅ Temporary Whitelist
4. ✅ Dashboard UI für Whitelist

### **Phase 5: Statistics & Analytics (8-10h)**
1. ✅ Daily Stats Aggregation
2. ✅ Violation Breakdown Dashboard
3. ✅ User History Tracking
4. ✅ Rule Effectiveness Analysis
5. ✅ Export Functions (CSV)

---

## 📝 FEATURE-KOMPLEXITÄTS-BEWERTUNG

| Feature | Komplexität | Zeitaufwand | Dependencies |
|---------|-------------|-------------|--------------|
| **Anti-Raid Protection** | 🟡 MEDIUM | 8-10h | Event Tracking, Rate Limiting |
| **Wildcard Keywords** | 🟢 LOW | 4-6h | Regex Parser |
| **Link Protection** | 🟡 MEDIUM | 6-8h | URL Parsing, External DB |
| **Role Whitelisting** | 🟢 LOW | 3-4h | Discord Permissions |
| **Statistics Dashboard** | 🟡 MEDIUM | 8-10h | Data Aggregation, Charts |
| **Image Moderation** | 🔴 HIGH | 15-20h | External API, ML Models |
| **AI Sentiment Analysis** | 🔴 VERY HIGH | 30-40h | ML Training, API Integration |

---

## ✅ NÄCHSTE SCHRITTE

### **Kritische Entscheidungen:**

1. **Anti-Raid Priority?**  
   - Ist Server-Sicherheit aktuell ein Problem?  
   - Gab es bereits Raid-Angriffe?  
   - **Empfehlung:** JA - Raids sind 2025 Standard-Bedrohung

2. **Keyword-System Upgrade?**  
   - Brauchen User Wildcard-Support?  
   - Werden komplexe Patterns benötigt?  
   - **Empfehlung:** JA - Erhöht Effektivität drastisch

3. **Link Protection?**  
   - Ist Phishing ein Problem im Server?  
   - Viele Spam-Links?  
   - **Empfehlung:** JA - Standard-Feature 2025

4. **Statistics Dashboard?**  
   - Wollen Mods Performance sehen?  
   - Braucht es Reporting?  
   - **Empfehlung:** MEDIUM - Nice-to-Have, nicht kritisch

---

## 🎯 EMPFOHLENE MIGRATIONS-STRATEGIE

### **Immediate (Diese Woche):**
✅ Anti-Raid Protection (KRITISCH)  
✅ Role-Based Whitelisting (Quick Win)  

### **Short-Term (Nächste 2 Wochen):**
✅ Advanced Keyword System  
✅ Link Protection Suite  

### **Mid-Term (Nächster Monat):**
✅ Statistics Dashboard  
✅ Enhanced Logging  

### **Long-Term (2-3 Monate):**
🔷 Image Moderation  
🔷 Appeal System  
🔷 AI Integration  

---

**Fragen für Planung:**
- Soll Anti-Raid sofort implementiert werden?
- Welche Priorität hat Link-Protection?
- Wird ein Statistics-Dashboard gewünscht?
- Interesse an Image-Moderation (API-Kosten)?
