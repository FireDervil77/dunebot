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
    registerArea(areaId, { label, description = '', maxWidgets = null } = {}) {
        if (!areaId || typeof areaId !== 'string') {
            throw new Error('[WidgetManager] registerArea benötigt eine gültige areaId');
        }
        this._areas.set(areaId, { label, description, maxWidgets });
    }

    /**
     * Alle registrierten Bereiche zurückgeben.
     *
     * @returns {Array<{id: string, label: string, description: string, maxWidgets: number|null}>}
     */
    getAreas() {
        return Array.from(this._areas.entries()).map(([id, meta]) => ({ id, ...meta }));
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
        // Index der Guild-Overrides: widget_id → override
        const overrideMap = new Map(guildOverrides.map(o => [o.widget_id, o]));

        return allWidgets
            .map(widget => {
                const registered = this._registeredWidgets.get(widget.id);
                const override = overrideMap.get(widget.id);

                // Bereich bestimmen: Override > Widget-Feld > Registrierung > Fallback
                const area = override?.area ?? widget.area ?? registered?.area ?? 'dashboard-main';

                // Position: Override > Widget-Feld > Registrierung > 999
                const position = override?.position ?? widget.position ?? registered?.position ?? 999;

                // Sichtbarkeit: Override > Widget-Feld > Registrierung > true
                const visible = override?.visible !== undefined
                    ? Boolean(override.visible)
                    : (widget.visible !== undefined ? widget.visible : (registered?.visible !== false));

                return { ...widget, area, position, visible };
            })
            .filter(w => w.area === areaId && w.visible)
            .sort((a, b) => a.position - b.position);
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
    });
    wm.registerArea('dashboard-primary', {
        label: 'Hauptbereich (3-spaltig)',
        description: 'Hauptkennzahlen in drei Spalten nebeneinander',
    });
    wm.registerArea('dashboard-secondary', {
        label: 'Analysebereich (2-spaltig)',
        description: 'Analysekarten und erweiterte Informationen',
    });
    wm.registerArea('dashboard-bottom', {
        label: 'Unten (Vollbreite)',
        description: 'Vollbreite-Karten am Ende des Dashboards',
    });
}

module.exports = { WidgetManager, getInstance };
