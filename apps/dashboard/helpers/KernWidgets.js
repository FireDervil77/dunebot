'use strict';

/**
 * KernWidgets — Registriert die Core Dashboard-Widgets
 *
 * Ausgelagert aus CoreDashboardPlugin im Zuge der Kern-Auflösung.
 * Wird direkt beim Dashboard-Start aufgerufen (ohne Plugin-System).
 *
 * Widget-Bereiche (WordPress-Stil):
 *  - dashboard-top       — Vollbreite, Benachrichtigungen (plugin-updates)
 *  - dashboard-primary   — 3-spaltig, Hauptkennzahlen
 *  - dashboard-secondary — 2-spaltig, Analyse
 *  - dashboard-bottom    — Vollbreite, Support
 *
 * @author FireBot Team
 */

const { ServiceManager } = require('dunebot-core');
const { uptime } = require('process');

/**
 * Alle Kern-Widgets beim PluginManager-Hook-System registrieren
 *
 * @param {object} pluginManager - PluginManager-Instanz
 * @param {object} themeManager - ThemeManager-Instanz
 */
function registerKernWidgets(pluginManager, themeManager) {
    const Logger = ServiceManager.get('Logger');

    // Standard-Metadaten im WidgetManager registrieren
    try {
        const { getInstance: getWidgetManager } = require('dunebot-sdk/lib/WidgetManager');
        const wm = getWidgetManager();
        wm.registerWidget('plugin-updates',  { area: 'dashboard-top',       position: 10, size: 12 });
        wm.registerWidget('server-info',     { area: 'dashboard-primary',   position: 10, size: 4  });
        wm.registerWidget('bot-permissions', { area: 'dashboard-primary',   position: 20, size: 4  });
        wm.registerWidget('bot-performance', { area: 'dashboard-primary',   position: 30, size: 4  });
        wm.registerWidget('server-analysis', { area: 'dashboard-secondary', position: 10, size: 4  });
        wm.registerWidget('active-plugins',  { area: 'dashboard-secondary', position: 20, size: 8  });
        wm.registerWidget('support-dunebot', { area: 'dashboard-bottom',    position: 10, size: 12 });
    } catch (e) {
        // WidgetManager noch nicht verfügbar — kein Problem, area-Felder in Widgets reichen
        Logger.warn('[KernWidgets] WidgetManager konnte nicht geladen werden:', e.message);
    }

    pluginManager.hooks.addFilter('guild_dashboard_widgets', async (widgets, options) => {
        const { guildId, guild, req, res, theme, user, stats, enabledPlugins, custom } = options;

        // === PLUGIN-UPDATES WIDGET (Zuerst, wenn Updates vorhanden) ===
        let pendingUpdates = [];
        try {
            pendingUpdates = await pluginManager.getAvailableUpdates(guildId);
        } catch (err) {
            Logger.error('[KernWidgets] Fehler beim Laden von Plugin-Updates:', err);
        }

        if (pendingUpdates.length > 0) {
            widgets.push({
                id: 'plugin-updates',
                title: 'Plugin-Updates',
                area: 'dashboard-top',
                position: 10,
                size: 12,
                icon: 'fas fa-sync-alt',
                cardClass: 'card-warning',
                content: await themeManager.renderWidgetPartial('plugin-updates', {
                    guildId,
                    pendingUpdates,
                    plugin: 'core'
                })
            });
        }

        // === SERVER-INFORMATION WIDGET ===
        widgets.push({
            id: 'server-info',
            title: 'Server-Infos',
            area: 'dashboard-primary',
            position: 10,
            size: 4,
            icon: 'bi bi-speedometer',
            cardClass: '',
            content: await themeManager.renderWidgetPartial('server-info', {
                guild: options.guild,
                stats: options.stats,
                guildId: options.guildId,
                enabledPlugins: options.enabledPlugins,
                uptime: process.uptime(),
                memory: process.memoryUsage(),
                plugin: 'core'
            })
        });

        // === BOT-BERECHTIGUNGEN WIDGET ===
        widgets.push({
            id: 'bot-permissions',
            title: 'Bot-Berechtigungen',
            area: 'dashboard-primary',
            position: 20,
            size: 4,
            icon: 'bi bi-shield-check',
            cardClass: '',
            content: await themeManager.renderWidgetPartial('bot-permissions', {
                guild: options.guild,
                stats: options.stats,
                guildId: options.guildId,
                enabledPlugins: options.enabledPlugins,
                plugin: 'core'
            })
        });

        // === BOT-PERFORMANCE WIDGET ===
        widgets.push({
            id: 'bot-performance',
            title: 'Bot-Performance',
            area: 'dashboard-primary',
            position: 30,
            size: 4,
            icon: 'bi bi-speedometer',
            cardClass: '',
            content: await themeManager.renderWidgetPartial('bot-performance', {
                guild: options.guild,
                stats: options.stats,
                guildId: options.guildId,
                enabledPlugins: options.enabledPlugins,
                plugin: 'core'
            })
        });

        // === SERVER-ANALYSE WIDGET ===
        widgets.push({
            id: 'server-analysis',
            title: 'Server-Analyse',
            area: 'dashboard-secondary',
            position: 10,
            size: 4,
            icon: 'bi bi-bar-chart',
            cardClass: '',
            content: await themeManager.renderWidgetPartial('server-analysis', {
                guild: options.guild,
                stats: options.stats,
                guildId: options.guildId,
                enabledPlugins: options.enabledPlugins,
                plugin: 'core'
            })
        });

        // === AKTIVE PLUGINS WIDGET ===
        widgets.push({
            id: 'active-plugins',
            title: 'Active-Plugins',
            area: 'dashboard-secondary',
            position: 20,
            size: 8,
            icon: 'bi bi-shield-check',
            cardClass: '',
            content: await themeManager.renderWidgetPartial('active-plugins', {
                guild: options.guild,
                stats: options.stats,
                guildId: options.guildId,
                enabledPlugins: options.enabledPlugins,
                plugin: 'core'
            })
        });

        // === SUPPORT DUNEBOT WIDGET (am Ende) ===
        try {
            const dbService = ServiceManager.get('dbService');
            const userId = user?.id || null;

            let userBadge = null;
            if (userId) {
                const [badges] = await dbService.query(
                    'SELECT * FROM supporter_badges WHERE user_id = ? AND badge_visible = 1',
                    [userId]
                );
                userBadge = badges[0] || null;
            }

            const [donationStats] = await dbService.query(`
                SELECT 
                    SUM(CASE WHEN payment_status = 'completed' THEN amount ELSE 0 END) as total_amount,
                    COUNT(DISTINCT user_id) as supporter_count
                FROM donations
            `);

            widgets.push({
                id: 'support-dunebot',
                title: 'DuneBot unterstützen',
                area: 'dashboard-bottom',
                position: 10,
                size: 12,
                icon: 'fas fa-heart',
                cardClass: 'card-success',
                content: await themeManager.renderWidgetPartial('support-dunebot', {
                    guildId,
                    userBadge,
                    communityStats: donationStats[0] || { total_amount: 0, supporter_count: 0 },
                    plugin: 'core'
                })
            });
        } catch (err) {
            Logger.error('[KernWidgets] Fehler beim Laden des Support-Widgets:', err);
        }

        return widgets;
    });

    Logger.debug('[KernWidgets] Kern-Widgets registriert');
}

module.exports = { registerKernWidgets };
