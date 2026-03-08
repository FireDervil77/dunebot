/**
 * KernNavigation — Registriert die Core Guild-Navigation
 * 
 * Ausgelagert aus CoreDashboardPlugin im Zuge der Kern-Auflösung.
 * Wird direkt beim Guild-Enable aufgerufen (ohne Plugin-Lifecycle).
 *
 * @author FireBot Team
 */

'use strict';

const { ServiceManager } = require('dunebot-core');

/**
 * Kern-Navigation für eine Guild registrieren
 * 
 * Löscht bestehende Kern-Navigation und erstellt sie neu.
 * Sicher für mehrfachen Aufruf (idempotent).
 * 
 * @param {string} guildId - Discord Guild ID
 * @returns {Promise<void>}
 */
async function registerKernNavigation(guildId) {
    const Logger = ServiceManager.get('Logger');
    const navigationManager = ServiceManager.get('navigationManager');
    const dbService = ServiceManager.get('dbService');

    try {
        // Bestehende Kern-Navigation löschen (für sauberen Neustart)
        await dbService.query(
            'DELETE FROM nav_items WHERE plugin = ? AND guildId = ?',
            ['core', guildId]
        );

        const navItems = [
            {
                title: 'NAV.DASHBOARD',
                url: `/guild/${guildId}`,
                icon: 'fa-solid fa-gauge-high',
                order: 1000,
                type: navigationManager.menuTypes.MAIN,
                capability: 'DASHBOARD.ACCESS',
                visible: true,
                guildId,
                parent: null
            },
            {
                title: 'NAV.BUG_REPORT',
                url: `/guild/${guildId}/feedback/bug-report`,
                icon: 'fa-solid fa-bug',
                order: 10,
                type: navigationManager.menuTypes.MAIN,
                capability: 'DASHBOARD.ACCESS',
                visible: true,
                guildId,
                parent: `/guild/${guildId}`
            },
            {
                title: 'NAV.FEATURE_REQUEST',
                url: `/guild/${guildId}/feedback/feature-request`,
                icon: 'fa-solid fa-lightbulb',
                order: 20,
                type: navigationManager.menuTypes.MAIN,
                capability: 'DASHBOARD.ACCESS',
                visible: true,
                guildId,
                parent: `/guild/${guildId}`
            },
            {
                title: 'NAV.SUPPORT_DUNEBOT',
                url: `/guild/${guildId}/donate`,
                icon: 'fa-solid fa-heart',
                order: 30,
                type: navigationManager.menuTypes.MAIN,
                capability: 'DASHBOARD.ACCESS',
                visible: true,
                guildId,
                parent: `/guild/${guildId}`
            },
            {
                title: 'NAV.HALL_OF_FAME',
                url: `/guild/${guildId}/hall-of-fame`,
                icon: 'fa-solid fa-trophy',
                order: 40,
                type: navigationManager.menuTypes.MAIN,
                capability: 'DASHBOARD.ACCESS',
                visible: true,
                guildId,
                parent: `/guild/${guildId}`
            },
            {
                title: 'NAV.SETTINGS',
                url: `/guild/${guildId}/settings`,
                icon: 'fa-solid fa-cog',
                order: 2000,
                type: navigationManager.menuTypes.MAIN,
                capability: 'CORE.SETTINGS.VIEW',
                visible: true,
                guildId,
                parent: null
            },
            {
                title: 'NAV.PERMISSIONS',
                url: `/guild/${guildId}/permissions`,
                icon: 'fa-solid fa-user-lock',
                order: 2500,
                type: navigationManager.menuTypes.MAIN,
                capability: 'PERMISSIONS.VIEW',
                visible: true,
                guildId,
                parent: null
            },
            {
                title: 'NAV.PLUGINS',
                url: `/guild/${guildId}/plugins`,
                icon: 'fa-solid fa-puzzle-piece',
                order: 3000,
                type: navigationManager.menuTypes.MAIN,
                capability: 'CORE.PLUGINS.MANAGE',
                visible: true,
                guildId,
                parent: null
            },
            // Subnav: Einstellungen
            {
                title: 'NAV.GENERAL',
                url: `/guild/${guildId}/settings/general`,
                icon: 'fa-solid fa-sliders',
                order: 10,
                type: navigationManager.menuTypes.MAIN,
                capability: 'CORE.SETTINGS.VIEW',
                visible: true,
                guildId,
                parent: `/guild/${guildId}/settings`
            },
            {
                title: 'NAV.INTEGRATIONS',
                url: `/guild/${guildId}/settings/integrations`,
                icon: 'fa-solid fa-plug',
                order: 30,
                type: navigationManager.menuTypes.MAIN,
                capability: 'CORE.SETTINGS.EDIT',
                visible: true,
                guildId,
                parent: `/guild/${guildId}/settings`
            },
            // Subnav: Berechtigungen
            {
                title: 'NAV.PERMISSIONS_USERS',
                url: `/guild/${guildId}/permissions/users`,
                icon: 'fa-solid fa-users',
                order: 10,
                type: navigationManager.menuTypes.MAIN,
                capability: 'PERMISSIONS.USERS.VIEW',
                visible: true,
                guildId,
                parent: `/guild/${guildId}/permissions`
            },
            {
                title: 'NAV.PERMISSIONS_GROUPS',
                url: `/guild/${guildId}/permissions/groups`,
                icon: 'fa-solid fa-users-cog',
                order: 20,
                type: navigationManager.menuTypes.MAIN,
                capability: 'PERMISSIONS.GROUPS.VIEW',
                visible: true,
                guildId,
                parent: `/guild/${guildId}/permissions`
            },
            {
                title: 'NAV.PERMISSIONS_MATRIX',
                url: `/guild/${guildId}/permissions/matrix`,
                icon: 'fa-solid fa-table',
                order: 30,
                type: navigationManager.menuTypes.MAIN,
                capability: 'PERMISSIONS.MATRIX.VIEW',
                visible: true,
                guildId,
                parent: `/guild/${guildId}/permissions`
            }
        ];

        await navigationManager.registerNavigation('core', guildId, navItems);

        Logger.debug(`[KernNavigation] Navigation für Guild ${guildId} registriert (${navItems.length} Einträge)`);
    } catch (error) {
        Logger.error(`[KernNavigation] Fehler beim Registrieren der Navigation für Guild ${guildId}:`, error);
        throw error;
    }
}

module.exports = { registerKernNavigation };
