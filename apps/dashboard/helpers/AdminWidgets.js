'use strict';

/**
 * AdminWidgets — die Kern-Widgets des Adminbereichs
 *
 * Gegenstück zu `KernWidgets` für das Guild-Dashboard. Was vorher als fester
 * Block in `admin/dashboard.ejs` stand, ist jetzt eine Reihe von Widgets: Sie
 * lassen sich verschieben, ausblenden und — der eigentliche Zweck — Plugins
 * können sich über den Filter `admin_dashboard_widgets` danebenstellen.
 *
 * Bereiche (siehe WidgetManager, screen: 'admin'):
 *   admin-top     — Vollbreite, Hinweise
 *   admin-stats   — 4-spaltig, Zahlen
 *   admin-primary — 3-spaltig, Einstiege
 *   admin-bottom  — Vollbreite
 *
 * @author FireDervil
 */

const { ServiceManager } = require('dunebot-core');

/** Die vier Zahlen oben. */
const KENNZAHLEN = [
    { id: 'admin-stat-guilds',        schluessel: 'guilds',        titel: 'Guilds',         beschriftung: 'Registrierte Server',        icon: 'fa-solid fa-server' },
    { id: 'admin-stat-users',         schluessel: 'users',         titel: 'Benutzer',       beschriftung: 'Registrierte Benutzer',      icon: 'fa-solid fa-users' },
    { id: 'admin-stat-news',          schluessel: 'news',          titel: 'News',           beschriftung: 'Veröffentlichte Beiträge',   icon: 'fa-solid fa-newspaper' },
    { id: 'admin-stat-notifications', schluessel: 'notifications', titel: 'Meldungen',      beschriftung: 'Gesendete Benachrichtigungen', icon: 'fa-solid fa-bell' }
];

/** Die Einstiege darunter. */
const EINSTIEGE = [
    {
        id: 'admin-shortcut-news', titel: 'News verwalten', icon: 'fa-solid fa-newspaper',
        text: 'Erstelle und bearbeite globale News für alle Guilds.',
        url: '/admin/content?tab=news', knopf: 'News öffnen',
        knopfKlasse: 'btn-primary', knopfIcon: 'fa-solid fa-newspaper'
    },
    {
        id: 'admin-shortcut-notifications', titel: 'Meldungen senden', icon: 'fa-solid fa-bell',
        text: 'Sende globale Benachrichtigungen an alle oder einzelne Guilds.',
        url: '/admin/content?tab=notifications', knopf: 'Meldungen',
        knopfKlasse: 'btn-warning', knopfIcon: 'fa-solid fa-bell'
    },
    {
        id: 'admin-shortcut-stats', titel: 'Systemzahlen', icon: 'fa-solid fa-chart-line',
        text: 'Ausführliche Statistiken über das gesamte Bot-System.',
        url: '/admin/stats', knopf: 'Statistiken',
        knopfKlasse: 'btn-info', knopfIcon: 'fa-solid fa-chart-line'
    }
];

/**
 * Kern-Widgets des Adminbereichs anmelden.
 *
 * @param {object} pluginManager
 * @param {object} themeManager
 */
function registerAdminWidgets(pluginManager, themeManager) {
    const Logger = ServiceManager.get('Logger');

    // Standard-Metadaten im WidgetManager hinterlegen
    try {
        const { getInstance: getWidgetManager } = require('dunebot-sdk/lib/WidgetManager');
        const wm = getWidgetManager();

        wm.registerWidget('admin-hinweis', { area: 'admin-top', position: 10, size: 12 });
        KENNZAHLEN.forEach((k, i) => wm.registerWidget(k.id, { area: 'admin-stats', position: (i + 1) * 10, size: 3 }));
        EINSTIEGE.forEach((e, i) => wm.registerWidget(e.id, { area: 'admin-primary', position: (i + 1) * 10, size: 4 }));
    } catch (e) {
        Logger.warn('[AdminWidgets] WidgetManager nicht verfügbar:', e.message);
    }

    pluginManager.hooks.addFilter('admin_dashboard_widgets', async (widgets, options = {}) => {
        const stats = options.stats || {};

        widgets.push({
            id: 'admin-hinweis',
            title: 'SuperAdmin',
            area: 'admin-top',
            position: 10,
            size: 12,
            icon: 'fa-solid fa-shield-halved',
            content: await themeManager.renderWidgetPartial('admin-hinweis', {
                icon: 'fa-solid fa-shield-halved',
                text: '<strong>SuperAdmin-Bereich</strong> — du bist als Bot-Owner angemeldet.',
                plugin: 'core'
            })
        });

        for (const [i, k] of KENNZAHLEN.entries()) {
            widgets.push({
                id: k.id,
                title: k.titel,
                area: 'admin-stats',
                position: (i + 1) * 10,
                size: 3,
                icon: k.icon,
                content: await themeManager.renderWidgetPartial('admin-stat', {
                    wert: stats[k.schluessel] ?? 0,
                    beschriftung: k.beschriftung,
                    icon: k.icon,
                    plugin: 'core'
                })
            });
        }

        for (const [i, e] of EINSTIEGE.entries()) {
            widgets.push({
                id: e.id,
                title: e.titel,
                area: 'admin-primary',
                position: (i + 1) * 10,
                size: 4,
                icon: e.icon,
                content: await themeManager.renderWidgetPartial('admin-shortcut', {
                    text: e.text,
                    url: e.url,
                    knopf: e.knopf,
                    knopfKlasse: e.knopfKlasse,
                    knopfIcon: e.knopfIcon,
                    plugin: 'core'
                })
            });
        }

        return widgets;
    });

    Logger.debug('[AdminWidgets] Kern-Widgets des Adminbereichs registriert');
}

module.exports = { registerAdminWidgets };
