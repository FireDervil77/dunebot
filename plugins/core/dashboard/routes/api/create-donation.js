/**
 * Core-Plugin API: Stripe Checkout Session erstellen
 * Route: POST /api/core/create-donation
 * 
 * @module plugins/core/dashboard/routes/api/create-donation
 * @author FireBot Team
 */

const express = require('express');
const router = express.Router();
const { ServiceManager } = require('dunebot-core');

// Stripe initialisieren (lazy load)
let stripe = null;

/**
 * Stripe-Client initialisieren (nur einmal)
 * @returns {import('stripe').Stripe}
 */
function getStripe() {
    if (!stripe) {
        const stripeKey = process.env.STRIPE_SECRET_KEY;
        
        if (!stripeKey) {
            throw new Error('STRIPE_SECRET_KEY nicht in .env konfiguriert');
        }
        
        stripe = require('stripe')(stripeKey);
    }
    return stripe;
}

/**
 * POST /api/core/create-donation
 * Erstellt eine Stripe Checkout Session für eine Donation
 * 
 * @body {number} amount - Spendenbetrag in EUR (min. 1)
 * @body {string} message - Optionale Nachricht (max. 500 Zeichen)
 * @body {string} guild_id - Guild-ID für Referenz
 * @returns {object} { success: true, sessionId, url }
 */
router.post('/', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const user = req.session?.user?.info;
    
    // Auth-Check
    if (!user || !user.id) {
        return res.status(401).json({ 
            success: false, 
            message: 'Nicht authentifiziert. Bitte melde dich an.' 
        });
    }
    
    try {
        const { amount, message, guild_id } = req.body;
        
        // Validierung: Betrag (akzeptiere Number oder String)
        const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
        
        if (!numAmount || isNaN(numAmount) || numAmount < 1) {
            Logger.warn(`[Create-Donation] Ungültiger Betrag: ${amount} (Type: ${typeof amount})`);
            return res.status(400).json({ 
                success: false, 
                message: 'Ungültiger Betrag. Mindestbetrag: €1' 
            });
        }
        
        if (numAmount > 10000) {
            return res.status(400).json({ 
                success: false, 
                message: 'Maximalbetrag: €10.000' 
            });
        }
        
        // Validierung: Nachricht (optional)
        let sanitizedMessage = null;
        if (message) {
            sanitizedMessage = String(message).substring(0, 500); // Max 500 Zeichen
        }
        
        const stripeClient = getStripe();
        
        // Stripe Checkout Session erstellen
        const session = await stripeClient.checkout.sessions.create({
            // Zahlungsmethoden für Deutschland/Europa
            payment_method_types: [
                'card',         // Kreditkarten (Visa, Mastercard, Amex)
                'sepa_debit',   // SEPA-Lastschrift
                'giropay',      // Giropay
                'sofort',       // Sofortüberweisung
                'klarna',       // Klarna (Rechnung/Ratenkauf)
                'eps',          // EPS (Österreich)
                'ideal'         // iDEAL (Niederlande)
            ],
            line_items: [{
                price_data: {
                    currency: 'eur',
                    product_data: {
                        name: 'FireBot Unterstützung',
                        description: sanitizedMessage || 'Vielen Dank für deine Spende!',
                        images: [`${process.env.DASHBOARD_BASE_URL}/themes/default/assets/images/DuneBot.png`]
                    },
                    unit_amount: Math.round(numAmount * 100) // EUR zu Cent
                },
                quantity: 1
            }],
            mode: 'payment',
            success_url: `${process.env.DASHBOARD_BASE_URL}/guild/${guild_id}/plugins/core/donate?payment=success&session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${process.env.DASHBOARD_BASE_URL}/guild/${guild_id}/plugins/core/donate?payment=cancelled`,
            
            // WICHTIG: User-Daten als Metadata speichern
            metadata: {
                user_id: user.id,
                username: user.username || 'Unknown',
                discriminator: user.discriminator || '0000',
                guild_id: guild_id || null,
                message: sanitizedMessage || null,
                source: 'dashboard_donation_page'
            },
            
            // Optional: Customer-Email vorausfüllen
            customer_email: user.email || null
        });
        
        Logger.info(`[Donation] Stripe-Session erstellt: ${session.id} für User ${user.id} (${user.username})`);
        Logger.debug(`[Donation] Betrag: €${numAmount}, Guild: ${guild_id || 'N/A'}`);
        
        res.json({ 
            success: true, 
            sessionId: session.id,
            url: session.url
        });
        
    } catch (error) {
        Logger.error('[Donation] Fehler beim Erstellen der Stripe-Session:', error);
        
        // Spezifische Fehler-Behandlung
        if (error.type === 'StripeInvalidRequestError') {
            return res.status(400).json({ 
                success: false, 
                message: 'Ungültige Stripe-Konfiguration. Bitte kontaktiere den Support.' 
            });
        }
        
        res.status(500).json({ 
            success: false, 
            message: 'Serverfehler beim Erstellen der Zahlung. Bitte versuche es später erneut.' 
        });
    }
});

module.exports = router;
