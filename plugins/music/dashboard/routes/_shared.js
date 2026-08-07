/**
 * Musik - gemeinsame Helfer der Router
 *
 * Alles, was mit dem laufenden Ton zu tun hat, lebt im Bot-Vorgang. Das
 * Dashboard kommt nur ueber IPC daran - deshalb steht die Bruecke hier
 * einmal und nicht in jeder Route.
 *
 * @module music/dashboard/routes/_shared
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
        ServiceManager.get('Logger').warn(`[Musik] Channels nicht ladbar: ${err.message}`);
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
        ServiceManager.get('Logger').warn(`[Musik] Rollen nicht ladbar: ${err.message}`);
        return [];
    }
}

/**
 * Was gerade laeuft.
 *
 * Antwortet der Bot nicht, liefern wir einen leeren Zustand statt eines
 * Fehlers - die Seite soll auch dann aufgehen, wenn der Bot gerade neu
 * startet.
 *
 * @param {string} guildId Discord-Guild-ID
 * @returns {Promise<Object>} Zustand
 */
async function zustandHolen(guildId) {
    const ipcServer = ServiceManager.get('ipcServer');

    const leer = {
        guildId, verbunden: false, sprachKanalId: null, aktuell: null,
        pausiert: false, lautstaerke: 50, wiederholung: 'aus', filter: 'aus',
        qualitaet: 2, dauerbetrieb: false, autoplay: false, stimmen: 0,
        warteschlange: [], warteschlangeLaenge: 0, restspielzeitSek: 0,
        botErreichbar: false
    };

    if (!ipcServer) return leer;

    try {
        const antworten = await ipcServer.broadcast('music:getState', { guildId });
        const antwort = antworten?.[0];
        if (!antwort?.success) return leer;
        return { ...antwort.zustand, botErreichbar: true };
    } catch (err) {
        ServiceManager.get('Logger').warn(`[Musik] Zustand nicht abrufbar: ${err.message}`);
        return leer;
    }
}

/**
 * Einen Steuerbefehl an den Bot geben.
 *
 * @param {Object} res Express-Antwort
 * @param {string} guildId Discord-Guild-ID
 * @param {string} vorgang Was getan werden soll
 * @param {*} [wert] Beiwert
 */
async function steuern(res, guildId, vorgang, wert = null) {
    const ipcServer = ServiceManager.get('ipcServer');

    if (!ipcServer) {
        return res.status(503).json({ success: false, error: 'Der Bot ist nicht erreichbar' });
    }

    try {
        const antworten = await ipcServer.broadcast('music:control', { guildId, vorgang, wert });
        const antwort = antworten?.[0];

        if (!antwort?.success) {
            return res.status(400).json({ success: false, error: antwort?.error || 'Die Aktion ist fehlgeschlagen' });
        }
        return res.json({ success: true, ...antwort });
    } catch (error) {
        ServiceManager.get('Logger').error(`[Musik] Steuerbefehl ${vorgang} fehlgeschlagen:`, error);
        return res.status(500).json({ success: false, error: 'Die Aktion ist fehlgeschlagen' });
    }
}

/** Wer die Anfrage stellt. */
function angemeldeterNutzer(req, res) {
    return req.session?.user?.info?.id || res.locals?.user?.id || null;
}

/** Fehlerseite statt eines nackten 500ers. */
function renderFehler(res, error, kontext) {
    const themeManager = ServiceManager.get('themeManager');
    ServiceManager.get('Logger').error(`[Musik] ${kontext}:`, error);

    res.locals.layout = themeManager?.getLayout('guild');
    return res.status(500).render('error', {
        status: 500,
        message: 'Musik',
        error: { status: 500, title: 'Seite konnte nicht geladen werden', message: kontext, details: error.message }
    });
}

/** Fehler einer JSON-Route einheitlich melden. */
function fehler(res, error, text, status = 500) {
    ServiceManager.get('Logger').error(`[Musik] ${text}:`, error);
    res.status(status).json({ success: false, error: text });
}

/**
 * Sekunden als "1 Std. 4 Min." - fuer Spielzeiten in den Views.
 *
 * @param {number} sek Sekunden
 * @returns {string} Text
 */
function spielzeitText(sek) {
    if (!sek || sek <= 0) return '—';
    const stunden = Math.floor(sek / 3600);
    const minuten = Math.round((sek % 3600) / 60);
    return stunden > 0 ? `${stunden} Std. ${minuten} Min.` : `${minuten} Min.`;
}

module.exports = {
    makeTranslator, renderView, getGuildChannels, getGuildRoles,
    zustandHolen, steuern, angemeldeterNutzer, renderFehler, fehler, spielzeitText
};
