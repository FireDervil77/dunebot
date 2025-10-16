/**
 * Stripe Webhook Handler
 * Verarbeitet Stripe-Events für Donations
 * 
 * WICHTIG: Muss express.raw() Middleware verwenden für Signature Verification!
 * 
 * @author DuneBot Development Team
 */

const express = require('express');
const router = express.Router();
const ServiceManager = require('dunebot-core/lib/ServiceManager');
const dbService = ServiceManager.get('dbService');
const Logger = ServiceManager.get('Logger');

let stripe;

/**
 * Lazy-load Stripe Client
 */
function getStripe() {
    if (!stripe) {
        const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
        if (!stripeSecretKey || stripeSecretKey.startsWith('sk_test_YOUR')) {
            throw new Error('STRIPE_SECRET_KEY not configured in .env');
        }
        stripe = require('stripe')(stripeSecretKey);
    }
    return stripe;
}

/**
 * POST /api/superadmin/webhooks/stripe
 * Webhook-Endpoint für Stripe Events
 * 
 * WICHTIG: Route muss mit express.raw({ type: 'application/json' }) registriert werden!
 */
router.post('/', async (req, res) => {
    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    
    if (!webhookSecret || webhookSecret.startsWith('whsec_YOUR')) {
        Logger.error('[Stripe Webhook] STRIPE_WEBHOOK_SECRET not configured');
        return res.status(500).send('Webhook secret not configured');
    }
    
    let event;
    
    try {
        const stripeClient = getStripe();
        event = stripeClient.webhooks.constructEvent(
            req.body, 
            sig, 
            webhookSecret
        );
    } catch (err) {
        Logger.error('[Stripe Webhook] Signature verification failed:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }
    
    // Event-Type verarbeiten
    try {
        switch (event.type) {
            case 'checkout.session.completed':
                await handleCheckoutCompleted(event.data.object);
                break;
                
            case 'checkout.session.expired':
                await handleCheckoutExpired(event.data.object);
                break;
                
            case 'payment_intent.succeeded':
                await handlePaymentSucceeded(event.data.object);
                break;
                
            case 'payment_intent.payment_failed':
                await handlePaymentFailed(event.data.object);
                break;
                
            case 'charge.refunded':
                await handleChargeRefunded(event.data.object);
                break;
                
            default:
                Logger.debug(`[Stripe Webhook] Unhandled event type: ${event.type}`);
        }
        
        res.json({ received: true });
        
    } catch (error) {
        Logger.error('[Stripe Webhook] Error processing event:', error);
        res.status(500).json({ 
            error: 'Error processing webhook',
            message: error.message 
        });
    }
});

/**
 * Checkout Session Completed - Donation erfolgreich
 * @param {object} session - Stripe Checkout Session
 */
async function handleCheckoutCompleted(session) {
    Logger.info('[Stripe Webhook] Processing checkout.session.completed:', session.id);
    
    try {
        // Metadata extrahieren
        const { user_id, username, guild_id, message } = session.metadata;
        const amount = session.amount_total / 100; // Cents zu Euro
        const paymentIntent = session.payment_intent;
        
        if (!user_id || !amount) {
            Logger.error('[Stripe Webhook] Missing metadata in session:', session.id);
            return;
        }
        
        // Prüfen ob Donation bereits existiert
        const [existing] = await dbService.query(
            'SELECT id FROM donations WHERE stripe_session_id = ?',
            [session.id]
        );
        
        if (existing.length > 0) {
            Logger.warn('[Stripe Webhook] Donation already exists for session:', session.id);
            return;
        }
        
        // Donation in DB speichern
        const [result] = await dbService.query(`
            INSERT INTO donations (
                user_id,
                guild_id,
                amount,
                payment_provider,
                payment_status,
                stripe_payment_intent,
                stripe_session_id,
                metadata,
                created_at
            ) VALUES (?, ?, ?, 'stripe', 'completed', ?, ?, ?, NOW())
        `, [
            user_id,
            guild_id,
            amount,
            paymentIntent,
            session.id,
            JSON.stringify({
                username,
                message: message || null,
                customer_email: session.customer_details?.email || null
            })
        ]);
        
        const donationId = result.insertId;
        
        Logger.info(`[Stripe Webhook] Donation saved: ID ${donationId}, €${amount} from user ${username}`);
        
        // Supporter-Badge aktualisieren
        await updateSupporterBadge(user_id);
        
        // IPC: Discord-Role vergeben
        await assignSupporterRole(user_id, amount);
        
        Logger.info(`[Stripe Webhook] Successfully processed donation ${donationId}`);
        
    } catch (error) {
        Logger.error('[Stripe Webhook] Error handling checkout.completed:', error);
        throw error;
    }
}

/**
 * Checkout Session Expired - User hat nicht gezahlt
 * @param {object} session - Stripe Checkout Session
 */
async function handleCheckoutExpired(session) {
    Logger.info('[Stripe Webhook] Processing checkout.session.expired:', session.id);
    
    try {
        const { user_id, username } = session.metadata;
        
        // Optional: Session-Expiry in DB loggen
        await dbService.query(`
            INSERT INTO donations (
                user_id,
                guild_id,
                amount,
                payment_provider,
                payment_status,
                stripe_session_id,
                metadata,
                created_at
            ) VALUES (?, ?, ?, 'stripe', 'expired', ?, ?, NOW())
        `, [
            user_id,
            session.metadata.guild_id,
            session.amount_total / 100,
            session.id,
            JSON.stringify({ username, reason: 'Session expired' })
        ]);
        
        Logger.info(`[Stripe Webhook] Session expired for user ${username}: ${session.id}`);
        
    } catch (error) {
        Logger.error('[Stripe Webhook] Error handling checkout.expired:', error);
    }
}

/**
 * Charge Refunded - Zahlung wurde erstattet
 * @param {object} charge - Stripe Charge Object
 */
async function handleChargeRefunded(charge) {
    Logger.info('[Stripe Webhook] Processing charge.refunded:', charge.id);
    
    try {
        const paymentIntent = charge.payment_intent;
        
        // Donation finden
        const [donations] = await dbService.query(
            'SELECT * FROM donations WHERE stripe_payment_intent = ? AND payment_status = "completed"',
            [paymentIntent]
        );
        
        if (donations.length === 0) {
            Logger.warn('[Stripe Webhook] No donation found for refunded charge:', charge.id);
            return;
        }
        
        const donation = donations[0];
        
        // Status aktualisieren
        await dbService.query(
            'UPDATE donations SET payment_status = ?, metadata = JSON_SET(metadata, "$.refunded_at", NOW()) WHERE id = ?',
            ['refunded', donation.id]
        );
        
        Logger.info(`[Stripe Webhook] Donation ${donation.id} marked as refunded`);
        
        // Supporter-Badge neu berechnen
        await updateSupporterBadge(donation.user_id);
        
        // IPC: Discord-Role aktualisieren
        await assignSupporterRole(donation.user_id, 0);
        
    } catch (error) {
        Logger.error('[Stripe Webhook] Error handling charge.refunded:', error);
    }
}

/**
 * Payment Intent Succeeded - Zahlung erfolgreich
 * @param {object} paymentIntent - Stripe Payment Intent Object
 */
async function handlePaymentSucceeded(paymentIntent) {
    Logger.info('[Stripe Webhook] Processing payment_intent.succeeded:', paymentIntent.id);
    Logger.debug('[Stripe Webhook] Payment Intent Details:', {
        id: paymentIntent.id,
        amount: paymentIntent.amount / 100,
        currency: paymentIntent.currency,
        status: paymentIntent.status
    });
    // Meist bereits über checkout.session.completed behandelt
    // Hier nur zur Sicherheit loggen
}

/**
 * Payment Intent Failed - Zahlung fehlgeschlagen
 * @param {object} paymentIntent - Stripe Payment Intent Object
 */
async function handlePaymentFailed(paymentIntent) {
    Logger.warn('[Stripe Webhook] Processing payment_intent.payment_failed:', paymentIntent.id);
    
    try {
        const { last_payment_error } = paymentIntent;
        
        Logger.warn(`[Stripe Webhook] Payment failed: ${paymentIntent.id}`, {
            amount: paymentIntent.amount / 100,
            currency: paymentIntent.currency,
            error_code: last_payment_error?.code || 'unknown',
            error_message: last_payment_error?.message || 'No error details',
            payment_method: last_payment_error?.payment_method?.type || 'unknown'
        });
        
        // Optional: Failed payment in DB loggen für Statistiken
        // Aktuell: Nur logging, keine DB-Eintragung für failed attempts
        
    } catch (error) {
        Logger.error('[Stripe Webhook] Error handling payment_intent.payment_failed:', error);
    }
}

/**
 * Supporter-Badge aktualisieren basierend auf Gesamtsumme
 * @param {string} userId - Discord User ID
 */
async function updateSupporterBadge(userId) {
    try {
        // Gesamtsumme berechnen (nur completed)
        const [result] = await dbService.query(`
            SELECT 
                SUM(amount) as total_donated,
                COUNT(*) as donation_count
            FROM donations
            WHERE user_id = ?
                AND payment_status = 'completed'
        `, [userId]);
        
        const totalDonated = parseFloat(result[0]?.total_donated || 0);
        const donationCount = parseInt(result[0]?.donation_count || 0);
        
        // Badge-Level berechnen
        let badgeLevel = null;
        if (totalDonated >= 100) badgeLevel = 'platinum';
        else if (totalDonated >= 50) badgeLevel = 'gold';
        else if (totalDonated >= 20) badgeLevel = 'silver';
        else if (totalDonated >= 5) badgeLevel = 'bronze';
        
        if (!badgeLevel) {
            Logger.debug(`[Stripe Webhook] User ${userId} has not reached minimum for badge (€${totalDonated.toFixed(2)})`);
            return;
        }
        
        // Badge erstellen/aktualisieren
        await dbService.query(`
            INSERT INTO supporter_badges (
                user_id,
                badge_level,
                total_donated,
                donation_count,
                is_active,
                created_at,
                updated_at
            ) VALUES (?, ?, ?, ?, 1, NOW(), NOW())
            ON DUPLICATE KEY UPDATE
                badge_level = VALUES(badge_level),
                total_donated = VALUES(total_donated),
                donation_count = VALUES(donation_count),
                is_active = 1,
                updated_at = NOW()
        `, [userId, badgeLevel, totalDonated, donationCount]);
        
        Logger.info(`[Stripe Webhook] Supporter badge updated: User ${userId} → ${badgeLevel} (€${totalDonated.toFixed(2)})`);
        
    } catch (error) {
        Logger.error('[Stripe Webhook] Error updating supporter badge:', error);
        throw error;
    }
}

/**
 * Discord Supporter-Role via IPC vergeben
 * @param {string} userId - Discord User ID
 * @param {number} amount - Donation-Betrag (für Logging)
 */
async function assignSupporterRole(userId, amount) {
    try {
        const ipcServer = ServiceManager.get('ipcServer');
        
        if (!ipcServer) {
            Logger.warn('[Stripe Webhook] IPC Server not available, skipping role assignment');
            return;
        }
        
        // Badge-Level für User abrufen
        const [badges] = await dbService.query(
            'SELECT badge_level FROM supporter_badges WHERE user_id = ? AND is_active = 1',
            [userId]
        );
        
        const badgeLevel = badges[0]?.badge_level || null;
        
        // IPC Call an Bot via broadcastOne
        await ipcServer.broadcastOne('dashboard:SET_SUPPORTER_ROLE', {
            userId,
            badgeLevel,
            amount
        });
        
        Logger.info(`[Stripe Webhook] Discord role assignment triggered via IPC: User ${userId} → ${badgeLevel || 'none'}`);
        
    } catch (error) {
        Logger.error('[Stripe Webhook] Error assigning Discord role:', error);
        // Nicht re-throwen, Badge bleibt in DB
    }
}

module.exports = router;
module.exports.handleCheckoutCompleted = handleCheckoutCompleted;
module.exports.updateSupporterBadge = updateSupporterBadge;
