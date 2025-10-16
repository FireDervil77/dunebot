# 🚀 Stripe Donations-System - Implementierungs-Anleitung

**Status:** Teilweise implementiert  
**Datum:** 15. Oktober 2025

---

## ✅ Bereits erstellt:

1. ✅ `plugins/superadmin/dashboard/schemas/donations.sql` - Datenbank-Tabellen
2. ✅ `apps/dashboard/.env` - Stripe-Credentials (Platzhalter)
3. ✅ `plugins/core/dashboard/views/guild/donate.ejs` - User-facing Donation-Seite

---

## 📋 Noch zu erstellen:

### 1. Core-Plugin: Stripe Checkout API

**Datei:** `plugins/core/dashboard/routes/api/create-donation.js`

```javascript
/**
 * Core-Plugin API: Stripe Checkout Session erstellen
 * POST /api/core/create-donation
 */
const express = require('express');
const router = express.Router();
const { ServiceManager } = require('dunebot-core');

// Stripe initialisieren (lazy load)
let stripe = null;
function getStripe() {
    if (!stripe) {
        stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    }
    return stripe;
}

router.post('/', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const user = req.session.user;
    
    if (!user) {
        return res.status(401).json({ 
            success: false, 
            message: 'Nicht authentifiziert' 
        });
    }
    
    try {
        const { amount, message, guild_id } = req.body;
        
        // Validierung
        if (!amount || amount < 1) {
            return res.status(400).json({ 
                success: false, 
                message: 'Mindestbetrag: €1' 
            });
        }
        
        const stripeClient = getStripe();
        
        // Stripe Checkout Session erstellen
        const session = await stripeClient.checkout.sessions.create({
            payment_method_types: ['card', 'sepa_debit', 'giropay', 'sofort'],
            line_items: [{
                price_data: {
                    currency: 'eur',
                    product_data: {
                        name: 'DuneBot Unterstützung',
                        description: message || 'Vielen Dank für deine Spende!',
                        images: [`${process.env.DASHBOARD_BASE_URL}/themes/default/assets/images/DuneBot.png`]
                    },
                    unit_amount: Math.round(amount * 100) // Cent
                },
                quantity: 1
            }],
            mode: 'payment',
            success_url: `${process.env.DASHBOARD_BASE_URL}/guild/${guild_id}/plugins/core/donate/success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${process.env.DASHBOARD_BASE_URL}/guild/${guild_id}/plugins/core/donate/cancel`,
            
            // WICHTIG: User-ID als Metadata
            metadata: {
                user_id: user.id,
                username: user.username,
                guild_id: guild_id || null,
                message: message || null
            }
        });
        
        Logger.info(`[Donation] Stripe-Session erstellt: ${session.id} für User ${user.id}`);
        
        res.json({ 
            success: true, 
            sessionId: session.id,
            url: session.url
        });
        
    } catch (error) {
        Logger.error('[Donation] Fehler beim Erstellen der Stripe-Session:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Serverfehler. Bitte versuche es später erneut.' 
        });
    }
});

module.exports = router;
```

**In `plugins/core/dashboard/index.js` registrieren:**

```javascript
// In _setupRoutes() Methode:
const createDonationApi = require('./routes/api/create-donation');
this.apiRouter.use('/create-donation', createDonationApi);
Logger.debug('[Core] create-donation API-Route registriert');

// Success/Cancel Routes (optional)
this.guildRouter.get('/donate/success', async (req, res) => {
    const guildId = res.locals.guildId;
    const sessionId = req.query.session_id;
    
    await themeManager.renderView(res, 'guild/donate-success', {
        title: 'Spende erfolgreich!',
        activeMenu: `/guild/${guildId}/plugins/core/donate`,
        guildId,
        sessionId
    });
});

this.guildRouter.get('/donate/cancel', async (req, res) => {
    const guildId = res.locals.guildId;
    
    await themeManager.renderView(res, 'guild/donate-cancel', {
        title: 'Spende abgebrochen',
        activeMenu: `/guild/${guildId}/plugins/core/donate`,
        guildId
    });
});

// Donation-Seite
this.guildRouter.get('/donate', async (req, res) => {
    const guildId = res.locals.guildId;
    const dbService = ServiceManager.get('dbService');
    const userId = req.session.user?.id;
    
    // User-Badge laden
    let userBadge = null;
    if (userId) {
        const badge = await dbService.query(`
            SELECT * FROM supporter_badges WHERE user_id = ?
        `, [userId]);
        userBadge = badge && badge.length > 0 ? badge[0] : null;
    }
    
    // Statistiken laden
    const stats = await dbService.query(`
        SELECT * FROM donation_stats
    `);
    
    await themeManager.renderView(res, 'guild/donate', {
        title: 'Unterstütze DuneBot',
        activeMenu: `/guild/${guildId}/plugins/core/donate`,
        guildId,
        userBadge,
        donationStats: stats[0] || {}
    });
});
```

---

### 2. SuperAdmin: Stripe Webhook Handler

**Datei:** `plugins/superadmin/dashboard/routes/api/stripe-webhook.js`

```javascript
/**
 * SuperAdmin: Stripe Webhook Handler
 * POST /api/superadmin/webhooks/stripe
 * 
 * WICHTIG: Muss OHNE express.json() Middleware laufen!
 */
const express = require('express');
const router = express.Router();
const { ServiceManager } = require('dunebot-core');

// Stripe initialisieren
let stripe = null;
function getStripe() {
    if (!stripe) {
        stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    }
    return stripe;
}

/**
 * Webhook Endpoint (mit raw body!)
 */
router.post('/', express.raw({ type: 'application/json' }), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const ipcServer = ServiceManager.get('ipcServer');
    const sig = req.headers['stripe-signature'];
    
    let event;
    
    try {
        const stripeClient = getStripe();
        
        // Webhook-Signature verifizieren
        event = stripeClient.webhooks.constructEvent(
            req.body, 
            sig, 
            process.env.STRIPE_WEBHOOK_SECRET
        );
        
        Logger.info(`[Stripe Webhook] Event empfangen: ${event.type}`);
        
    } catch (err) {
        Logger.error('[Stripe Webhook] Signature-Verifizierung fehlgeschlagen:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }
    
    // Event verarbeiten
    try {
        switch (event.type) {
            case 'checkout.session.completed':
                await handleCheckoutCompleted(event.data.object, dbService, ipcServer, Logger);
                break;
                
            case 'checkout.session.expired':
                Logger.warn('[Stripe Webhook] Session abgelaufen:', event.data.object.id);
                break;
                
            default:
                Logger.debug(`[Stripe Webhook] Unbehandelter Event-Type: ${event.type}`);
        }
        
        res.json({ received: true });
        
    } catch (error) {
        Logger.error('[Stripe Webhook] Fehler beim Verarbeiten:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

/**
 * Checkout-Session completed → Donation speichern + Badge vergeben
 */
async function handleCheckoutCompleted(session, dbService, ipcServer, Logger) {
    const userId = session.metadata.user_id;
    const amount = session.amount_total / 100; // Von Cent zu Euro
    const message = session.metadata.message;
    const guildId = session.metadata.guild_id;
    
    Logger.info(`[Stripe Webhook] Payment erfolgreich: €${amount} von User ${userId}`);
    
    // 1. Donation in DB speichern
    await dbService.query(`
        INSERT INTO donations (
            user_id, guild_id, amount, currency, message,
            payment_provider, payment_id, payment_status,
            stripe_customer_id, metadata
        ) VALUES (?, ?, ?, 'EUR', ?, 'stripe', ?, 'completed', ?, ?)
    `, [
        userId, 
        guildId, 
        amount, 
        message, 
        session.id,
        session.customer,
        JSON.stringify(session)
    ]);
    
    // 2. Supporter-Badge aktualisieren
    await updateSupporterBadge(userId, amount, dbService, Logger);
    
    // 3. Discord-Role vergeben via IPC
    const badgeLevel = await getBadgeLevel(userId, dbService);
    
    try {
        await ipcServer.broadcast('dashboard:SET_SUPPORTER_ROLE', {
            userId,
            badgeLevel
        });
        
        Logger.success(`[Stripe Webhook] Discord-Role vergeben: ${badgeLevel} für User ${userId}`);
        
        // Sync-Status speichern
        await dbService.query(`
            UPDATE supporter_badges 
            SET discord_role_synced = 1, last_role_sync = NOW()
            WHERE user_id = ?
        `, [userId]);
        
    } catch (error) {
        Logger.error('[Stripe Webhook] Fehler beim Discord-Role-Sync:', error);
    }
}

/**
 * Supporter-Badge aktualisieren
 */
async function updateSupporterBadge(userId, amount, dbService, Logger) {
    // Prüfe ob Badge bereits existiert
    const existing = await dbService.query(`
        SELECT * FROM supporter_badges WHERE user_id = ?
    `, [userId]);
    
    if (existing && existing.length > 0) {
        // Update
        const newTotal = parseFloat(existing[0].total_donated) + parseFloat(amount);
        const newLevel = calculateBadgeLevel(newTotal);
        
        await dbService.query(`
            UPDATE supporter_badges 
            SET total_donated = ?,
                badge_level = ?,
                donation_count = donation_count + 1,
                last_donation_at = NOW()
            WHERE user_id = ?
        `, [newTotal, newLevel, userId]);
        
        Logger.success(`[Badge] Updated: User ${userId} → ${newLevel} (€${newTotal})`);
        
    } else {
        // Insert
        const level = calculateBadgeLevel(amount);
        
        await dbService.query(`
            INSERT INTO supporter_badges (
                user_id, badge_level, total_donated,
                first_donation_at, last_donation_at, donation_count
            ) VALUES (?, ?, ?, NOW(), NOW(), 1)
        `, [userId, level, amount]);
        
        Logger.success(`[Badge] Created: User ${userId} → ${level} (€${amount})`);
    }
}

/**
 * Badge-Level aus Gesamt-Summe berechnen
 */
function calculateBadgeLevel(totalDonated) {
    if (totalDonated >= 100) return 'platinum';
    if (totalDonated >= 50) return 'gold';
    if (totalDonated >= 20) return 'silver';
    return 'bronze';
}

/**
 * Aktuelles Badge-Level eines Users laden
 */
async function getBadgeLevel(userId, dbService) {
    const badge = await dbService.query(`
        SELECT badge_level FROM supporter_badges WHERE user_id = ?
    `, [userId]);
    
    return badge && badge.length > 0 ? badge[0].badge_level : 'bronze';
}

module.exports = router;
```

**In `plugins/superadmin/dashboard/index.js` registrieren:**

```javascript
// WICHTIG: Stripe-Webhook MUSS VOR express.json() Middleware laufen!
// In _setupRoutes():

// Webhook-Route (raw body!)
const stripeWebhook = require('./routes/api/stripe-webhook');
this.apiRouter.use('/webhooks/stripe', stripeWebhook);
Logger.debug('[SuperAdmin] Stripe-Webhook-Route registriert');
```

---

### 3. package.json erweitern

**In `dunebot_dev/package.json` hinzufügen:**

```json
{
  "dependencies": {
    "stripe": "^14.10.0"
  }
}
```

**Installation:**
```bash
cd /home/firedervil/dunebot_dev
npm install stripe
```

---

### 4. Stripe Dashboard Setup

**Schritte:**

1. **Stripe-Account erstellen:** https://dashboard.stripe.com/register
2. **Test-Modus aktivieren** (Toggle oben rechts)
3. **API-Keys kopieren:**
   - Developers → API Keys
   - Publishable key → in `.env` als `STRIPE_PUBLISHABLE_KEY`
   - Secret key → in `.env` als `STRIPE_SECRET_KEY`
4. **Webhook erstellen:**
   - Developers → Webhooks → Add endpoint
   - URL: `https://dev.firenetworks.de/api/superadmin/webhooks/stripe`
   - Events: `checkout.session.completed`, `checkout.session.expired`
   - Signing secret → in `.env` als `STRIPE_WEBHOOK_SECRET`

---

### 5. SuperAdmin Navigation erweitern

**In `plugins/superadmin/dashboard/index.js` → `onGuildEnable()`:**

```javascript
const navItems = [
    // ... existing items ...
    {
        title: 'superadmin:NAV.DONATIONS',
        path: `/guild/${guildId}/plugins/superadmin/donations`,
        icon: 'fa-solid fa-heart',
        order: 96,
        parent: `/guild/${guildId}/plugins/superadmin`,
        type: 'main',
        visible: true
    }
];
```

---

### 6. Core-Plugin Widget

**In `plugins/core/dashboard/views/widgets/support-dunebot.ejs` erstellen:**

```ejs
<div class="card card-danger">
    <div class="card-header">
        <h3 class="card-title">
            <i class="fas fa-heart me-2"></i>Unterstütze DuneBot
        </h3>
    </div>
    <div class="card-body text-center">
        <p class="mb-3">
            DuneBot ist kostenlos und Open-Source.<br>
            Hilf uns mit einer Spende!
        </p>
        
        <% if (userBadge) { %>
        <div class="alert alert-success mb-3">
            <i class="fas fa-star me-2"></i>
            <strong>Du bist <%= userBadge.badge_level %> Supporter!</strong><br>
            <small>Vielen Dank für €<%= userBadge.total_donated %>! ❤️</small>
        </div>
        <% } %>
        
        <a href="/guild/<%= guildId %>/plugins/core/donate" 
           class="btn btn-success btn-lg btn-block">
            <i class="fas fa-heart me-2"></i>Jetzt spenden
        </a>
        
        <p class="text-muted small mt-3 mb-0">
            <i class="fas fa-users me-1"></i>
            <%= donationStats.total_supporters || 0 %> Supporter | 
            €<%= donationStats.total_amount || 0 %> gespendet
        </p>
    </div>
</div>
```

**Widget registrieren in `plugins/core/dashboard/index.js` → `_registerWidgets()`:**

```javascript
pluginManager.hooks.addFilter('guild_dashboard_widgets', async (widgets, options) => {
    const { guildId, user } = options;
    
    // Donation-Stats laden
    const stats = await dbService.query(`SELECT * FROM donation_stats`);
    
    // User-Badge laden
    let userBadge = null;
    if (user && user.id) {
        const badge = await dbService.query(`
            SELECT * FROM supporter_badges WHERE user_id = ?
        `, [user.id]);
        userBadge = badge && badge.length > 0 ? badge[0] : null;
    }
    
    widgets.push({
        id: 'support-dunebot',
        title: 'Unterstütze DuneBot',
        size: 4,
        icon: 'fa-solid fa-heart',
        cardClass: 'card-danger',
        content: await themeManager.renderWidgetPartial('support-dunebot', {
            donationStats: stats[0] || {},
            userBadge,
            guildId
        })
    });
    
    return widgets;
}, 10);
```

---

## 🧪 Testing

### 1. Datenbank-Tabellen erstellen:
```bash
mysql -u firedervil -p dunebot_dev < plugins/superadmin/dashboard/schemas/donations.sql
```

### 2. Dashboard neustarten:
```bash
pm2 restart dunebot-dashboard-dev
```

### 3. Test-Donation:
1. Im Dashboard zu `/guild/:guildId/plugins/core/donate` navigieren
2. Betrag eingeben (z.B. €5)
3. Auf "Jetzt spenden" klicken
4. Stripe Test-Card nutzen: `4242 4242 4242 4242` (beliebiges Datum/CVC)
5. Zahlung abschließen
6. Webhook sollte Badge vergeben

### 4. Stripe-Logs prüfen:
- Dashboard: `logs/dashboard-*.log`
- Stripe Dashboard: Developers → Webhooks → Test webhook

---

## 📝 Nächste Schritte

1. ✅ SQL-Tabellen erstellen
2. ✅ `.env` mit echten Stripe-Keys befüllen
3. ✅ `npm install stripe`
4. ⏳ Core-Plugin Routen implementieren
5. ⏳ SuperAdmin Webhook implementieren
6. ⏳ Widget registrieren
7. ⏳ Testing mit Test-Card

---

**Geschätzter Aufwand:** 2-3 Stunden für vollständige Implementation

**Bei Fragen:** Siehe https://stripe.com/docs/payments/checkout
