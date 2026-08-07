/**
 * Moderation - gemeinsame Helfer der Router
 *
 * @module moderation/routes/_shared
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
    const Logger = ServiceManager.get('Logger');

    return (key, options = {}) => {
        try {
            if (typeof req.translate === 'function') return req.translate(key, options);
            const i18n = ServiceManager.get('i18n');
            if (i18n && i18n.i18next) {
                return i18n.i18next.t(key, { ...options, lng: res.locals?.locale || 'de-DE' });
            }
            return key;
        } catch (err) {
            Logger.error(`[Moderation] Uebersetzungsfehler bei ${key}:`, err);
            return key;
        }
    };
}

/**
 * View ueber den ThemeManager rendern.
 *
 * @param {Object} res Express-Antwort
 * @param {string} viewPath Pfad der View
 * @param {Object} data Daten fuer die View
 */
async function renderView(res, viewPath, data) {
    return await ServiceManager.get('themeManager').renderView(res, viewPath, data);
}

/**
 * Channels der Guild ueber IPC beim Bot erfragen.
 *
 * @param {string} guildId Discord-Guild-ID
 * @returns {Promise<Array>} Channels oder []
 */
async function getGuildChannels(guildId) {
    const ipcServer = ServiceManager.get('ipcServer');
    if (!ipcServer) return [];
    try {
        const antworten = await ipcServer.broadcast('dashboard:GET_GUILD_CHANNELS', { guildId });
        return antworten?.[0]?.channels || [];
    } catch (err) {
        ServiceManager.get('Logger').warn(`[Moderation] Channels nicht ladbar: ${err.message}`);
        return [];
    }
}

/**
 * Rollen der Guild ueber IPC beim Bot erfragen.
 *
 * @param {string} guildId Discord-Guild-ID
 * @returns {Promise<Array>} Rollen oder []
 */
async function getGuildRoles(guildId) {
    const ipcServer = ServiceManager.get('ipcServer');
    if (!ipcServer) return [];
    try {
        const antworten = await ipcServer.broadcast('dashboard:GET_GUILD_ROLES', { guildId, includeAll: true });
        return antworten?.[0]?.roles || [];
    } catch (err) {
        ServiceManager.get('Logger').warn(`[Moderation] Rollen nicht ladbar: ${err.message}`);
        return [];
    }
}

/** Standardwerte, solange eine Guild noch keine Einstellungen gespeichert hat. */
const STANDARD_EINSTELLUNGEN = {
    modlog_channel: null,
    max_warn_limit: 5,
    max_warn_action: 'KICK',
    modlog_events: '["WARN","KICK","BAN","TIMEOUT","UNTIMEOUT","SOFTBAN","UNBAN"]',
    dm_on_warn: 1,
    dm_on_kick: 1,
    dm_on_ban: 1,
    dm_on_timeout: 1,
    default_reason: null,
    dm_embed_description: null
};

/**
 * Einstellungen einer Guild laden, mit Rueckfall auf die Standardwerte.
 *
 * @param {string} guildId Discord-Guild-ID
 * @returns {Promise<Object>} Einstellungen
 */
async function getSettings(guildId) {
    const dbService = ServiceManager.get('dbService');
    const zeilen = await dbService.query('SELECT * FROM moderation_settings WHERE guild_id = ?', [guildId]);
    return zeilen[0] || { ...STANDARD_EINSTELLUNGEN };
}

/**
 * Fehlerseite statt eines nackten 500ers.
 *
 * @param {Object} res Express-Antwort
 * @param {Error} error Der aufgetretene Fehler
 * @param {string} kontext Wobei es schiefging
 */
function renderFehler(res, error, kontext) {
    const themeManager = ServiceManager.get('themeManager');
    ServiceManager.get('Logger').error(`[Moderation] ${kontext}:`, error);

    res.locals.layout = themeManager?.getLayout('guild');
    return res.status(500).render('error', {
        status: 500,
        message: 'Moderation',
        error: { status: 500, title: 'Seite konnte nicht geladen werden', message: kontext, details: error.message }
    });
}

/** Fehler einer JSON-Route einheitlich melden. */
function fehler(res, error, text, status = 500) {
    ServiceManager.get('Logger').error(`[Moderation] ${text}:`, error);
    res.status(status).json({ success: false, error: text });
}

module.exports = {
    makeTranslator, renderView, getGuildChannels, getGuildRoles,
    getSettings, renderFehler, fehler, STANDARD_EINSTELLUNGEN
};
