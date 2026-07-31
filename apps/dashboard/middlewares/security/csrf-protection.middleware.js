/**
 * CSRF Protection Middleware
 * 
 * Schützt vor Cross-Site Request Forgery Angriffen
 * Verwendet Double-Submit-Cookie Pattern
 * 
 * @module middleware/security/csrf-protection
 * @author FireBot Team
 */

const crypto = require('node:crypto');
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
 * Rollout-Schalter für die GLOBALE CSRF-Verifikation:
 * CSRF_ENFORCE=true  → ungültige Tokens werden geblockt (403)
 * sonst              → Report-Only: nur Logging, Request läuft weiter
 * (Per-Route eingesetztes csrfProtection blockt IMMER, unabhängig vom Flag.)
 */
const CSRF_ENFORCE = process.env.CSRF_ENFORCE === 'true';

/**
 * Prüft ob dieser Request von der CSRF-Verifikation ausgenommen ist
 */
const isCsrfExempt = (req) => {
    // API-Routes mit Token-Auth (haben eigene Security)
    if (req.path.startsWith('/api/') && req.headers.authorization) return true;
    // Webhooks (haben eigene Signature-Verification)
    if (req.path.includes('/webhook')) return true;
    // Downloads (One-Line-Installer via curl, keine Browser-Session)
    if (req.path === '/downloads' || req.path.startsWith('/downloads/')) return true;
    return false;
};

/**
 * Beschreibt, woran ein abgelehnter Request scheiterte.
 *
 * "Invalid token" allein ist als Fehlermeldung wertlos: Es kann bedeuten, dass
 * gar kein Token mitkam (Formular ohne verstecktes Feld, Skript ohne Header),
 * dass das Cookie fehlt (Browser hat es verworfen) oder dass Token und Cookie
 * nicht zusammenpassen (Seite älter als die Session). Das sind drei völlig
 * verschiedene Ursachen mit drei verschiedenen Reparaturen.
 *
 * @param {object} req
 * @returns {string} Kurzdiagnose für das Log
 */
const describeCsrfFailure = (req) => {
    const headerToken = req.headers['x-csrf-token'];
    const bodyToken   = req.body?._csrf;
    const cookie      = req.cookies?.['__Host-dunebot.x-csrf-token'];

    const parts = [];
    if (headerToken)      parts.push('Header-Token');
    else if (bodyToken)   parts.push('Body-Token (_csrf)');
    else                  parts.push('KEIN Token mitgeschickt');

    parts.push(cookie ? 'Cookie vorhanden' : 'KEIN Cookie');
    parts.push(req.session?.id ? 'Session ok' : 'KEINE Session');

    // Nur die ersten Zeichen: Das Token ist kein Geheimnis im Sinne eines
    // Passworts, aber es gehört trotzdem nicht vollständig ins Log.
    const shown = headerToken || bodyToken;
    if (shown && cookie) {
        parts.push(shown === cookie ? 'Token == Cookie' : 'Token != Cookie');
        // Sind Token und Cookie identisch und trotzdem ungültig, liegt es an der
        // HMAC-Prüfung: Das Token ist an eine Sitzungskennung gebunden. Hier wird
        // ausprobiert, mit welcher Kennung es damals ausgestellt wurde.
        if (shown === cookie) parts.push(identifyTokenOwner(req, shown));
    }

    return parts.join(', ');
};

/**
 * Rechnet nach, zu welcher Sitzungskennung ein Token passt.
 *
 * csrf-csrf bildet das Token als `HMAC(secret, "<len>!<kennung>!<len>!<zufall>").<zufall>`,
 * wobei die Kennung aus `getSessionIdentifier()` stammt. Passt keine der beiden
 * möglichen Kennungen, wurde das Token unter einer dritten ausgestellt – dann ist
 * die Sitzung zwischenzeitlich gewechselt.
 *
 * @param {object} req
 * @param {string} token
 * @returns {string} Kurzbefund fürs Log
 */
function identifyTokenOwner(req, token) {
    try {
        const [hmac, randomValue] = String(token).split('.');
        if (!hmac || !randomValue) return 'Token-Format unerwartet';

        const secret = process.env.CSRF_SECRET || 'dunebot-csrf-secret-change-in-production';
        const matches = (identifier) => {
            const message = [identifier.length, identifier, randomValue.length, randomValue].join('!');
            return crypto.createHmac('sha256', secret).update(message).digest('hex') === hmac;
        };

        if (req.session?.id && matches(req.session.id)) {
            // Dürfte nicht vorkommen – dann hätte die Bibliothek akzeptiert.
            return 'HMAC passt zur AKTUELLEN Session (unerwartet)';
        }
        if (matches(`${req.ip}-${req.headers['user-agent']}`)) {
            return 'HMAC passt zur IP+Browser-Kennung → beim Ausstellen gab es KEINE Session';
        }
        return 'HMAC passt zu keiner aktuellen Kennung → Session hat seit dem Ausstellen gewechselt';

    } catch (err) {
        return `HMAC-Vergleich fehlgeschlagen: ${err.message}`;
    }
}

/**
 * Einheitliche 403-Antwort bei ungültigem Token
 */
const sendCsrfError = (req, res) => {
    // JSON-Response für AJAX-Requests
    if (req.xhr || req.headers.accept?.includes('application/json')) {
        return res.status(403).json({
            success: false,
            message: 'Ungültiges CSRF-Token. Bitte lade die Seite neu.'
        });
    }

    // HTML-Response für normale Requests
    return res.status(403).send('CSRF-Token ungültig. Bitte lade die Seite neu.');
};

/**
 * CSRF-Validierung für POST/PUT/DELETE/PATCH Requests (per-Route, blockt immer)
 * Nutzt die eingebaute Middleware von csrf-csrf
 */
const csrfProtection = (req, res, next) => {
    if (isCsrfExempt(req)) {
        return next();
    }

    // Nutze die eingebaute doubleCsrfProtection Middleware
    doubleCsrfProtection(req, res, (error) => {
        if (error) {
            const Logger = ServiceManager.get('Logger');
            Logger.warn(`[CSRF] Invalid token from ${req.ip} -> ${req.path} — ${describeCsrfFailure(req)}`);
            return sendCsrfError(req, res);
        }

        next();
    });
};

/**
 * GLOBALE CSRF-Validierung für alle state-ändernden Requests.
 * Läuft standardmäßig im Report-Only-Modus (nur Logging), damit der
 * Rollout beobachtet werden kann, bevor CSRF_ENFORCE=true scharf schaltet.
 */
const csrfGlobalProtection = (req, res, next) => {
    if (isCsrfExempt(req)) {
        return next();
    }

    doubleCsrfProtection(req, res, (error) => {
        if (error) {
            const Logger = ServiceManager.get('Logger');

            if (!CSRF_ENFORCE) {
                Logger.warn(`[CSRF][report-only] Würde blocken: ${req.method} ${req.path} von ${req.ip} (${describeCsrfFailure(req)}) — CSRF_ENFORCE=true aktiviert die Durchsetzung`);
                return next();
            }

            Logger.warn(`[CSRF] Invalid token from ${req.ip} -> ${req.method} ${req.path} — ${describeCsrfFailure(req)}`);
            return sendCsrfError(req, res);
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
    csrfGlobalProtection,
    csrfErrorHandler
};
