/**
 * Giveaway - gemeinsame Helfer der Router
 *
 * @module giveaway/routes/_shared
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
        } catch (err) {
            ServiceManager.get('Logger').error(`[Giveaway] Uebersetzungsfehler bei ${key}:`, err);
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
        ServiceManager.get('Logger').warn(`[Giveaway] Channels nicht ladbar: ${err.message}`);
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
        ServiceManager.get('Logger').warn(`[Giveaway] Rollen nicht ladbar: ${err.message}`);
        return [];
    }
}

/**
 * Wer die Anfrage stellt.
 *
 * Bis zum 2026-08-07 stand hier ueberall `req.user?.id`. Diese Eigenschaft
 * setzt im ganzen Dashboard niemand - `createdBy`, `hostedBy` und `addedBy`
 * waren damit ausnahmslos null. Die Anmeldung liegt in der Sitzung.
 *
 * @param {Object} req Express-Anfrage
 * @param {Object} res Express-Antwort
 * @returns {string|null} Discord-ID oder null
 */
function angemeldeterNutzer(req, res) {
    return req.session?.user?.info?.id || res.locals?.user?.id || null;
}

/**
 * Vorgang ueber IPC an den Bot geben und die Antwort einheitlich auswerten.
 *
 * @param {Object} res Express-Antwort
 * @param {string} ereignis IPC-Ereignis
 * @param {Object} nutzlast Daten fuer den Bot
 * @param {string} fehlertext Meldung, falls der Bot nichts Brauchbares liefert
 */
async function ueberBot(res, ereignis, nutzlast, fehlertext) {
    const Logger = ServiceManager.get('Logger');
    const ipcServer = ServiceManager.get('ipcServer');

    if (!ipcServer) {
        return res.status(503).json({ success: false, error: 'Der Bot ist nicht erreichbar' });
    }

    try {
        const antworten = await ipcServer.broadcast(ereignis, nutzlast);
        const ergebnis = antworten?.[0];

        if (ergebnis?.success) {
            return res.json({ success: true, ...ergebnis });
        }
        return res.status(500).json({ success: false, error: ergebnis?.error || fehlertext });
    } catch (error) {
        Logger.error(`[Giveaway] ${ereignis} fehlgeschlagen:`, error);
        return res.status(500).json({ success: false, error: fehlertext });
    }
}

/** Fehlerseite statt eines nackten 500ers. */
function renderFehler(res, error, kontext) {
    const themeManager = ServiceManager.get('themeManager');
    ServiceManager.get('Logger').error(`[Giveaway] ${kontext}:`, error);

    res.locals.layout = themeManager?.getLayout('guild');
    return res.status(500).render('error', {
        status: 500,
        message: 'Giveaway',
        error: { status: 500, title: 'Seite konnte nicht geladen werden', message: kontext, details: error.message }
    });
}

module.exports = {
    makeTranslator, renderView, getGuildChannels, getGuildRoles,
    angemeldeterNutzer, ueberBot, renderFehler
};
