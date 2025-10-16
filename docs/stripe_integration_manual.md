# Stripe Donations System - Integration Anleitung

## ✅ Erstellte Dateien

### Core Plugin (User-Facing)
- ✅ `/plugins/core/dashboard/views/guild/donate.ejs` - Donation-Seite
- ✅ `/plugins/core/dashboard/views/guild/donate-success.ejs` - Success-Seite
- ✅ `/plugins/core/dashboard/views/guild/donate-cancel.ejs` - Cancel-Seite
- ✅ `/plugins/core/dashboard/routes/api/create-donation.js` - Stripe API
- ✅ `/plugins/core/dashboard/views/widgets/support-dunebot.ejs` - Widget
- ✅ `/plugins/core/bot/events/ipc/dashboard-supporter-role.js` - IPC Handler

### SuperAdmin Plugin (Management)
- ✅ `/plugins/superadmin/dashboard/routes/donations.js` - Management Routes
- ✅ `/plugins/superadmin/dashboard/routes/api/stripe-webhook.js` - Webhook Handler
- ✅ `/plugins/superadmin/dashboard/views/guild/donations.ejs` - Management View
- ✅ `/plugins/superadmin/dashboard/schemas/donations.sql` - DB Schema

### Dokumentation
- ✅ `/docs/stripe_donations_implementation_guide.md`
- ✅ `/docs/donation_system_implementation_plan.md`
- ✅ `/docs/monetization_amortization_strategy.md`

### Konfiguration
- ✅ `/apps/dashboard/.env` - Stripe Keys (Placeholders)

---

## 📝 Manuelle Integration - Core Plugin

### 1. Routes registrieren in `plugins/core/dashboard/index.js`

**In `_setupRoutes()` Methode hinzufügen:**

```javascript
_setupRoutes() {
    // ... existing routes ...
    
    // === DONATION SYSTEM ===
    // Donation-Seite
    this.router.get('/donate', async (req, res) => {
        try {
            const guildId = req.params.guildId;
            
            // User Badge abrufen (falls vorhanden)
            const [badges] = await this.dbService.query(
                'SELECT * FROM supporter_badges WHERE user_id = ? AND is_active = 1',
                [req.user.id]
            );
            
            // Community Stats
            const [stats] = await this.dbService.query(`
                SELECT 
                    SUM(CASE WHEN payment_status = 'completed' THEN amount ELSE 0 END) as total_amount,
                    COUNT(DISTINCT user_id) as supporter_count
                FROM donations
            `);
            
            res.render('guild/donate', {
                guildId,
                userBadge: badges[0] || null,
                communityStats: stats[0] || { total_amount: 0, supporter_count: 0 }
            });
        } catch (error) {
            this.Logger.error('[Core] Error loading donate page:', error);
            res.status(500).render('error', { message: 'Fehler beim Laden der Seite' });
        }
    });
    
    // Success-Seite
    this.router.get('/donate/success', (req, res) => {
        res.render('guild/donate-success', {
            guildId: req.params.guildId,
            sessionId: req.query.session_id
        });
    });
    
    // Cancel-Seite
    this.router.get('/donate/cancel', (req, res) => {
        res.render('guild/donate-cancel', {
            guildId: req.params.guildId
        });
    });
    
    // API Route für Stripe Checkout Session
    this.apiRouter.use('/create-donation', require('./routes/api/create-donation'));
}
```

### 2. Widget registrieren in `plugins/core/dashboard/index.js`

**In `_registerWidgets()` Methode hinzufügen:**

```javascript
_registerWidgets() {
    const hooks = ServiceManager.get('hooks');
    
    hooks.addFilter('guild_dashboard_widgets', 'core', async (widgets, guildId, userId) => {
        try {
            // User Badge abrufen
            const [badges] = await this.dbService.query(
                'SELECT * FROM supporter_badges WHERE user_id = ? AND is_active = 1',
                [userId]
            );
            
            // Community Stats
            const [stats] = await this.dbService.query(`
                SELECT 
                    SUM(CASE WHEN payment_status = 'completed' THEN amount ELSE 0 END) as total_amount,
                    COUNT(DISTINCT user_id) as supporter_count
                FROM donations
            `);
            
            widgets.push({
                id: 'support-dunebot',
                title: 'DuneBot unterstützen',
                template: 'widgets/support-dunebot',
                data: {
                    userBadge: badges[0] || null,
                    communityStats: stats[0] || { total_amount: 0, supporter_count: 0 }
                },
                order: 100
            });
        } catch (error) {
            this.Logger.error('[Core] Error loading support widget:', error);
        }
        
        return widgets;
    });
}
```

### 3. Navigation aktualisieren (optional)

**Falls du einen "Spenden"-Link in der Sidebar haben möchtest, in `onGuildEnable()`:**

```javascript
async onGuildEnable(guildId) {
    // ... existing code ...
    
    const navigationManager = ServiceManager.get('navigationManager');
    
    await navigationManager.registerNavigation(guildId, 'core', {
        title: 'core:NAV.DONATE',
        path: '/plugins/core/donate',
        icon: 'fa-solid fa-heart',
        order: 90
    });
}
```

**Und in `plugins/core/dashboard/locales/de.json`:**

```json
{
    "NAV": {
        "DONATE": "❤️ Spenden"
    }
}
```

---

## 📝 Manuelle Integration - SuperAdmin Plugin

### 1. Routes registrieren in `plugins/superadmin/dashboard/index.js`

**In `_setupRoutes()` Methode hinzufügen:**

```javascript
_setupRoutes() {
    // ... existing routes ...
    
    // === DONATION MANAGEMENT ===
    this.router.use('/donations', require('./routes/donations'));
    
    // WICHTIG: Webhook Route muss express.raw() verwenden!
    // Diese Route NICHT in apiRouter registrieren, sondern direkt im Express-App-Level
    // Siehe nächsten Schritt für Dashboard-App-Integration
}
```

### 2. Webhook-Route in Dashboard-App registrieren

**In `/apps/dashboard/index.js` NACH express.json() Middleware:**

```javascript
// WICHTIG: VOR dem RouterManager.registerPlugins() Call!

// Stripe Webhook benötigt raw body für Signature Verification
app.use('/api/superadmin/webhooks/stripe', 
    express.raw({ type: 'application/json' }), 
    require('../../plugins/superadmin/dashboard/routes/api/stripe-webhook')
);

// Ab hier normale JSON-Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ... rest of setup ...
```

**⚠️ KRITISCH:** Die Webhook-Route muss `express.raw()` verwenden, NICHT `express.json()`!

### 3. Navigation registrieren in `onGuildEnable()`

**In `plugins/superadmin/dashboard/index.js`:**

```javascript
async onGuildEnable(guildId) {
    // ... existing code ...
    
    const navigationManager = ServiceManager.get('navigationManager');
    
    await navigationManager.registerNavigation(guildId, 'superadmin', {
        title: 'superadmin:NAV.DONATIONS',
        path: '/plugins/superadmin/donations',
        icon: 'fa-solid fa-heart',
        order: 96
    });
}
```

**Und in `plugins/superadmin/dashboard/locales/de.json`:**

```json
{
    "NAV": {
        "DONATIONS": "💰 Donations"
    }
}
```

---

## 📝 IPC Handler registrieren - Bot

### In `plugins/core/bot/index.js`

**IPC Handler registrieren in `onEnable()` oder separater Methode:**

```javascript
async onEnable(client) {
    // ... existing code ...
    
    // IPC Handler registrieren
    this._registerIPCHandlers(client);
}

_registerIPCHandlers(client) {
    const ipcServer = ServiceManager.get('ipcServer');
    
    if (!ipcServer) {
        this.Logger.warn('[Core Bot] IPC Server not available');
        return;
    }
    
    // Supporter-Role Handler
    const supporterRoleHandler = require('./events/ipc/dashboard-supporter-role');
    
    ipcServer.on('dashboard:SET_SUPPORTER_ROLE', (data, reply) => {
        supporterRoleHandler.call(client, data, reply);
    });
    
    this.Logger.info('[Core Bot] IPC handlers registered');
}
```

---

## 🗄️ Datenbank initialisieren

### SQL Schema ausführen

```bash
cd /home/firedervil/dunebot_dev

# MySQL einloggen
mysql -u root -p

# Datenbank auswählen
USE dunebot_dev;

# Schema importieren
source plugins/superadmin/dashboard/schemas/donations.sql;

# Prüfen ob Tabellen erstellt wurden
SHOW TABLES LIKE '%donation%';
SHOW TABLES LIKE '%supporter%';

# Struktur prüfen
DESCRIBE donations;
DESCRIBE supporter_badges;

# View prüfen
SELECT * FROM donation_stats;
```

---

## 📦 NPM Package installieren

```bash
cd /home/firedervil/dunebot_dev

# Stripe installieren
npm install stripe

# Version prüfen
npm list stripe
```

---

## 🔑 Stripe Account konfigurieren

### 1. Stripe Dashboard aufrufen
- https://dashboard.stripe.com/register

### 2. Test-Keys abrufen
- Dashboard → Developers → API Keys
- Publishable Key (pk_test_...)
- Secret Key (sk_test_...)

### 3. Webhook erstellen
- Dashboard → Developers → Webhooks
- Add Endpoint
- URL: `https://dev.firenetworks.de/api/superadmin/webhooks/stripe`
- Events auswählen:
  - `checkout.session.completed`
  - `checkout.session.expired`
  - `charge.refunded`
- Webhook Secret (whsec_...) kopieren

### 4. .env aktualisieren

```bash
nano /home/firedervil/dunebot_dev/apps/dashboard/.env
```

```env
# Stripe Test Keys (für dev)
STRIPE_SECRET_KEY=sk_test_DEIN_TEST_SECRET_KEY_HIER
STRIPE_PUBLISHABLE_KEY=pk_test_DEIN_TEST_PUBLISHABLE_KEY_HIER
STRIPE_WEBHOOK_SECRET=whsec_DEIN_WEBHOOK_SECRET_HIER

# Für Production später:
# STRIPE_SECRET_KEY=sk_live_DEIN_LIVE_SECRET_KEY
# STRIPE_PUBLISHABLE_KEY=pk_live_DEIN_LIVE_PUBLISHABLE_KEY
# STRIPE_WEBHOOK_SECRET=whsec_DEIN_LIVE_WEBHOOK_SECRET
```

---

## 🧪 Testing

### 1. Bot & Dashboard neustarten

```bash
cd /home/firedervil/dunebot_dev

# Mit PM2
pm2 restart all

# Oder mit start.sh
npm run dev
```

### 2. Donation-Seite aufrufen

- Dashboard öffnen: https://dev.firenetworks.de
- Guild auswählen
- In Sidebar: "❤️ Spenden" klicken
- Oder direkt: https://dev.firenetworks.de/guild/GUILD_ID/plugins/core/donate

### 3. Test-Zahlung durchführen

**Stripe Test-Karten:**
- Erfolg: `4242 4242 4242 4242`
- Ablehnung: `4000 0000 0000 0002`
- 3D Secure: `4000 0027 6000 3184`

**Daten:**
- CVV: beliebig (z.B. 123)
- Ablaufdatum: beliebig in Zukunft (z.B. 12/25)
- PLZ: beliebig (z.B. 12345)

### 4. Webhook testen

**Stripe Dashboard:**
- Developers → Webhooks → Dein Endpoint
- "Send test webhook"
- Event: `checkout.session.completed`
- Prüfe Logs in Dashboard

### 5. SuperAdmin Donations prüfen

- Control-Guild Dashboard
- In Sidebar: "💰 Donations"
- Sollte Test-Donation anzeigen

### 6. Discord-Role prüfen

- User sollte automatisch Supporter-Role auf allen Servern haben
- Role-Name: "🥉 Bronze Supporter" (bei €5+)
- Farbe: Bronze (#CD7F32)

---

## 🐛 Troubleshooting

### Fehler: "Stripe client not initialized"
- ✅ Prüfe `.env`: STRIPE_SECRET_KEY gesetzt?
- ✅ Dashboard neugestartet?

### Fehler: "Webhook signature verification failed"
- ✅ Prüfe `.env`: STRIPE_WEBHOOK_SECRET korrekt?
- ✅ Route mit `express.raw()` registriert?
- ✅ Webhook-URL in Stripe Dashboard korrekt?

### Discord-Role wird nicht vergeben
- ✅ Bot hat "Manage Roles" Permission?
- ✅ Bot-Role höher als Supporter-Role?
- ✅ IPC Handler registriert in Bot?
- ✅ Prüfe Bot-Logs: `tail -f logs/bot-*.log`

### Donation-Seite zeigt Fehler
- ✅ SQL-Schema ausgeführt?
- ✅ Tabellen `donations` und `supporter_badges` existieren?
- ✅ Route in Core-Plugin registriert?

---

## ✅ Final Checklist

- [ ] NPM: `stripe` installiert
- [ ] SQL: Tabellen erstellt (donations, supporter_badges)
- [ ] .env: Stripe Keys eingetragen (Test-Keys)
- [ ] Core Plugin: Routes registriert (donate, success, cancel, API)
- [ ] Core Plugin: Widget registriert (support-dunebot)
- [ ] Core Plugin: Navigation registriert (optional)
- [ ] SuperAdmin Plugin: Routes registriert (donations management)
- [ ] Dashboard App: Webhook-Route registriert (express.raw!)
- [ ] SuperAdmin Plugin: Navigation registriert
- [ ] Bot: IPC Handler registriert (SET_SUPPORTER_ROLE)
- [ ] Stripe Dashboard: Webhook konfiguriert (3 Events)
- [ ] Test: Donation durchgeführt (Test-Karte 4242...)
- [ ] Test: Badge in DB vorhanden
- [ ] Test: Discord-Role zugewiesen
- [ ] Test: SuperAdmin Dashboard zeigt Donation

---

## 🚀 Go-Live Checklist (für Production)

- [ ] Stripe: Live-Keys generiert
- [ ] .env: Live-Keys eingetragen (sk_live_, pk_live_)
- [ ] Stripe: Live-Webhook erstellt (https://firenetworks.de/api/...)
- [ ] .env: Live-Webhook-Secret eingetragen
- [ ] Legal: Impressum auf Donation-Seite
- [ ] Legal: Datenschutzerklärung Link
- [ ] Legal: Widerrufsbelehrung (falls EU-Recht)
- [ ] Email: Bestätigungsmail-Template erstellen (optional)
- [ ] Monitoring: Alerts für failed donations
- [ ] Backup: DB-Backups für `donations` Tabelle

---

## 📊 Analytics & Monitoring

### Wichtige Queries

**Heutige Donations:**
```sql
SELECT COUNT(*), SUM(amount) 
FROM donations 
WHERE DATE(created_at) = CURDATE() 
    AND payment_status = 'completed';
```

**Monatlicher Umsatz:**
```sql
SELECT DATE_FORMAT(created_at, '%Y-%m') as month, SUM(amount) 
FROM donations 
WHERE payment_status = 'completed' 
GROUP BY month 
ORDER BY month DESC 
LIMIT 12;
```

**Top Spender:**
```sql
SELECT user_id, SUM(amount) as total 
FROM donations 
WHERE payment_status = 'completed' 
GROUP BY user_id 
ORDER BY total DESC 
LIMIT 10;
```

**Badge-Verteilung:**
```sql
SELECT badge_level, COUNT(*) 
FROM supporter_badges 
WHERE is_active = 1 
GROUP BY badge_level;
```

---

## 🎉 Fertig!

Das Donations-System ist jetzt einsatzbereit!

Bei Fragen oder Problemen:
1. Prüfe Logs: `tail -f logs/dashboard-*.log`
2. Prüfe Bot-Logs: `tail -f logs/bot-*.log`
3. Prüfe Stripe Dashboard: Events & Webhooks
4. Prüfe DB: `SELECT * FROM donations ORDER BY id DESC LIMIT 10;`
