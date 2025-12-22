const { ServiceManager } = require("dunebot-core");
const express = require('express');
const path = require('path');
const { CheckAuth, CheckGuildAccess } = require("../../../apps/dashboard/middlewares/auth.middleware");


/**
 * Zentrales Routing-Management für das Dashboard
 * Verwaltet Routen, Middleware und deren Beziehungen
 * @author FireBot-Team
 */
class RouterManager {
    /**
     * Initialisiert den RouterManager
     * @param {express.Application} app - Express Application Instanz
     */
    constructor(app) {
        // Express App Referenz
        this.app = app;
        
        // Logger aus ServiceManager
        this.Logger = ServiceManager.get("Logger");
        
        // Sammlung aller registrierten Routen
        this.routes = new Map();
        
        // Middleware-Sammlung
        this.middlewareChains = new Map();
        
        // Hooks wenn verfügbar
        this.hooks = app.pluginManager?.hooks;

        this.Logger.debug('RouterManager initialisiert');
    }

    /**
     * Registriert eine neue Route mit Navigation und Handler
     * @param {string} path - URL Pfad 
     * @param {express.Router} router - Express Router
     * @param {Object} options - Routing Optionen
     * @returns {RouterManager} Für Method-Chaining
     */
    register(path, router, options = {}) {
        const {
            handler,
            navigation,
            auth = false,
            middlewares = []
        } = options;

        try {
            // Middleware Chain aufbauen
            const chain = [
                // Auth Middleware direkt verwenden statt über this.app.middlewares
                ...(auth ? [CheckAuth] : []),
                ...middlewares
            ];

            // Handler an Router binden wenn vorhanden
            if (handler) {
                router.get(path, handler);
            }

            // Route registrieren
            this.app.use(path, ...chain, router);
            
            // HINWEIS: Navigation wird NICHT hier registriert!
            // Plugins registrieren Navigation in onGuildEnable() via navigationManager.registerNavigation()
            // Die addItem() Methode existiert nicht und wird auch nicht benötigt

            this.Logger.debug(`Route registriert: ${path}`);
            return this;

        } catch (error) {
            this.Logger.error(`Fehler bei der Routen-Registrierung für ${path}:`, error);
            throw error;
        }
    }

    /**
     * Registriert Plugin-spezifische Routen
     * @param {DashboardPlugin} plugin - Plugin Instanz
     */
    registerPluginRoutes(plugin) {
        try {
            // Guild Routes (mit CheckGuildAccess für Guild-basierte Routen!)
            if (plugin.guildRouter) {
                this.register(`/guild/:guildId/plugins/${plugin.name}`,
                    plugin.guildRouter,
                    { 
                        auth: true,
                        middlewares: [CheckGuildAccess], // ✅ Guild-Access-Prüfung hinzufügen
                        plugin
                    }
                );
            }

            // API Routes
            if (plugin.apiRouter) {
                this.register(`/api/plugins/${plugin.name}`,
                    plugin.apiRouter,
                    { 
                        auth: true,
                        plugin 
                    }
                );
            }

            // Widget Routes
            if (plugin.widgetRouter) {
                this.register(`/widgets/${plugin.name}`,
                    plugin.widgetRouter,
                    { 
                        auth: true,
                        plugin 
                    }
                );
            }

        } catch (error) {
            this.Logger.error(`Fehler beim Registrieren der Plugin-Routen für ${plugin.name}:`, error);
            throw error;
        }
    }
}

// Export der Klasse
module.exports = RouterManager;