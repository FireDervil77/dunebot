/**
 * CSRF Protection Middleware
 * 
 * Schützt vor Cross-Site Request Forgery Angriffen
 * Verwendet Double-Submit-Cookie Pattern
 * 
 * @module middleware/security/csrf-protection
 * @author FireBot Team
 */

const { doubleCsrf } = require('csrf-csrf');
const { ServiceManager } = require('dunebot-core');

// CSRF-Protection konfigurieren
const {
    generateCsrfToken, // Funktion: (req, res, overwrite?) => string
    doubleCsrfProtection, // Middleware für Validierung
} = doubleCsrf({
    getSecret: () => process.env.CSRF_SECRET || 'dunebot-csrf-secret-change-in-production',
    cookieName: '__Host-dunebot.x-csrf-token',
    cookieOptions: {
        sameSite: 'strict',
        path: '/',
        secure: process.env.NODE_ENV === 'production', // Nur HTTPS in Production
        httpOnly: true
    },
    size: 64,
    ignoredMethods: ['GET', 'HEAD', 'OPTIONS'],
    getTokenFromRequest: (req) => {
        // Token kann aus Header ODER Body kommen
        return req.headers['x-csrf-token'] || req.body._csrf;
    },
    getSessionIdentifier: (req) => {
        // Session-ID als eindeutiger Identifier
        // Wenn keine Session existiert, generiere temporäre ID basierend auf IP/User-Agent
        return req.session?.id || `${req.ip}-${req.headers['user-agent']}`;
    }
});

/**
 * CSRF-Token generieren und in Locals speichern
 * Wird automatisch in allen Views verfügbar sein
 */
const csrfMiddleware = (req, res, next) => {
    try {
        // Token generieren (csrf-csrf erwartet req, res)
        const token = generateCsrfToken(req, res);
        
        // In res.locals speichern (für EJS-Views)
        res.locals.csrfToken = token;
        
        // Auch als Meta-Tag verfügbar machen
        res.locals.csrfMetaTag = `<meta name="csrf-token" content="${token}">`;
        
        next();
    } catch (error) {
        const Logger = ServiceManager.get('Logger');
        Logger.error('[CSRF] Token generation failed:', error);
        next(error);
    }
};

/**
 * CSRF-Validierung für POST/PUT/DELETE/PATCH Requests
 * Nutzt die eingebaute Middleware von csrf-csrf
 */
const csrfProtection = (req, res, next) => {
    // Skip für API-Routes mit Token-Auth (haben eigene Security)
    if (req.path.startsWith('/api/') && req.headers.authorization) {
        return next();
    }
    
    // Skip für Webhooks (haben eigene Signature-Verification)
    if (req.path.includes('/webhook')) {
        return next();
    }
    
    // Nutze die eingebaute doubleCsrfProtection Middleware
    doubleCsrfProtection(req, res, (error) => {
        if (error) {
            const Logger = ServiceManager.get('Logger');
            Logger.warn(`[CSRF] Invalid token from ${req.ip} -> ${req.path}`);
            
            // JSON-Response für AJAX-Requests
            if (req.xhr || req.headers.accept?.includes('application/json')) {
                return res.status(403).json({
                    success: false,
                    message: 'Ungültiges CSRF-Token. Bitte lade die Seite neu.'
                });
            }
            
            // HTML-Response für normale Requests
            return res.status(403).send('CSRF-Token ungültig. Bitte lade die Seite neu.');
        }
        
        next();
    });
};

/**
 * Error-Handler für CSRF-Fehler
 */
const csrfErrorHandler = (err, req, res, next) => {
    if (err.code === 'EBADCSRFTOKEN' || err.message?.includes('csrf')) {
        const Logger = ServiceManager.get('Logger');
        Logger.warn(`[CSRF] Invalid token detected: ${req.ip} -> ${req.path}`);
        
        return res.status(403).json({
            success: false,
            message: 'Ungültiges CSRF-Token'
        });
    }
    next(err);
};

module.exports = {
    csrfMiddleware,
    csrfProtection,
    csrfErrorHandler
};
