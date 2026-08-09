/**
 * Discord — gemeinsame Helfer der Router
 *
 * Nach dem Vorbild von `automod/dashboard/routes/_shared.js`.
 *
 * @module discord/routes/_shared
 */

const { ServiceManager } = require('dunebot-core');

/**
 * View über den ThemeManager rendern.
 *
 * @param {Object} res Express-Antwort
 * @param {string} viewPath Pfad der View, z.B. 'guild/discord-roles'
 * @param {Object} data Daten für die View
 */
async function renderView(res, viewPath, data) {
    const themeManager = ServiceManager.get('themeManager');
    return await themeManager.renderView(res, viewPath, data);
}

/**
 * Ein `dashboard:`-Ereignis beim Bot abfragen.
 *
 * Achtung, hier steckt eine bekannte Falle: Plugin-Ereignisse antworten mit
 * einer doppelten Hülle (`{ success, data: { … } }`), `dashboard:`-Ereignisse
 * nicht. Der Kern-Router hat beide Formen behandelt, weil sich nie jemand
 * sicher war. Diese Funktion tut dasselbe an einer Stelle statt an fünf:
 * erst die innere Hülle versuchen, dann die äußere.
 *
 * Zurück kommt die ausgepackte Nutzlast — auch im Fehlerfall, damit der
 * Aufrufer die Begründung des Bots (`.error`) weitergeben kann.
 *
 * @param {string} ereignis Name des IPC-Ereignisses, z.B. 'dashboard:GET_GUILD_ROLES_DETAILED'
 * @param {Object} nutzlast Daten für den Bot
 * @returns {Promise<Object|null>} Ausgepackte Antwort oder null, wenn der Bot schweigt
 */
async function fragBot(ereignis, nutzlast) {
    const Logger = ServiceManager.get('Logger');
    const ipcServer = ServiceManager.get('ipcServer');

    if (!ipcServer) {
        Logger.warn(`[Discord] Kein IPC-Server verfügbar für ${ereignis}`);
        return null;
    }

    try {
        const antworten = await ipcServer.broadcast(ereignis, nutzlast);
        const antwort = Array.isArray(antworten) && antworten.length > 0 ? antworten[0] : null;
        if (!antwort) return null;

        return antwort.data ?? antwort;
    } catch (err) {
        Logger.error(`[Discord] IPC-Aufruf ${ereignis} fehlgeschlagen:`, err);
        return null;
    }
}

/**
 * Fehlerseite statt eines nackten 500ers.
 *
 * @param {Object} res Express-Antwort
 * @param {Error} error Der aufgetretene Fehler
 * @param {string} kontext Wobei es schiefging (für das Log)
 */
function renderFehler(res, error, kontext) {
    const Logger = ServiceManager.get('Logger');
    const themeManager = ServiceManager.get('themeManager');

    Logger.error(`[Discord] ${kontext}:`, error);

    res.locals.layout = themeManager?.getLayout('guild');
    return res.status(500).render('error', {
        status: 500,
        message: 'Discord',
        error: {
            status: 500,
            title: 'Seite konnte nicht geladen werden',
            message: kontext,
            details: error.message
        }
    });
}

/**
 * Einheitliche JSON-Fehlerantwort.
 *
 * @param {Object} res Express-Antwort
 * @param {Error} error Der aufgetretene Fehler
 * @param {string} nachricht Klartext für den Nutzer
 * @param {number} [status=500] HTTP-Status
 */
function fehler(res, error, nachricht, status = 500) {
    ServiceManager.get('Logger').error(`[Discord] ${nachricht}:`, error);
    return res.status(status).json({ success: false, message: nachricht });
}

module.exports = { renderView, fragBot, renderFehler, fehler };
