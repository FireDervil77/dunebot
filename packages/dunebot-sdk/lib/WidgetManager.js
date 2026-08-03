'use strict';

/**
 * WidgetManager — WordPress-ähnliches Widget-Area-System für das DuneBot Dashboard
 *
 * Konzept:
 *  - Widget-Bereiche (Areas) werden ähnlich wie WP-Sidebars registriert
 *  - Widgets werden Bereichen zugeordnet (per `area`-Feld)
 *  - Pro Guild können Sichtbarkeit und Reihenfolge angepasst werden (DB)
 *  - Rückwärtskompatibel: Widgets ohne `area` landen in `dashboard-main`
 *
 * @author FireDervil
 * @version 1.0.0
 */

const { ServiceManager } = require('dunebot-core');

class WidgetManager {
    constructor() {
        /** @type {Map<string, {label: string, description: string, maxWidgets: number|null}>} */
        this._areas = new Map();

        /**
         * Bereiche, die ein Theme selbst mitbringt.
         * Meldet ein Theme eigene an, gelten **nur** seine — es bestimmt sein
         * Layout, nicht der Kern.
         * @type {Map<string, Map<string, object>>} Theme-Name → Bereiche
         */
        this._themeAreas = new Map();

        /** @type {Map<string, {id: string, area: string, position: number, size: number, visible: boolean}>} */
        this._registeredWidgets = new Map();
    }

    // =========================================
    // AREAS
    // =========================================

    /**
     * Einen Widget-Bereich registrieren (wie register_sidebar in WordPress).
     *
     * @param {string} areaId - Einzigartiger Bereich-Bezeichner (z.B. 'dashboard-main')
     * @param {object} options
     * @param {string} options.label - Anzeigename (für Admin-UI)
     * @param {string} [options.description] - Kurze Beschreibung
     * @param {number|null} [options.maxWidgets] - Max. Anzahl Widgets (null = unbegrenzt)
     * @returns {void}
     */
    registerArea(areaId, { label, description = '', maxWidgets = null, defaultSize = 12, screen = 'guild' } = {}) {
        if (!areaId || typeof areaId !== 'string') {
            throw new Error('[WidgetManager] registerArea benötigt eine gültige areaId');
        }
        this._areas.set(areaId, { label, description, maxWidgets, defaultSize, screen });
    }

    /**
     * Einen Bereich für ein bestimmtes Theme anmelden (wie register_sidebar
     * in der functions.php eines Themes).
     *
     * @param {string} themeName
     * @param {string} areaId
     * @param {object} options - wie bei registerArea
     */
    registerAreaFor(themeName, areaId, options = {}) {
        if (!this._themeAreas.has(themeName)) {
            this._themeAreas.set(themeName, new Map());
        }
        const { label, description = '', maxWidgets = null, defaultSize = 12, screen = 'guild' } = options;
        this._themeAreas.get(themeName).set(areaId, { label, description, maxWidgets, defaultSize, screen });
    }

    /**
     * Fassade für ein Theme — `registerArea` landet automatisch bei ihm.
     *
     * @param {string} themeName
     * @returns {{registerArea: Function}}
     */
    fuerTheme(themeName) {
        return {
            registerArea: (areaId, options) => this.registerAreaFor(themeName, areaId, options)
        };
    }

    /**
     * Bereiche eines Themes — oder die Standardbereiche, wenn es keine eigenen
     * mitbringt.
     *
     * @param {string} [themeName]
     * @returns {Array<{id: string, label: string, description: string, maxWidgets: number|null, defaultSize: number}>}
     */
    getAreas(themeName = null, screen = null) {
        const eigene = themeName ? this._themeAreas.get(themeName) : null;

        // Ein Theme, das eigene Bereiche mitbringt, ersetzt die Vorgaben — aber
        // nur für die Bildschirme, die es auch bedient. Sagt es nichts über den
        // Adminbereich, gelten dort weiter die Standardbereiche.
        const zusammen = new Map(this._areas);
        if (eigene && eigene.size > 0) {
            const bedient = new Set([...eigene.values()].map(m => m.screen || 'guild'));
            for (const [id, meta] of this._areas) {
                if (bedient.has(meta.screen || 'guild')) zusammen.delete(id);
            }
            for (const [id, meta] of eigene) zusammen.set(id, meta);
        }

        return Array.from(zusammen.entries())
            .map(([id, meta]) => ({ id, ...meta }))
            .filter(a => !screen || (a.screen || 'guild') === screen);
    }

    // =========================================
    // WIDGETS REGISTRIEREN
    // =========================================

    /**
     * Widget mit Standard-Metadaten registrieren.
     * Cores und Plugins können eigene Widgets deklarieren.
     *
     * @param {string} id - Einzigartiger Widget-Bezeichner
     * @param {object} defaults
     * @param {string} defaults.area - Standard-Bereich (z.B. 'dashboard-primary')
     * @param {number} [defaults.position] - Standard-Position im Bereich (10er-Schritte)
     * @param {number} [defaults.size] - Bootstrap-Spaltenbreite (1-12)
     * @param {boolean} [defaults.visible] - Standard-Sichtbarkeit
     */
    registerWidget(id, defaults = {}) {
        if (!id || typeof id !== 'string') {
            throw new Error('[WidgetManager] registerWidget benötigt eine gültige id');
        }
        this._registeredWidgets.set(id, {
            id,
            area: defaults.area || 'dashboard-main',
            position: defaults.position ?? 10,
            size: defaults.size ?? 12,
            visible: defaults.visible !== false,
        });
    }

    /**
     * Standard-Metadaten eines Widgets zurückgeben.
     *
     * @param {string} id
     * @returns {{id, area, position, size, visible}|null}
     */
    getRegisteredWidget(id) {
        return this._registeredWidgets.get(id) || null;
    }

    // =========================================
    // WIDGETS FÜR EINEN BEREICH ABRUFEN
    // =========================================

    /**
     * Widgets für einen bestimmten Bereich filtern und sortieren.
     * Berücksichtigt Guild-spezifische Overrides aus der DB (falls vorhanden).
     *
     * @param {string} areaId - Widget-Bereich (z.B. 'dashboard-primary')
     * @param {Array<object>} allWidgets - Alle vom Hook-System gesammelten Widgets
     * @param {Array<object>} [guildOverrides] - Guild-spezifische Config aus DB ([{widget_id, area, position, visible}])
     * @returns {Array<object>} Sortierte, sichtbare Widgets für diesen Bereich
     */
    getWidgetsForArea(areaId, allWidgets, guildOverrides = []) {
        return this.resolveWidgets(allWidgets, guildOverrides)
            .filter(w => w.area === areaId && w.visible)
            .sort((a, b) => a.position - b.position);
    }

    /**
     * Alle Widgets mit ihren **wirksamen** Werten — ohne zu filtern.
     *
     * Wird für die Ansicht-anpassen-Klappe gebraucht: Dort müssen auch die
     * ausgeblendeten auftauchen, sonst kommt man nicht mehr an sie heran.
     *
     * Kaskade: Guild-Override > Feld am Widget > Registrierung > Vorgabe.
     *
     * @param {Array<object>} allWidgets
     * @param {Array<object>} [guildOverrides]
     * @returns {Array<object>}
     */
    resolveWidgets(allWidgets, guildOverrides = []) {
        const overrideMap = new Map((guildOverrides || []).map(o => [o.widget_id, o]));

        return (allWidgets || []).map(widget => {
            const registered = this._registeredWidgets.get(widget.id);
            const override = overrideMap.get(widget.id);

            const area = override?.area ?? widget.area ?? registered?.area ?? 'dashboard-main';
            const position = override?.position ?? widget.position ?? registered?.position ?? 999;
            const visible = override?.visible !== undefined
                ? Boolean(override.visible)
                : (widget.visible !== undefined ? widget.visible : (registered?.visible !== false));

            return { ...widget, area, position, visible };
        });
    }

    // =========================================
    // GUILD-WIDGET-CONFIG AUS DB
    // =========================================

    /**
     * Guild-spezifische Widget-Konfiguration aus der DB laden.
     *
     * @param {string} guildId
     * @returns {Promise<Array<{widget_id, area, position, visible}>>}
     */
    async getGuildWidgetConfig(guildId) {
        try {
            const dbService = ServiceManager.get('dbService');
            if (!dbService) return [];

            const rows = await dbService.query(
                'SELECT widget_id, area, position, visible FROM guild_widget_config WHERE guild_id = ?',
                [guildId]
            );
            return rows || [];
        } catch (err) {
            const Logger = ServiceManager.get('Logger');
            Logger?.warn('[WidgetManager] Fehler beim Laden der Widget-Config (Tabelle existiert ggf. noch nicht):', err.message);
            return [];
        }
    }

    /**
     * Widget-Config für eine Guild aktualisieren (Upsert).
     *
     * @param {string} guildId
     * @param {string} widgetId
     * @param {{area?: string, position?: number, visible?: boolean}} config
     * @returns {Promise<void>}
     */
    async setGuildWidgetConfig(guildId, widgetId, config = {}) {
        const dbService = ServiceManager.get('dbService');
        if (!dbService) throw new Error('[WidgetManager] dbService nicht verfügbar');

        const { area, position, visible } = config;
        await dbService.query(
            `INSERT INTO guild_widget_config (guild_id, widget_id, area, position, visible)
             VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
               area = COALESCE(VALUES(area), area),
               position = COALESCE(VALUES(position), position),
               visible = COALESCE(VALUES(visible), visible)`,
            [guildId, widgetId, area ?? null, position ?? null, visible !== undefined ? (visible ? 1 : 0) : null]
        );
    }

    /**
     * Widget-Config einer Guild zurücksetzen (alle oder einzelnes Widget).
     *
     * @param {string} guildId
     * @param {string|null} [widgetId] - null = alle Widgets dieser Guild zurücksetzen
     * @returns {Promise<void>}
     */
    async resetGuildWidgetConfig(guildId, widgetId = null) {
        const dbService = ServiceManager.get('dbService');
        if (!dbService) throw new Error('[WidgetManager] dbService nicht verfügbar');

        if (widgetId) {
            await dbService.query(
                'DELETE FROM guild_widget_config WHERE guild_id = ? AND widget_id = ?',
                [guildId, widgetId]
            );
        } else {
            await dbService.query(
                'DELETE FROM guild_widget_config WHERE guild_id = ?',
                [guildId]
            );
        }
    }
}

// Singleton
let _instance = null;

/**
 * WidgetManager-Singleton holen oder erstellen.
 * @returns {WidgetManager}
 */
function getInstance() {
    if (!_instance) {
        _instance = new WidgetManager();
        _registerDefaultAreas(_instance);
    }
    return _instance;
}

/**
 * Standard Widget-Bereiche für das Guild-Dashboard registrieren.
 * @param {WidgetManager} wm
 */
function _registerDefaultAreas(wm) {
    wm.registerArea('dashboard-top', {
        label: 'Oben (Vollbreite)',
        description: 'Benachrichtigungen und Warnungen über dem Hauptinhalt',
        defaultSize: 12
    });
    wm.registerArea('dashboard-primary', {
        label: 'Hauptbereich (3-spaltig)',
        description: 'Hauptkennzahlen in drei Spalten nebeneinander',
        defaultSize: 4
    });
    wm.registerArea('dashboard-secondary', {
        label: 'Analysebereich (2-spaltig)',
        description: 'Analysekarten und erweiterte Informationen',
        defaultSize: 6
    });
    wm.registerArea('dashboard-bottom', {
        label: 'Unten (Vollbreite)',
        description: 'Vollbreite-Karten am Ende des Dashboards',
        defaultSize: 12
    });

    // --- Adminbereich: eigene Bereiche, eigener Bildschirm -------------------
    wm.registerArea('admin-top', {
        label: 'Admin — Oben (Vollbreite)',
        description: 'Hinweise über dem Inhalt',
        defaultSize: 12, screen: 'admin'
    });
    wm.registerArea('admin-stats', {
        label: 'Admin — Kennzahlen (4-spaltig)',
        description: 'Zahlen auf einen Blick',
        defaultSize: 3, screen: 'admin'
    });
    wm.registerArea('admin-primary', {
        label: 'Admin — Hauptbereich (3-spaltig)',
        description: 'Einstiege und Verknüpfungen',
        defaultSize: 4, screen: 'admin'
    });
    wm.registerArea('admin-bottom', {
        label: 'Admin — Unten (Vollbreite)',
        description: 'Abschließende Karten',
        defaultSize: 12, screen: 'admin'
    });
}

module.exports = { WidgetManager, getInstance };
