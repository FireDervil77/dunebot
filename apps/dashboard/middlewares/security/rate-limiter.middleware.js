/**
 * Rate Limiting Middleware
 * 
 * Schützt vor DDoS, Brute-Force und Bot-Spam
 * Verschiedene Limits für verschiedene Route-Types
 * 
 * @module middleware/security/rate-limiter
 * @author FireBot Team
 */

const rateLimit = require('express-rate-limit');
const { ServiceManager } = require('dunebot-core');

/**
 * Rate Limits für Auth-Routes (Login, Register)
 * Verhindert Brute-Force-Angriffe, aber flexibel genug für OAuth-Redirects
 * 
 * Hinweis: Jeder OAuth-Login verbraucht 2 Hits (login + callback),
 * daher max=20 → erlaubt ~10 vollständige Login-Versuche
 */
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 Minuten
    max: 20, // Max 20 Versuche pro IP (~10 vollständige OAuth-Zyklen)
    skipSuccessfulRequests: true, // Erfolgreiche Logins zählen nicht mit!
    message: {
        success: false,
        message: 'Zu viele Login-Versuche. Bitte warte 15 Minuten.'
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        const Logger = ServiceManager.get('Logger');
        Logger.warn(`[Security] Rate limit exceeded for auth route: ${req.ip} -> ${req.path}`);
        res.status(429).json({
            success: false,
            message: 'Zu viele Login-Versuche. Bitte warte 15 Minuten.'
        });
    }
});

/**
 * Moderate Limits für API-Routes
 * Verhindert API-Spam und übermäßige Datenabfragen
 */
const apiLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 Minute
    max: process.env.NODE_ENV === 'production' ? 60 : 200, // Dev: 200 req/min, Prod: 60 req/min
    message: {
        success: false,
        message: 'Zu viele API-Anfragen. Bitte verlangsame dich.'
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        const Logger = ServiceManager.get('Logger');
        Logger.warn(`[Security] API rate limit exceeded: ${req.ip} -> ${req.path}`);
        res.status(429).json({
            success: false,
            message: 'Zu viele Anfragen. Bitte verlangsame dich.'
        });
    }
});

/**
 * Strikte Limits für sensitive Guild-Actions (Delete, Kick, Ban)
 * Verhindert Missbrauch von Admin-Funktionen
 */
const guildActionLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 Minuten
    max: 20, // Max 20 Actions in 5 Minuten
    message: {
        success: false,
        message: 'Zu viele Admin-Aktionen. Bitte warte 5 Minuten.'
    },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: false, // Auch erfolgreiche Requests zählen
    handler: (req, res) => {
        const Logger = ServiceManager.get('Logger');
        Logger.warn(`[Security] Guild action rate limit: ${req.ip} -> ${req.path}`);
        res.status(429).json({
            success: false,
            message: 'Zu viele Admin-Aktionen. Bitte verlangsame dich.'
        });
    }
});

/**
 * Lockere Limits für normale Page-Views
 * Verhindert exzessive Crawler/Bot-Activity
 */
const generalLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 Minute
    max: process.env.NODE_ENV === 'production' ? 200 : 500, // Dev: 500 req/min, Prod: 200 req/min
    message: 'Zu viele Anfragen. Bitte verlangsame dich.',
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: false,
    handler: (req, res) => {
        const Logger = ServiceManager.get('Logger');
        Logger.warn(`[Security] General rate limit exceeded: ${req.ip} -> ${req.path}`);
        res.status(429).send('Zu viele Anfragen. Bitte verlangsame dich.');
    }
});

/**
 * Webhook-Limiter — fuer eingehende Rueckrufe fremder Dienste.
 *
 * Bis zum 2026-08-23 stand hier `max: 10` und der Limiter wurde **nirgends
 * verwendet** (Baustelle 63b). Beides ist jetzt behoben: Er haengt am
 * dynamischen Webhook-Mount in `app.js` — und 10 waeren dort toedlich gewesen.
 *
 * Warum 600: Ein einzelner Twitch-Kanal erzeugt beim Livegehen eine Zustellung,
 * aber ein Anbieter stellt aus **wenigen** Adressen fuer **alle** beobachteten
 * Kanaele zu. Alle Zustellungen teilen sich also dasselbe IP-Budget. Wird es
 * gerissen, antworten wir 429, der Anbieter wertet das als Fehlzustellung — und
 * nach genug davon widerruft Twitch die Abos **aller** Guilds. Der Zaehler ist
 * deshalb bewusst weit; die eigentliche Schranke ist die Signaturpruefung, die
 * jeder Handler durchfuehren muss.
 *
 * 600/Minute sind 10 je Sekunde und damit weit ueber jedem realistischen
 * Schwall, aber immer noch eine Grenze gegen einen Fluter.
 */
const webhookLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 Minute
    max: 600,                // 10 je Sekunde
    message: {
        success: false,
        message: 'Webhook rate limit exceeded'
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        // Muss auffallen: Wenn das greift, verliert ein Anbieter Zustellungen.
        const { ServiceManager } = require('dunebot-core');
        ServiceManager.get('Logger').warn(
            `[Security] Webhook-Ratengrenze gerissen: ${req.ip} -> ${req.originalUrl}`
        );
        res.status(429).json({ success: false, message: 'Webhook rate limit exceeded' });
    }
});

module.exports = {
    authLimiter,
    apiLimiter,
    guildActionLimiter,
    generalLimiter,
    webhookLimiter
};
