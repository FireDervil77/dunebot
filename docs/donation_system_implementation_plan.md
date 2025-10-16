# 🎁 Donation-System Implementierung - Architektur-Plan

**Datum:** 15. Oktober 2025  
**Ziel:** Donation-System mit SuperAdmin-Verwaltung und Core-Plugin-Integration

---

## 🎯 Anforderungen

### SuperAdmin-Plugin (Control-Guild Only)
✅ **Verwaltungs-Features:**
- Donation-Verwaltung (alle Spenden anzeigen)
- Spender-Management (Badges zuweisen, Stats)
- Donation-Statistiken (MRR, Top-Spender, Trends)
- Ko-Fi/Patreon-Webhook-Integration
- Manuelle Donation-Einträge (für Offline-Spenden)

### Core-Plugin (jede Guild)
✅ **User-Features:**
- "Support DuneBot" Button im Dashboard-Widget
- Supporter-Badge (visuell im Dashboard)
- Öffentliche Donation-Stats (Gesamt-Summe, Anzahl Supporter)
- Danke-Nachricht nach Spende

---

## 📊 Datenbank-Schema

### Neue Tabelle: `donations`

```sql
CREATE TABLE donations (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id VARCHAR(20) NOT NULL,              -- Discord-User-ID des Spenders
    guild_id VARCHAR(20),                      -- Guild aus der gespendet wurde (optional)
    amount DECIMAL(10,2) NOT NULL,             -- Spendenbetrag in EUR
    currency VARCHAR(3) DEFAULT 'EUR',         -- Währung (EUR, USD, etc.)
    payment_provider ENUM('kofi', 'patreon', 'paypal', 'manual', 'stripe') NOT NULL,
    payment_id VARCHAR(255),                   -- Externe Payment-ID (Ko-Fi, Patreon, etc.)
    payment_status ENUM('pending', 'completed', 'failed', 'refunded') DEFAULT 'completed',
    message TEXT,                              -- Optionale Nachricht vom Spender
    is_recurring TINYINT(1) DEFAULT 0,         -- 0 = Einmalig, 1 = Monatlich (Patreon)
    recurring_until DATE,                      -- Bis wann läuft die recurring Donation
    anonymous TINYINT(1) DEFAULT 0,            -- Anonyme Spende (Name nicht anzeigen)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_user (user_id),
    INDEX idx_guild (guild_id),
    INDEX idx_status (payment_status),
    INDEX idx_recurring (is_recurring),
    INDEX idx_created (created_at)
);
```

### Neue Tabelle: `supporter_badges`

```sql
CREATE TABLE supporter_badges (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id VARCHAR(20) UNIQUE NOT NULL,       -- Discord-User-ID
    badge_level ENUM('bronze', 'silver', 'gold', 'platinum') DEFAULT 'bronze',
    total_donated DECIMAL(10,2) DEFAULT 0.00,  -- Gesamt-Betrag aller Spenden
    first_donation_at TIMESTAMP,               -- Erste Spende
    last_donation_at TIMESTAMP,                -- Letzte Spende
    donation_count INT DEFAULT 0,              -- Anzahl Spenden
    is_recurring TINYINT(1) DEFAULT 0,         -- Aktiver Patreon-Supporter
    badge_visible TINYINT(1) DEFAULT 1,        -- Badge im Dashboard anzeigen
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_level (badge_level),
    INDEX idx_recurring (is_recurring)
);
```

### Badge-Level-Kriterien

| Badge | Total-Donated | Sichtbarkeit |
|-------|---------------|--------------|
| **Bronze** | €5+ | <span style="color: #CD7F32">★</span> Bronze Supporter |
| **Silver** | €20+ | <span style="color: #C0C0C0">★★</span> Silver Supporter |
| **Gold** | €50+ | <span style="color: #FFD700">★★★</span> Gold Supporter |
| **Platinum** | €100+ | <span style="color: #E5E4E2">★★★★</span> Platinum Supporter |

---

## 🏗️ SuperAdmin-Plugin Erweiterung

### 1. Navigation (Control-Guild Only)

**Neue Navigation-Items in `onGuildEnable()`:**

```javascript
// In plugins/superadmin/dashboard/index.js
async onGuildEnable(guildId) {
    // ... existing navigation ...
    
    const navItems = [
        // ... existing items ...
        {
            title: 'superadmin:NAV.DONATIONS',
            path: `/guild/${guildId}/plugins/superadmin/donations`,
            icon: 'fa-solid fa-heart',
            order: 96,  // Nach Statistics
            parent: `/guild/${guildId}/plugins/superadmin`,
            type: 'main',
            visible: true
        },
        {
            title: 'superadmin:NAV.SUPPORTERS',
            path: `/guild/${guildId}/plugins/superadmin/supporters`,
            icon: 'fa-solid fa-users',
            order: 97,
            parent: `/guild/${guildId}/plugins/superadmin`,
            type: 'main',
            visible: true
        }
    ];
    
    await navigationManager.registerNavigation(this.name, guildId, navItems);
}
```

---

### 2. SuperAdmin Routes

**Neue Datei:** `plugins/superadmin/dashboard/routes/donations.js`

```javascript
/**
 * SuperAdmin - Donation Management Routes
 */
const express = require('express');
const router = express.Router();
const { ServiceManager } = require('dunebot-core');

/**
 * GET /guild/:guildId/plugins/superadmin/donations
 * Übersicht aller Donations
 */
router.get('/', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const themeManager = ServiceManager.get('themeManager');
    const dbService = ServiceManager.get('dbService');
    const guildId = res.locals.guildId;
    
    try {
        // Alle Donations laden (neueste zuerst)
        const donations = await dbService.query(`
            SELECT 
                d.*,
                u.username,
                u.discriminator,
                u.avatar,
                g.guild_name
            FROM donations d
            LEFT JOIN users u ON d.user_id = u.user_id
            LEFT JOIN guilds g ON d.guild_id = g._id
            ORDER BY d.created_at DESC
            LIMIT 100
        `);
        
        // Statistiken berechnen
        const stats = await dbService.query(`
            SELECT 
                COUNT(*) as total_donations,
                SUM(amount) as total_amount,
                SUM(CASE WHEN is_recurring = 1 THEN amount ELSE 0 END) as recurring_amount,
                COUNT(DISTINCT user_id) as unique_supporters
            FROM donations
            WHERE payment_status = 'completed'
        `);
        
        // Top-Spender
        const topDonors = await dbService.query(`
            SELECT 
                u.user_id,
                u.username,
                u.discriminator,
                u.avatar,
                COUNT(*) as donation_count,
                SUM(d.amount) as total_donated
            FROM donations d
            JOIN users u ON d.user_id = u.user_id
            WHERE d.payment_status = 'completed'
            GROUP BY d.user_id
            ORDER BY total_donated DESC
            LIMIT 10
        `);
        
        await themeManager.renderView(res, 'guild/donations', {
            title: 'Donation Management',
            activeMenu: `/guild/${guildId}/plugins/superadmin/donations`,
            guildId,
            donations: donations || [],
            stats: stats[0] || {},
            topDonors: topDonors || [],
            plugin: res.locals.plugin
        });
        
    } catch (error) {
        Logger.error('[SuperAdmin] Fehler beim Laden der Donations:', error);
        res.status(500).render('error', { 
            message: 'Fehler beim Laden der Donations', 
            error 
        });
    }
});

/**
 * POST /guild/:guildId/plugins/superadmin/donations/create
 * Manuelle Donation erstellen
 */
router.post('/create', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    
    try {
        const { user_id, amount, currency, message, is_recurring } = req.body;
        
        // Validierung
        if (!user_id || !amount) {
            return res.status(400).json({ 
                success: false, 
                message: 'User-ID und Betrag erforderlich' 
            });
        }
        
        if (amount <= 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'Betrag muss größer als 0 sein' 
            });
        }
        
        // Donation erstellen
        await dbService.query(`
            INSERT INTO donations (
                user_id, amount, currency, message, 
                payment_provider, payment_status, is_recurring
            ) VALUES (?, ?, ?, ?, 'manual', 'completed', ?)
        `, [user_id, amount, currency || 'EUR', message || null, is_recurring ? 1 : 0]);
        
        // Badge aktualisieren
        await updateSupporterBadge(user_id, amount);
        
        Logger.success(`[Donations] Manuelle Donation erstellt: ${amount} ${currency} von User ${user_id}`);
        
        res.json({ 
            success: true, 
            message: `Donation von €${amount} erfolgreich erfasst` 
        });
        
    } catch (error) {
        Logger.error('[SuperAdmin] Fehler beim Erstellen der Donation:', error);
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
});

/**
 * DELETE /guild/:guildId/plugins/superadmin/donations/:donationId
 * Donation löschen (z.B. bei Refund)
 */
router.delete('/:donationId', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const donationId = req.params.donationId;
    
    try {
        // Donation laden
        const donation = await dbService.query(`
            SELECT * FROM donations WHERE id = ?
        `, [donationId]);
        
        if (!donation || donation.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Donation nicht gefunden' 
            });
        }
        
        // Löschen
        await dbService.query(`DELETE FROM donations WHERE id = ?`, [donationId]);
        
        // Badge neu berechnen
        await recalculateSupporterBadge(donation[0].user_id);
        
        Logger.success(`[Donations] Donation ${donationId} gelöscht`);
        
        res.json({ 
            success: true, 
            message: 'Donation erfolgreich entfernt' 
        });
        
    } catch (error) {
        Logger.error('[SuperAdmin] Fehler beim Löschen der Donation:', error);
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
});

/**
 * Supporter-Badge aktualisieren nach Donation
 */
async function updateSupporterBadge(userId, amount) {
    const dbService = ServiceManager.get('dbService');
    
    // Prüfe ob Badge bereits existiert
    const existing = await dbService.query(`
        SELECT * FROM supporter_badges WHERE user_id = ?
    `, [userId]);
    
    if (existing && existing.length > 0) {
        // Update bestehenden Badge
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
        
    } else {
        // Neuen Badge erstellen
        const level = calculateBadgeLevel(amount);
        
        await dbService.query(`
            INSERT INTO supporter_badges (
                user_id, badge_level, total_donated, 
                first_donation_at, last_donation_at, donation_count
            ) VALUES (?, ?, ?, NOW(), NOW(), 1)
        `, [userId, level, amount]);
    }
}

/**
 * Badge-Level neu berechnen
 */
async function recalculateSupporterBadge(userId) {
    const dbService = ServiceManager.get('dbService');
    
    // Gesamtsumme aller completed Donations
    const result = await dbService.query(`
        SELECT 
            SUM(amount) as total_donated,
            COUNT(*) as donation_count
        FROM donations
        WHERE user_id = ? AND payment_status = 'completed'
    `, [userId]);
    
    const totalDonated = result[0]?.total_donated || 0;
    const donationCount = result[0]?.donation_count || 0;
    
    if (totalDonated === 0) {
        // Keine Donations mehr -> Badge löschen
        await dbService.query(`DELETE FROM supporter_badges WHERE user_id = ?`, [userId]);
    } else {
        // Badge aktualisieren
        const level = calculateBadgeLevel(totalDonated);
        
        await dbService.query(`
            UPDATE supporter_badges 
            SET total_donated = ?,
                badge_level = ?,
                donation_count = ?
            WHERE user_id = ?
        `, [totalDonated, level, donationCount, userId]);
    }
}

/**
 * Badge-Level aus Gesamtsumme berechnen
 */
function calculateBadgeLevel(totalDonated) {
    if (totalDonated >= 100) return 'platinum';
    if (totalDonated >= 50) return 'gold';
    if (totalDonated >= 20) return 'silver';
    return 'bronze';
}

module.exports = router;
```

---

### 3. SuperAdmin View

**Neue Datei:** `plugins/superadmin/dashboard/views/guild/donations.ejs`

```ejs
<div class="content-header">
    <div class="container-fluid">
        <div class="row mb-2">
            <div class="col-sm-6">
                <h1 class="m-0"><i class="fas fa-heart text-danger me-2"></i>Donation Management</h1>
            </div>
            <div class="col-sm-6">
                <ol class="breadcrumb float-sm-right">
                    <li class="breadcrumb-item"><a href="/guild/<%= guildId %>">Dashboard</a></li>
                    <li class="breadcrumb-item"><a href="/guild/<%= guildId %>/plugins/superadmin">SuperAdmin</a></li>
                    <li class="breadcrumb-item active">Donations</li>
                </ol>
            </div>
        </div>
    </div>
</div>

<section class="content">
    <div class="container-fluid">
        
        <!-- Statistiken -->
        <div class="row">
            <div class="col-md-3 col-sm-6 col-12">
                <div class="info-box bg-gradient-success">
                    <span class="info-box-icon"><i class="fas fa-euro-sign"></i></span>
                    <div class="info-box-content">
                        <span class="info-box-text">Gesamt Donations</span>
                        <span class="info-box-number">€<%= stats.total_amount ? stats.total_amount.toFixed(2) : '0.00' %></span>
                    </div>
                </div>
            </div>
            
            <div class="col-md-3 col-sm-6 col-12">
                <div class="info-box bg-gradient-info">
                    <span class="info-box-icon"><i class="fas fa-sync"></i></span>
                    <div class="info-box-content">
                        <span class="info-box-text">Monatlich (MRR)</span>
                        <span class="info-box-number">€<%= stats.recurring_amount ? stats.recurring_amount.toFixed(2) : '0.00' %></span>
                    </div>
                </div>
            </div>
            
            <div class="col-md-3 col-sm-6 col-12">
                <div class="info-box bg-gradient-warning">
                    <span class="info-box-icon"><i class="fas fa-gift"></i></span>
                    <div class="info-box-content">
                        <span class="info-box-text">Total Spenden</span>
                        <span class="info-box-number"><%= stats.total_donations || 0 %></span>
                    </div>
                </div>
            </div>
            
            <div class="col-md-3 col-sm-6 col-12">
                <div class="info-box bg-gradient-primary">
                    <span class="info-box-icon"><i class="fas fa-users"></i></span>
                    <div class="info-box-content">
                        <span class="info-box-text">Unique Supporter</span>
                        <span class="info-box-number"><%= stats.unique_supporters || 0 %></span>
                    </div>
                </div>
            </div>
        </div>
        
        <!-- Top Spender -->
        <div class="row">
            <div class="col-md-4">
                <div class="card">
                    <div class="card-header">
                        <h3 class="card-title"><i class="fas fa-trophy me-2"></i>Top Spender</h3>
                    </div>
                    <div class="card-body p-0">
                        <ul class="list-group list-group-flush">
                            <% topDonors.forEach((donor, index) => { %>
                            <li class="list-group-item d-flex justify-content-between align-items-center">
                                <div class="d-flex align-items-center">
                                    <% if (index === 0) { %>
                                        <span class="badge bg-warning me-2">🥇</span>
                                    <% } else if (index === 1) { %>
                                        <span class="badge bg-secondary me-2">🥈</span>
                                    <% } else if (index === 2) { %>
                                        <span class="badge bg-info me-2">🥉</span>
                                    <% } else { %>
                                        <span class="badge bg-light text-dark me-2"><%= index + 1 %></span>
                                    <% } %>
                                    
                                    <img src="https://cdn.discordapp.com/avatars/<%= donor.user_id %>/<%= donor.avatar %>.png" 
                                         class="rounded-circle me-2" 
                                         width="32" height="32"
                                         onerror="this.src='/themes/default/assets/images/default-avatar.png'">
                                    
                                    <div>
                                        <strong><%= donor.username %>#<%= donor.discriminator %></strong>
                                        <br>
                                        <small class="text-muted"><%= donor.donation_count %> Spende(n)</small>
                                    </div>
                                </div>
                                <span class="badge bg-success">€<%= donor.total_donated.toFixed(2) %></span>
                            </li>
                            <% }); %>
                        </ul>
                    </div>
                </div>
            </div>
            
            <!-- Manuelle Donation erstellen -->
            <div class="col-md-8">
                <div class="card">
                    <div class="card-header">
                        <h3 class="card-title"><i class="fas fa-plus me-2"></i>Manuelle Donation erfassen</h3>
                    </div>
                    <div class="card-body">
                        <form class="guild-ajax-form" 
                              data-form-type="create-donation" 
                              data-method="POST"
                              action="/guild/<%= guildId %>/plugins/superadmin/donations/create"
                              method="POST">
                            
                            <div class="row">
                                <div class="col-md-6">
                                    <div class="form-group">
                                        <label>Discord User-ID *</label>
                                        <input type="text" 
                                               name="user_id" 
                                               class="form-control" 
                                               placeholder="123456789012345678"
                                               required>
                                        <small class="form-text text-muted">
                                            Discord-User-ID des Spenders (18-stellig)
                                        </small>
                                    </div>
                                </div>
                                
                                <div class="col-md-3">
                                    <div class="form-group">
                                        <label>Betrag *</label>
                                        <div class="input-group">
                                            <input type="number" 
                                                   name="amount" 
                                                   class="form-control" 
                                                   min="0.01" 
                                                   step="0.01"
                                                   placeholder="5.00"
                                                   required>
                                            <span class="input-group-text">€</span>
                                        </div>
                                    </div>
                                </div>
                                
                                <div class="col-md-3">
                                    <div class="form-group">
                                        <label>Währung</label>
                                        <select name="currency" class="form-control">
                                            <option value="EUR" selected>EUR</option>
                                            <option value="USD">USD</option>
                                            <option value="GBP">GBP</option>
                                        </select>
                                    </div>
                                </div>
                            </div>
                            
                            <div class="form-group">
                                <label>Nachricht (optional)</label>
                                <textarea name="message" 
                                          class="form-control" 
                                          rows="2"
                                          placeholder="Optionale Nachricht oder Notiz zur Spende"></textarea>
                            </div>
                            
                            <div class="form-check mb-3">
                                <input type="checkbox" 
                                       name="is_recurring" 
                                       value="1" 
                                       class="form-check-input" 
                                       id="is_recurring">
                                <label class="form-check-label" for="is_recurring">
                                    Monatliche Spende (Patreon)
                                </label>
                            </div>
                            
                            <button type="submit" class="btn btn-success">
                                <i class="fas fa-save me-2"></i>Donation erfassen
                            </button>
                        </form>
                    </div>
                </div>
            </div>
        </div>
        
        <!-- Donation-Liste -->
        <div class="card mt-3">
            <div class="card-header">
                <h3 class="card-title"><i class="fas fa-list me-2"></i>Alle Donations (letzte 100)</h3>
            </div>
            <div class="card-body table-responsive p-0">
                <table class="table table-hover">
                    <thead>
                        <tr>
                            <th>ID</th>
                            <th>Spender</th>
                            <th>Betrag</th>
                            <th>Provider</th>
                            <th>Status</th>
                            <th>Typ</th>
                            <th>Datum</th>
                            <th>Aktionen</th>
                        </tr>
                    </thead>
                    <tbody>
                        <% donations.forEach(donation => { %>
                        <tr>
                            <td>#<%= donation.id %></td>
                            <td>
                                <div class="d-flex align-items-center">
                                    <img src="https://cdn.discordapp.com/avatars/<%= donation.user_id %>/<%= donation.avatar %>.png" 
                                         class="rounded-circle me-2" 
                                         width="24" height="24"
                                         onerror="this.src='/themes/default/assets/images/default-avatar.png'">
                                    <small><%= donation.username %>#<%= donation.discriminator %></small>
                                </div>
                            </td>
                            <td><strong>€<%= donation.amount.toFixed(2) %></strong></td>
                            <td>
                                <% if (donation.payment_provider === 'kofi') { %>
                                    <span class="badge bg-info">Ko-Fi</span>
                                <% } else if (donation.payment_provider === 'patreon') { %>
                                    <span class="badge bg-danger">Patreon</span>
                                <% } else if (donation.payment_provider === 'manual') { %>
                                    <span class="badge bg-secondary">Manual</span>
                                <% } else { %>
                                    <span class="badge bg-primary"><%= donation.payment_provider %></span>
                                <% } %>
                            </td>
                            <td>
                                <% if (donation.payment_status === 'completed') { %>
                                    <span class="badge bg-success">Completed</span>
                                <% } else if (donation.payment_status === 'pending') { %>
                                    <span class="badge bg-warning">Pending</span>
                                <% } else if (donation.payment_status === 'failed') { %>
                                    <span class="badge bg-danger">Failed</span>
                                <% } else { %>
                                    <span class="badge bg-secondary"><%= donation.payment_status %></span>
                                <% } %>
                            </td>
                            <td>
                                <% if (donation.is_recurring) { %>
                                    <span class="badge bg-success"><i class="fas fa-sync me-1"></i>Monatlich</span>
                                <% } else { %>
                                    <span class="badge bg-light text-dark">Einmalig</span>
                                <% } %>
                            </td>
                            <td>
                                <small><%= new Date(donation.created_at).toLocaleDateString('de-DE') %></small>
                            </td>
                            <td>
                                <button class="btn btn-sm btn-danger" 
                                        onclick="deleteDonation(<%= donation.id %>)">
                                    <i class="fas fa-trash"></i>
                                </button>
                            </td>
                        </tr>
                        <% }); %>
                    </tbody>
                </table>
            </div>
        </div>
        
    </div>
</section>

<script>
function deleteDonation(donationId) {
    if (!confirm('Donation wirklich löschen? (Badge wird neu berechnet)')) return;
    
    fetch(`/guild/<%= guildId %>/plugins/superadmin/donations/${donationId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' }
    })
    .then(res => res.json())
    .then(result => {
        if (result.success) {
            showToast('success', result.message);
            setTimeout(() => window.location.reload(), 1500);
        } else {
            showToast('error', result.message);
        }
    })
    .catch(err => {
        showToast('error', 'Fehler beim Löschen');
        console.error(err);
    });
}
</script>
```

---

## 🔧 Core-Plugin Erweiterung

### 1. Widget für Support-Button

**Neue Datei:** `plugins/core/dashboard/views/widgets/support-dunebot.ejs`

```ejs
<!-- Support DuneBot Widget -->
<div class="card card-primary card-outline">
    <div class="card-header">
        <h3 class="card-title">
            <i class="fas fa-heart text-danger me-2"></i>Unterstütze DuneBot
        </h3>
    </div>
    <div class="card-body text-center">
        <p class="mb-3">
            DuneBot ist kostenlos und Open-Source.<br>
            Hilf uns, das Projekt weiter zu entwickeln!
        </p>
        
        <!-- Statistiken -->
        <div class="row mb-3">
            <div class="col-6">
                <div class="small-box bg-success">
                    <div class="inner">
                        <h3>€<%= donationStats.totalAmount || 0 %></h3>
                        <p>Gesamt gespendet</p>
                    </div>
                    <div class="icon">
                        <i class="fas fa-euro-sign"></i>
                    </div>
                </div>
            </div>
            <div class="col-6">
                <div class="small-box bg-info">
                    <div class="inner">
                        <h3><%= donationStats.supporterCount || 0 %></h3>
                        <p>Supporter</p>
                    </div>
                    <div class="icon">
                        <i class="fas fa-users"></i>
                    </div>
                </div>
            </div>
        </div>
        
        <!-- Supporter Badge (falls vorhanden) -->
        <% if (userBadge) { %>
        <div class="alert alert-success mb-3">
            <i class="fas fa-star me-2"></i>
            <strong>Du bist <%= userBadge.badge_level %> Supporter!</strong><br>
            <small>Vielen Dank für deine Unterstützung! ❤️</small>
        </div>
        <% } %>
        
        <!-- Donation-Buttons -->
        <div class="btn-group-vertical w-100" role="group">
            <a href="https://ko-fi.com/dunebot" 
               target="_blank" 
               class="btn btn-info mb-2">
                <i class="fas fa-coffee me-2"></i>Ko-Fi (Einmalig)
            </a>
            
            <a href="https://patreon.com/dunebot" 
               target="_blank" 
               class="btn btn-danger mb-2">
                <i class="fab fa-patreon me-2"></i>Patreon (Monatlich)
            </a>
            
            <a href="https://paypal.me/dunebot" 
               target="_blank" 
               class="btn btn-primary">
                <i class="fab fa-paypal me-2"></i>PayPal
            </a>
        </div>
        
        <p class="mt-3 text-muted small">
            Alle Spenden werden für Server-Kosten und Entwicklung verwendet.
        </p>
    </div>
</div>
```

---

### 2. Core-Plugin Widget-Registration

**In `plugins/core/dashboard/index.js` → `_registerWidgets()`:**

```javascript
_registerWidgets() {
    const pluginManager = ServiceManager.get('pluginManager');
    const themeManager = ServiceManager.get('themeManager');
    const dbService = ServiceManager.get('dbService');
    
    pluginManager.hooks.addFilter('guild_dashboard_widgets', async (widgets, options) => {
        const { guildId, user } = options;
        
        // Donation-Statistiken laden
        const donationStats = await dbService.query(`
            SELECT 
                COUNT(DISTINCT user_id) as supporterCount,
                SUM(amount) as totalAmount
            FROM donations
            WHERE payment_status = 'completed'
        `);
        
        // User-Badge laden (falls vorhanden)
        let userBadge = null;
        if (user && user.id) {
            const badge = await dbService.query(`
                SELECT * FROM supporter_badges WHERE user_id = ?
            `, [user.id]);
            
            userBadge = badge && badge.length > 0 ? badge[0] : null;
        }
        
        // Support-Widget hinzufügen
        widgets.push({
            id: 'support-dunebot',
            title: 'Unterstütze DuneBot',
            size: 4,  // 1/3 Breite
            icon: 'fa-solid fa-heart',
            cardClass: 'card-danger',
            content: await themeManager.renderWidgetPartial('support-dunebot', {
                donationStats: donationStats[0] || {},
                userBadge,
                guildId
            })
        });
        
        return widgets;
    }, 10); // Priorität 10 = Core-Plugin (vor anderen Plugins)
}
```

---

### 3. Supporter-Badge im Dashboard

**In Theme-Layout:** `apps/dashboard/themes/default/layouts/guild.ejs`

```ejs
<!-- User-Dropdown erweitern -->
<li class="nav-item dropdown user-menu">
    <a href="#" class="nav-link dropdown-toggle" data-bs-toggle="dropdown">
        <img src="<%= user.avatar %>" class="user-image img-circle elevation-2" alt="User Image">
        <span class="d-none d-md-inline">
            <%= user.username %>
            
            <!-- Supporter-Badge anzeigen -->
            <% if (user.supporterBadge) { %>
                <% if (user.supporterBadge.badge_level === 'platinum') { %>
                    <span class="badge badge-light" title="Platinum Supporter">⭐⭐⭐⭐</span>
                <% } else if (user.supporterBadge.badge_level === 'gold') { %>
                    <span class="badge badge-warning" title="Gold Supporter">⭐⭐⭐</span>
                <% } else if (user.supporterBadge.badge_level === 'silver') { %>
                    <span class="badge badge-secondary" title="Silver Supporter">⭐⭐</span>
                <% } else if (user.supporterBadge.badge_level === 'bronze') { %>
                    <span class="badge badge-info" title="Bronze Supporter">⭐</span>
                <% } %>
            <% } %>
        </span>
    </a>
</li>
```

**Badge-Daten in Middleware laden:**

**In `apps/dashboard/middleware/context/user.middleware.js`:**

```javascript
// Nach dem Laden der User-Daten:
if (req.session.user) {
    // Supporter-Badge laden
    const badge = await dbService.query(`
        SELECT * FROM supporter_badges WHERE user_id = ?
    `, [req.session.user.id]);
    
    if (badge && badge.length > 0) {
        req.session.user.supporterBadge = badge[0];
        res.locals.user.supporterBadge = badge[0];
    }
}
```

---

## 🔗 Ko-Fi & Patreon Webhook-Integration

### Ko-Fi Webhook Handler

**Neue Datei:** `plugins/superadmin/dashboard/routes/api/kofi-webhook.js`

```javascript
/**
 * Ko-Fi Webhook Handler
 * Empfängt Webhook-Calls von Ko-Fi nach Donations
 */
const express = require('express');
const router = express.Router();
const { ServiceManager } = require('dunebot-core');

/**
 * POST /api/superadmin/webhooks/kofi
 * Ko-Fi Webhook Endpoint
 */
router.post('/', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    
    try {
        // Ko-Fi sendet Daten als `data` Parameter (URL-encoded JSON)
        const payload = JSON.parse(req.body.data);
        
        Logger.info('[Ko-Fi Webhook] Payload erhalten:', payload);
        
        // Validierung
        if (!payload.verification_token) {
            return res.status(401).send('Invalid verification token');
        }
        
        if (payload.verification_token !== process.env.KOFI_VERIFICATION_TOKEN) {
            Logger.warn('[Ko-Fi Webhook] Ungültiges Verification-Token');
            return res.status(401).send('Unauthorized');
        }
        
        // Donation-Daten extrahieren
        const amount = parseFloat(payload.amount);
        const message = payload.message || null;
        const paymentId = payload.kofi_transaction_id;
        
        // User aus Message extrahieren (Format: "Discord: 123456789012345678")
        let userId = null;
        if (message && message.includes('Discord:')) {
            const match = message.match(/Discord:\s*(\d{17,19})/);
            userId = match ? match[1] : null;
        }
        
        if (!userId) {
            Logger.warn('[Ko-Fi Webhook] Keine Discord-User-ID in Message gefunden');
            // Trotzdem speichern, aber ohne User-Zuordnung
        }
        
        // Donation in DB speichern
        await dbService.query(`
            INSERT INTO donations (
                user_id, amount, currency, message, 
                payment_provider, payment_id, payment_status, is_recurring
            ) VALUES (?, ?, 'EUR', ?, 'kofi', ?, 'completed', 0)
        `, [userId, amount, message, paymentId]);
        
        // Badge aktualisieren (falls User-ID vorhanden)
        if (userId) {
            await updateSupporterBadge(userId, amount);
        }
        
        Logger.success(`[Ko-Fi Webhook] Donation verarbeitet: €${amount}`);
        
        res.status(200).send('OK');
        
    } catch (error) {
        Logger.error('[Ko-Fi Webhook] Fehler beim Verarbeiten:', error);
        res.status(500).send('Internal Server Error');
    }
});

module.exports = router;
```

**Ko-Fi Webhook-URL:** `https://yourdomain.com/api/superadmin/webhooks/kofi`

---

## 📝 Localization (i18n)

### SuperAdmin Locales

**`plugins/superadmin/dashboard/locales/de-DE.json`:**

```json
{
  "NAV": {
    "DONATIONS": "Donations",
    "SUPPORTERS": "Supporter"
  },
  "DONATIONS": {
    "TITLE": "Donation Management",
    "TOTAL_AMOUNT": "Gesamt Donations",
    "MONTHLY_RECURRING": "Monatlich (MRR)",
    "TOTAL_COUNT": "Total Spenden",
    "UNIQUE_SUPPORTERS": "Unique Supporter",
    "TOP_DONORS": "Top Spender",
    "CREATE_MANUAL": "Manuelle Donation erfassen",
    "USER_ID": "Discord User-ID",
    "AMOUNT": "Betrag",
    "CURRENCY": "Währung",
    "MESSAGE": "Nachricht",
    "IS_RECURRING": "Monatliche Spende",
    "DELETE_CONFIRM": "Donation wirklich löschen? (Badge wird neu berechnet)"
  }
}
```

---

## ✅ Implementierungs-Reihenfolge

### Phase 1: Datenbank & Backend (2-3h)
1. ✅ SQL-Tabellen erstellen (`donations`, `supporter_badges`)
2. ✅ SuperAdmin-Route `/donations` implementieren
3. ✅ Donation-Create + Delete API
4. ✅ Badge-System (Update + Recalculate)

### Phase 2: SuperAdmin-Views (2-3h)
5. ✅ SuperAdmin-View `donations.ejs` erstellen
6. ✅ Navigation erweitern
7. ✅ guild.js Handler für `create-donation` Form

### Phase 3: Core-Plugin-Integration (2-3h)
8. ✅ Support-Widget erstellen
9. ✅ Widget-Registration in Core
10. ✅ Badge im User-Dropdown anzeigen
11. ✅ Middleware für Badge-Loading

### Phase 4: Webhook-Integration (2-3h)
12. ✅ Ko-Fi-Webhook-Handler
13. ✅ Patreon-Webhook (optional)
14. ✅ Testing mit Webhook-Test-Tools

---

## 🎯 Zusammenfassung

**SuperAdmin (Control-Guild):**
- ✅ `/guild/:guildId/plugins/superadmin/donations` - Donation-Management
- ✅ Manuelle Donations erfassen
- ✅ Donation-Statistiken (MRR, Total, Top-Spender)
- ✅ Ko-Fi/Patreon-Webhooks

**Core (jede Guild):**
- ✅ Support-Widget mit Donation-Buttons
- ✅ Supporter-Badge im Dashboard
- ✅ Öffentliche Donation-Stats

**Datenbank:**
- ✅ `donations` - Alle Spenden
- ✅ `supporter_badges` - User-Badges mit Levels

**Geschätzter Aufwand:** 8-12 Stunden Entwicklung

---

**Bereit für die Implementierung?** 🚀
