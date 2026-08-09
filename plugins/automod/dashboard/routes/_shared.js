/**
 * AutoMod - gemeinsame Helfer der Router
 *
 * Die Uebersetzungsfunktion und der renderView-Aufruf standen bis zum
 * 2026-08-07 in jeder einzelnen Route noch einmal wortgleich drin. Hier
 * stehen sie einmal.
 *
 * @module automod/routes/_shared
 */

const { ServiceManager, KanalTypen } = require('dunebot-core');

/**
 * Uebersetzungsfunktion fuer eine Anfrage.
 *
 * Bevorzugt `req.translate` (kennt die Sprache des Nutzers), faellt auf den
 * i18n-Dienst zurueck und liefert im Notfall den Schluessel selbst - eine
 * fehlende Uebersetzung soll die Seite nicht abbrechen.
 *
 * @param {Object} req Express-Anfrage
 * @param {Object} res Express-Antwort
 * @returns {Function} tr(key, options)
 */
function makeTranslator(req, res) {
    const Logger = ServiceManager.get('Logger');

    return (key, options = {}) => {
        try {
            if (typeof req.translate === 'function') {
                return req.translate(key, options);
            }
            const i18n = ServiceManager.get('i18n');
            if (i18n && i18n.i18next) {
                return i18n.i18next.t(key, { ...options, lng: res.locals?.locale || 'de-DE' });
            }
            return key;
        } catch (err) {
            Logger.error(`[AutoMod] Uebersetzungsfehler bei ${key}:`, err);
            return key;
        }
    };
}

/**
 * View ueber den ThemeManager rendern.
 *
 * @param {Object} res Express-Antwort
 * @param {string} viewPath Pfad der View, z.B. 'guild/automod-filter'
 * @param {Object} data Daten fuer die View
 */
async function renderView(res, viewPath, data) {
    const themeManager = ServiceManager.get('themeManager');
    return await themeManager.renderView(res, viewPath, data);
}

/**
 * Channels der Guild ueber IPC beim Bot erfragen.
 *
 * Der Bot ist ein eigener Prozess. Antwortet er nicht, liefern wir eine leere
 * Liste - die Views zeigen dann das Eingabefeld fuer die Channel-ID statt der
 * Auswahlliste.
 *
 * **Kanaltypen, seit dem 2026-08-09:** Die Auswahllisten von AutoMod dienen
 * zwei Zwecken, und die richtige Menge haengt vom Zweck ab.
 *
 *   - `MODERIERBARE_TYPEN` fuer Whitelist und Ausnahmen. `messageCreate`
 *     filtert nicht nach Kanaltyp - der Chat eines Sprachkanals wird also
 *     moderiert. Bis dahin liess er sich aber nicht ausnehmen, weil die Liste
 *     nur Textkanaele kannte. Was ueberwacht wird, muss ausnehmbar sein.
 *   - `BESCHREIBBARE_TYPEN` fuer Zielfelder wie Log- und Alarmkanal. Dort
 *     schreibt der Bot hin, ein Forum oder eine Buehne waere sinnlos.
 *
 * @param {string} guildId Discord-Guild-ID
 * @param {number[]} [typen] Gewuenschte Kanaltypen, Vorgabe: alle moderierbaren
 * @returns {Promise<Array>} Channels oder []
 */
async function getGuildChannels(guildId, typen = KanalTypen.MODERIERBARE_TYPEN) {
    const Logger = ServiceManager.get('Logger');
    const ipcServer = ServiceManager.get('ipcServer');
    if (!ipcServer) return [];

    try {
        const antworten = await ipcServer.broadcast('dashboard:GET_GUILD_CHANNELS', {
            guildId,
            types: typen
        });
        return antworten?.[0]?.channels || [];
    } catch (err) {
        Logger.warn(`[AutoMod] Channels konnten nicht geladen werden: ${err.message}`);
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
    const Logger = ServiceManager.get('Logger');
    const ipcServer = ServiceManager.get('ipcServer');
    if (!ipcServer) return [];

    try {
        const antworten = await ipcServer.broadcast('dashboard:GET_GUILD_ROLES', { guildId, includeAll: true });
        return antworten?.[0]?.roles || [];
    } catch (err) {
        Logger.warn(`[AutoMod] Rollen konnten nicht geladen werden: ${err.message}`);
        return [];
    }
}

/**
 * Fehlerseite statt eines nackten 500ers.
 *
 * @param {Object} res Express-Antwort
 * @param {Error} error Der aufgetretene Fehler
 * @param {string} kontext Wobei es schiefging (fuer das Log)
 */
function renderFehler(res, error, kontext) {
    const Logger = ServiceManager.get('Logger');
    const themeManager = ServiceManager.get('themeManager');

    Logger.error(`[AutoMod] ${kontext}:`, error);

    res.locals.layout = themeManager?.getLayout('guild');
    return res.status(500).render('error', {
        status: 500,
        message: 'AutoMod',
        error: {
            status: 500,
            title: 'Seite konnte nicht geladen werden',
            message: kontext,
            details: error.message
        }
    });
}

/**
 * Einheitliche JSON-Fehlerantwort fuer die schreibenden Routen.
 *
 * `renderFehler` daneben liefert eine ganze Fehlerseite - das passt fuer
 * Seitenaufrufe, nicht fuer Aufrufe aus dem Browser-Skript heraus.
 *
 * @param {Object} res Express-Antwort
 * @param {Error} error Der aufgetretene Fehler
 * @param {string} nachricht Klartext fuer den Nutzer
 * @param {number} [status=500] HTTP-Status
 */
function fehler(res, error, nachricht, status = 500) {
    ServiceManager.get('Logger').error(`[AutoMod] ${nachricht}:`, error);
    return res.status(status).json({ success: false, message: nachricht });
}

module.exports = { makeTranslator, renderView, getGuildChannels, getGuildRoles, renderFehler, fehler };
