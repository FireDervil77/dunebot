/**
 * Greeting - gemeinsame Helfer der Router
 *
 * Das Laden und Aufbereiten der Einstellungen stand bis zum 2026-08-07 als
 * ~230 Zeilen mitten in der einen Seitenroute. Jetzt steht es einmal hier und
 * bedient alle Seiten des Bereichs.
 *
 * @module greeting/routes/_shared
 */

const { ServiceManager } = require('dunebot-core');

/** Ein leeres Embed - Grundform fuer alle vier Nachrichtenarten. */
const LEERES_EMBED = () => ({
    title: null,
    description: null,
    color: null,
    thumbnail: null,
    image: null,
    fields: [],
    author: { name: null, iconURL: null },
    footer: { text: null, iconURL: null },
    timestamp: false
});

/** Standardwerte, solange eine Guild noch nichts gespeichert hat. */
const STANDARD = {
    welcome_enabled: false, welcome_channel: null, welcome_content: null, welcome_embed: null,
    farewell_enabled: false, farewell_channel: null, farewell_content: null, farewell_embed: null,
    autorole_id: null, autorole_ids: null,
    dm_welcome_enabled: false, dm_welcome_content: null, dm_welcome_embed: null,
    welcome_image_enabled: false, welcome_image_bg: 'default', welcome_image_text: null, welcome_image_color: '#5865f2',
    boost_enabled: false, boost_channel: null, boost_content: null, boost_embed: null
};

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

/**
 * Ein Embed-Feld lesen, das als JSON-Text oder als Objekt vorliegen kann.
 *
 * @param {*} roh Wert aus der Datenbank
 * @returns {Object} Embed
 */
function leseEmbed(roh) {
    if (!roh) return LEERES_EMBED();
    if (typeof roh === 'object') return roh;
    try {
        return JSON.parse(roh) || LEERES_EMBED();
    } catch {
        return LEERES_EMBED();
    }
}

/**
 * Alles laden, was die Greeting-Seiten brauchen.
 *
 * @param {string} guildId Discord-Guild-ID
 * @returns {Promise<Object>} { settings, channels, roles, inviteMappings, reactionPanels }
 */
async function ladeDaten(guildId) {
    const dbService = ServiceManager.get('dbService');
    const ipcServer = ServiceManager.get('ipcServer');
    const Logger = ServiceManager.get('Logger');

    // Channels und Rollen kommen vom Bot; antwortet er nicht, bleiben die
    // Auswahllisten leer, die Seite laedt trotzdem.
    let channels = [];
    let roles = [];
    if (ipcServer) {
        try {
            const [kanalAntwort, rollenAntwort] = await Promise.all([
                ipcServer.broadcast('dashboard:GET_GUILD_CHANNELS', { guildId }),
                ipcServer.broadcast('dashboard:GET_GUILD_ROLES', { guildId })
            ]);
            channels = kanalAntwort?.[0]?.channels || [];
            roles = rollenAntwort?.[0]?.roles || [];
        } catch (err) {
            Logger.warn(`[Greeting] Bot nicht erreichbar: ${err.message}`);
        }
    }

    const zeilen = await dbService.query('SELECT * FROM greeting_settings WHERE guild_id = ?', [guildId]);
    const roh = zeilen[0] || { ...STANDARD };

    // Autorollen: neue Mehrfachliste, mit Rueckfall auf das alte Einzelfeld
    let autoroleIds = [];
    if (roh.autorole_ids) {
        try {
            const gelesen = typeof roh.autorole_ids === 'string' ? JSON.parse(roh.autorole_ids) : roh.autorole_ids;
            if (Array.isArray(gelesen)) autoroleIds = gelesen;
        } catch { /* unlesbar - dann eben leer */ }
    }
    if (autoroleIds.length === 0 && roh.autorole_id) {
        autoroleIds = [roh.autorole_id];
    }

    const settings = {
        welcome: {
            enabled: Boolean(roh.welcome_enabled),
            channel: roh.welcome_channel || '',
            content: roh.welcome_content || '',
            embed: leseEmbed(roh.welcome_embed)
        },
        farewell: {
            enabled: Boolean(roh.farewell_enabled),
            channel: roh.farewell_channel || '',
            content: roh.farewell_content || '',
            embed: leseEmbed(roh.farewell_embed)
        },
        dm_welcome: {
            enabled: Boolean(roh.dm_welcome_enabled),
            content: roh.dm_welcome_content || '',
            embed: leseEmbed(roh.dm_welcome_embed)
        },
        autorole_id: roh.autorole_id || '',
        autorole_ids: autoroleIds,
        welcome_image: {
            enabled: Boolean(roh.welcome_image_enabled),
            bg: roh.welcome_image_bg || 'default',
            text: roh.welcome_image_text || '',
            color: roh.welcome_image_color || '#5865f2'
        },
        boost: {
            enabled: Boolean(roh.boost_enabled),
            channel: roh.boost_channel || '',
            content: roh.boost_content || '',
            embed: leseEmbed(roh.boost_embed)
        },
        verification: {
            enabled: Boolean(roh.verification_enabled),
            channel: roh.verification_channel || '',
            role_id: roh.verification_role_id || '',
            type: roh.verification_type || 'button',
            message: roh.verification_message || '',
            remove_role_id: roh.verification_remove_role_id || '',
            emoji: roh.verification_emoji || '✅',
            success_message: roh.verification_success_message || ''
        }
    };

    // Einladungszuordnungen und Reaktionstafeln - beide Tabellen koennen in
    // einer alten Guild noch fehlen.
    let inviteMappings = [];
    try {
        inviteMappings = await dbService.query(
            'SELECT * FROM greeting_invite_mappings WHERE guild_id = ? ORDER BY created_at DESC',
            [guildId]
        );
    } catch { /* Tabelle noch nicht angelegt */ }

    let reactionPanels = [];
    try {
        const tafeln = await dbService.query(
            'SELECT * FROM greeting_reaction_panels WHERE guild_id = ? ORDER BY created_at DESC',
            [guildId]
        );

        if (tafeln.length > 0) {
            // Eine Abfrage statt einer je Tafel
            const ids = tafeln.map(t => t.id);
            const platzhalter = ids.map(() => '?').join(',');
            const zuordnungen = await dbService.query(
                `SELECT * FROM greeting_reaction_roles WHERE panel_id IN (${platzhalter})`,
                ids
            );

            const nachTafel = {};
            zuordnungen.forEach(z => {
                (nachTafel[z.panel_id] = nachTafel[z.panel_id] || []).push({
                    ...z,
                    role_name: roles.find(r => String(r.id) === String(z.role_id))?.name || z.role_id
                });
            });

            tafeln.forEach(t => { t.mappings = nachTafel[t.id] || []; });
        }
        reactionPanels = tafeln;
    } catch { /* Tabellen noch nicht angelegt */ }

    return { settings, channels, roles, inviteMappings, reactionPanels };
}

/** Fehlerseite statt eines nackten 500ers. */
function renderFehler(res, error, kontext) {
    const themeManager = ServiceManager.get('themeManager');
    ServiceManager.get('Logger').error(`[Greeting] ${kontext}:`, error);

    res.locals.layout = themeManager?.getLayout('guild');
    return res.status(500).render('error', {
        status: 500,
        message: 'Greeting',
        error: { status: 500, title: 'Seite konnte nicht geladen werden', message: kontext, details: error.message }
    });
}

module.exports = { makeTranslator, renderView, ladeDaten, renderFehler, LEERES_EMBED };
