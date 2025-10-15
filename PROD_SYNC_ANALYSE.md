# 🔥 PROD SYNC ANALYSE - DEV vs PROD

**Stand:** 15.10.2025
**DEV Status:** 3 neue Commits (f7d927f, 192ad32, 79b2986)
**PROD Status:** 16 uncommitted files, 1 commit behind origin/main

---

## 📊 COMMIT-DIFFERENZ

### DEV hat 4 Commits voraus:
1. `17e83a6` - feat: SuperAdmin Notification-System Migration auf AJAX Toast-System
2. `79b2986` - feat: Major Dashboard Stability & Monitoring Update  
3. `192ad32` - fix: Verhindere Session-Erstellung für anonyme Besucher
4. `f7d927f` - fix: SuperAdmin Stats Widget - Guild-Liste Spalten-Fehler

### PROD hat 0 Commits voraus (nur uncommitted changes)

---

## ⚠️ KONFLIKT-DATEIEN (13 Stück)

### ✅ **IDENTISCHE ÄNDERUNGEN** (können direkt übernommen werden):

1. **apps/dashboard/app.js**
   - SessionManager + BotHealthMonitor Integration
   - API-Route Auth-Fix
   - ✅ PROD = DEV (manuell schon eingepflegt)

2. **apps/dashboard/middlewares/session.middleware.js**
   - Session-Optionen (resave: false, rolling: true)
   - Cookie-Security-Optionen
   - Session-Cleanup deaktiviert (via SessionManager)
   - ✅ PROD = DEV (IDENTISCH!)

3. **apps/dashboard/helpers/sessionManager.js**
   - ✅ PROD = DEV (IDENTISCH!)

4. **plugins/core/bot/events/ipc/bot-health-check.js**
   - ✅ NEU in beiden (via untracked file)

### ⚠️ **MINIMALE UNTERSCHIEDE** (trivial):

5. **apps/dashboard/helpers/botHealthMonitor.js**
   - DEV: Hat 3 zusätzliche Logger.debug()-Zeilen
   - PROD: Weniger Logging
   - 🔧 **Lösung:** DEV-Version übernehmen (mehr Logging ist besser)

### 🔍 **NOCH ZU PRÜFEN**:

6. **apps/dashboard/themes/default/views/guild/plugins.ejs**
   - Plugin Badge System
   - Muss verglichen werden

7. **apps/dashboard/themes/default/assets/css/guild.css**
   - Badge-Styles
   - Muss verglichen werden

8. **plugins/core/dashboard/views/guild/toast-history.ejs**
   - Toast-Verlauf-View
   - Muss verglichen werden

9. **plugins/superadmin/dashboard/index.js**
   - Config-Sync (PROD hat extra Code für DB-Config-Sync)
   - Notification AJAX-Migration
   - Plugin Badge Routes (PROD hat neue Badge-Management-Routes)
   - 🔧 **Lösung:** DEV + PROD-spezifische Features mergen

10. **plugins/core/dashboard/locales/de-DE.json** + **en-GB.json**
    - Neue Übersetzungen für Features
    - Muss verglichen werden

11. **apps/dashboard/locales/en-GB.json**
    - Neue Dashboard-Übersetzungen
    - Muss verglichen werden

---

## 🗑️ GELÖSCHTE DATEIEN (3 Stück)

### ✅ **KÖNNEN SICHER GELÖSCHT WERDEN**:
- `debug_notification_dismiss.js` (Debug-Script)
- `fix_notifications_id.js` (Fix-Script)
- `show_guild_data.js` (Debug-Script)

**Alle 3 sind Einmal-Scripts die in DEV bereits committed und gelöscht wurden.**

---

## 📁 UNTRACKED FILES IN PROD (4 Stück)

### ✅ **BEREITS IN DEV COMMITTED**:
1. `apps/dashboard/helpers/botHealthMonitor.js` ✅
2. `apps/dashboard/helpers/sessionManager.js` ✅
3. `plugins/core/bot/events/ipc/bot-health-check.js` ✅

### ❓ **NUR IN PROD (nicht in DEV)**:
4. **apps/dashboard/themes/firebot/** 
   - ⚠️ LEERES THEME - nur Skelett-Struktur
   - Kein theme.json vorhanden
   - 🔧 **Lösung:** Kann gelöscht oder zu .gitignore hinzugefügt werden

---

## 🚨 KRITISCHE ERKENNTNIS

**PROD wurde offenbar MANUELL mit den gleichen Fixes bearbeitet wie DEV!**

Das bedeutet:
- ✅ Die meisten Änderungen sind **identisch**
- ⚠️ PROD hat **zusätzliche Features** (Config-Sync, Badge-Routes)
- 🔧 Kein echter Merge-Konflikt bei Core-Files
- 🎯 **Nur Plugin-spezifische Unterschiede** müssen gemerged werden

---

## 💡 EMPFOHLENE SYNC-STRATEGIE

### **OPTION A: SMART MERGE (EMPFOHLEN)**

1. **PROD uncommitted changes committen**
   ```bash
   cd /home/firedervil/dunebot_prod
   git add -A
   git commit -m "feat: PROD-spezifische Features (Config-Sync, Badge-Routes, Firebot-Theme-Skelett)"
   ```

2. **DEV Commits nach PROD mergen**
   ```bash
   git pull origin main  # Holt commit 17e83a6
   git cherry-pick 79b2986  # Major Update
   git cherry-pick 192ad32  # Session Fix
   git cherry-pick f7d927f  # SuperAdmin Fix
   ```

3. **Manuelle Merge-Konflikte lösen** (falls vorhanden)
   - Nur bei `plugins/superadmin/dashboard/index.js` erwartet
   - PROD Config-Sync Code + DEV Fixes kombinieren

4. **Testing**
   - Dashboard starten
   - Session-System testen (keine anonymous sessions)
   - SuperAdmin Stats testen
   - Bot Health Monitor testen

### **OPTION B: HARD RESET (RISKANT)**

❌ **NICHT EMPFOHLEN** - PROD hat unique Features die verloren gehen würden!

---

## 📋 TO-DO LISTE

- [ ] PROD uncommitted changes committen
- [ ] DEV Commits nach PROD mergen
- [ ] SuperAdmin Plugin manually mergen (Config-Sync + Badge-Routes behalten)
- [ ] Firebot-Theme evaluieren (löschen oder behalten?)
- [ ] Testing: Session-System
- [ ] Testing: Bot Health Monitor
- [ ] Testing: SuperAdmin Stats
- [ ] PM2 restart dunebot-dashboard-prod

---

## ⏱️ GESCHÄTZTE DAUER
- Commit PROD: **2 Minuten**
- Merge DEV Commits: **5 Minuten**
- Manual Merge SuperAdmin: **10 Minuten**
- Testing: **15 Minuten**
- **TOTAL: ~30 Minuten**

---

## 🔐 SICHERHEIT

**Backups vorhanden:**
- ✅ Git History (kann jederzeit zurück)
- ✅ DEV als Referenz
- ✅ Uncommitted PROD changes werden committed (nicht verloren)

**Risiko:** MINIMAL ⚠️ (da meiste Code identisch ist)
