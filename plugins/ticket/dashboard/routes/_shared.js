/**
 * Ticket - gemeinsame Helfer der Router
 *
 * @module ticket/routes/_shared
 */

const { ServiceManager } = require('dunebot-core');

/**
 * Uebersetzungsfunktion fuer eine Anfrage.
 *
 * @param {Object} req Express-Anfrage
 * @param {Object} res Express-Antwort
 * @returns {Function} tr(key, options)
 */
function makeTranslator(req, res) {
    return (key, options = {}) => {
        try {
            if (typeof req.translate === 'function') return req.translate(key, options);
            const i18n = ServiceManager.get('i18n');
            if (i18n && i18n.i18next) {
                return i18n.i18next.t(key, { ...options, lng: res.locals?.locale || 'de-DE' });
            }
            return key;
        } catch {
            return key;
        }
    };
}

/** View ueber den ThemeManager rendern. */
async function renderView(res, viewPath, data) {
    return await ServiceManager.get('themeManager').renderView(res, viewPath, data);
}

/** Channels der Guild ueber IPC beim Bot erfragen. */
async function getGuildChannels(guildId) {
    const ipcServer = ServiceManager.get('ipcServer');
    if (!ipcServer) return [];
    try {
        const antworten = await ipcServer.broadcast('dashboard:GET_GUILD_CHANNELS', { guildId });
        return antworten?.[0]?.channels || [];
    } catch (err) {
        ServiceManager.get('Logger').warn(`[Ticket] Channels nicht ladbar: ${err.message}`);
        return [];
    }
}

/** Rollen der Guild ueber IPC beim Bot erfragen. */
async function getGuildRoles(guildId) {
    const ipcServer = ServiceManager.get('ipcServer');
    if (!ipcServer) return [];
    try {
        const antworten = await ipcServer.broadcast('dashboard:GET_GUILD_ROLES', { guildId, includeAll: true });
        return antworten?.[0]?.roles || [];
    } catch (err) {
        ServiceManager.get('Logger').warn(`[Ticket] Rollen nicht ladbar: ${err.message}`);
        return [];
    }
}

/**
 * Wer die Anfrage stellt.
 *
 * @param {Object} req Express-Anfrage
 * @param {Object} res Express-Antwort
 * @returns {string|null} Discord-ID oder null
 */
function angemeldeterNutzer(req, res) {
    return req.session?.user?.info?.id || res.locals?.user?.id || null;
}

/** Fehlerseite statt eines nackten 500ers. */
function renderFehler(res, error, kontext) {
    const themeManager = ServiceManager.get('themeManager');
    ServiceManager.get('Logger').error(`[Ticket] ${kontext}:`, error);

    res.locals.layout = themeManager?.getLayout('guild');
    return res.status(500).render('error', {
        status: 500,
        message: 'Tickets',
        error: { status: 500, title: 'Seite konnte nicht geladen werden', message: kontext, details: error.message }
    });
}

/** Fehler einer JSON-Route einheitlich melden. */
function fehler(res, error, text, status = 500) {
    ServiceManager.get('Logger').error(`[Ticket] ${text}:`, error);
    res.status(status).json({ success: false, error: text });
}

module.exports = {
    makeTranslator, renderView, getGuildChannels, getGuildRoles,
    angemeldeterNutzer, renderFehler, fehler
};
