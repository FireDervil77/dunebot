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
 * Strenge Rate Limits für Auth-Routes (Login, Register)
 * Verhindert Brute-Force-Angriffe auf Passwörter
 */
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 Minuten
    max: 5, // Max 5 Versuche pro IP
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
            message: 'Zu viele Anfragen. Bitte warte 15 Minuten.'
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
    max: process.env.NODE_ENV === 'production' ? 120 : 500, // Dev: 500 req/min, Prod: 120 req/min
    message: 'Zu viele Anfragen. Bitte verlangsame dich.',
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        const Logger = ServiceManager.get('Logger');
        Logger.warn(`[Security] General rate limit exceeded: ${req.ip} -> ${req.path}`);
        res.status(429).send('Zu viele Anfragen. Bitte verlangsame dich.');
    }
});

/**
 * Webhook-Limiter (sehr restriktiv)
 * Externe Webhooks sollten sehr limitiert sein
 */
const webhookLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 Minute
    max: 10, // Max 10 Webhook-Calls pro Minute
    message: {
        success: false,
        message: 'Webhook rate limit exceeded'
    },
    standardHeaders: true,
    legacyHeaders: false
});

module.exports = {
    authLimiter,
    apiLimiter,
    guildActionLimiter,
    generalLimiter,
    webhookLimiter
};
