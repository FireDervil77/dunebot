/**
 * Admin Middleware — Zugriffskontrolle für den /admin Bereich
 * 
 * Prüft ob der eingeloggte User SYSTEM.ACCESS Permission hat.
 * Nutzt PermissionManager.hasSystemPermission() — kein hardcodierter Owner-Check.
 * Unterstützt OWNER_IDS (ENV) und optional CONTROL_GUILD_ID (ENV).
 *
 * @author FireBot Team
 */

'use strict';

const { ServiceManager } = require('dunebot-core');

/**
 * Express Middleware: Zugriff nur für System-User (SYSTEM.ACCESS Permission)
 * Gibt 403 zurück wenn kein Zugriff, sonst next()
 * 
 * @param {object} req - Express Request
 * @param {object} res - Express Response
 * @param {object} next - Express Next
 */
async function CheckAdmin(req, res, next) {
    const Logger = ServiceManager.get('Logger');
    const permissionManager = ServiceManager.get('permissionManager');

    try {
        const userId = req.session?.user?.info?.id;

        if (!userId) {
            Logger.warn('[AdminMiddleware] Kein User in Session — Zugriff verweigert');
            if (req.xhr || req.headers.accept?.includes('application/json')) {
                return res.status(401).json({ success: false, error: 'Nicht angemeldet' });
            }
            return res.redirect('/auth/login?redirect=' + encodeURIComponent(req.originalUrl));
        }

        const hasAccess = await permissionManager.hasSystemPermission(userId, 'SYSTEM.ACCESS');

        if (!hasAccess) {
            Logger.warn(`[AdminMiddleware] User ${userId} hat keine SYSTEM.ACCESS Permission`);
            if (req.xhr || req.headers.accept?.includes('application/json')) {
                return res.status(403).json({
                    success: false,
                    error: 'Zugriff verweigert — keine System-Berechtigung'
                });
            }
            return res.status(403).render('error', {
                message: 'Zugriff verweigert',
                error: { status: 403, message: 'Du hast keine Berechtigung für den Admin-Bereich' }
            });
        }

        Logger.debug(`[AdminMiddleware] ✅ User ${userId} hat SYSTEM.ACCESS`);
        next();

    } catch (error) {
        Logger.error('[AdminMiddleware] Fehler beim Permission-Check:', error);
        return res.status(500).render('error', {
            message: 'Interner Serverfehler',
            error: { status: 500, message: 'Fehler beim Prüfen der System-Berechtigung' }
        });
    }
}

/**
 * Synchroner Hilfs-Check (für non-async Kontexte)
 * Prüft nur OWNER_IDS — kein CONTROL_GUILD_ID Support
 * 
 * @param {object} user - req.session.user oder res.locals.user
 * @returns {boolean}
 */
function isAdminUser(user) {
    const userId = user?.info?.id;
    if (!userId) return false;

    const ownerIds = process.env.OWNER_IDS
        ? process.env.OWNER_IDS.split(',').map(id => id.trim()).filter(Boolean)
        : [];

    return ownerIds.includes(String(userId));
}

module.exports = { CheckAdmin, isAdminUser };

