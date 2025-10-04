WordPress-ähnliches Plugin-System
Um dein System in Richtung WordPress-ähnliches Plugin-Management zu entwickeln:



1. Plugin Hooks System
WordPress ist bekannt für sein Hook-System. Implementiere ähnliche Hooks:

class PluginHooks {
    constructor() {
        this.actions = {};
        this.filters = {};
        this.viewHooks = {};  // Neu: Für Template-Erweiterungen
        this.adminSections = {}; // Neu: Für Admin-Bereiche
    }
    
    // Aktionen registrieren (ohne Rückgabewert)
    addAction(name, callback, priority = 10) {
        if (!this.actions[name]) this.actions[name] = [];
        this.actions[name].push({ callback, priority });
        this.actions[name].sort((a, b) => a.priority - b.priority);
    }
    
    // Aktionen ausführen
    async doAction(name, ...args) {
        if (!this.actions[name]) return;
        
        for (const hook of this.actions[name]) {
            await hook.callback(...args);
        }
    }
    
    // Filter registrieren (mit Rückgabewert)
    addFilter(name, callback, priority = 10) {
        if (!this.filters[name]) this.filters[name] = [];
        this.filters[name].push({ callback, priority });
        this.filters[name].sort((a, b) => a.priority - b.priority);
    }
    
    // Filter anwenden
    async applyFilter(name, value, ...args) {
        if (!this.filters[name]) return value;
        
        let result = value;
        for (const hook of this.filters[name]) {
            result = await hook.callback(result, ...args);
        }
        
        return result;
    }

    // Neue Methode: View-Hook registrieren
    addViewHook(location, component, priority = 10) {
        if (!this.viewHooks[location]) this.viewHooks[location] = [];
        this.viewHooks[location].push({ component, priority });
        this.viewHooks[location].sort((a, b) => a.priority - b.priority);
    }

    // Neue Methode: View-Hooks für eine bestimmte Stelle abrufen
    getViewHooks(location) {
        return this.viewHooks[location] || [];
    }

    // Neue Methode: Admin-Sektion registrieren
    registerAdminSection(id, title, component, priority = 10) {
        if (!this.adminSections[id]) {
            this.adminSections[id] = {
                title,
                component,
                priority
            };
        }
    }
    
    // Admin-Sektionen abrufen
    getAdminSections() {
        return Object.entries(this.adminSections)
            .map(([id, section]) => ({ id, ...section }))
            .sort((a, b) => a.priority - b.priority);
    }
}

module.exports = PluginHooks;



2. Plugin-Manager erweitern

class PluginManager extends BasePluginManager {
    constructor(app, registryPath, pluginDir) {
        super(registryPath, pluginDir);
        this.app = app;
        this.hooks = new PluginHooks();
    }
    
    // Hook-System verfügbar machen
    getHooks() {
        return this.hooks;
    }
    
    // Plugin aktivieren mit Hooks
    async enablePlugin(pluginName) {
        // Bestehender Code...
        
        // "before_enable_plugin" Hook aufrufen
        await this.hooks.doAction('before_enable_plugin', pluginName);
        
        try {
            // ...Plugin aktivieren...
            
            // "after_enable_plugin" Hook aufrufen
            await this.hooks.doAction('after_enable_plugin', pluginName, plugin);
            
            return true;
        } catch (error) {
            // "plugin_enable_failed" Hook aufrufen
            await this.hooks.doAction('plugin_enable_failed', pluginName, error);
            return false;
        }
    }
}



3. Admin-UI für Plugins verbessern
Für einen WordPress-ähnlichen Admin-Bereich:


// In admin.router.js
router.get('/plugins', async (req, res) => {
    try {
        // Plugins laden
        const pluginManager = req.app.pluginManager;
        const plugins = await pluginManager.getPluginsMeta();
        
        // Plugins durch Filter laufen lassen
        const processedPlugins = await pluginManager.hooks.applyFilter(
            'admin_plugins_list',
            plugins
        );
        
        res.render('admin/plugins', {
            plugins: processedPlugins,
            installationStatus: req.query.status || '',
            csrfToken: req.csrfToken()
        });
    } catch (error) {
        res.render('error', { error });
    }
});

// Install/Update/Remove
router.post('/plugins/action', async (req, res) => {
    const { action, plugin } = req.body;
    const pluginManager = req.app.pluginManager;
    
    try {
        await pluginManager.hooks.doAction('before_plugin_action', action, plugin);
        
        if (action === 'install') {
            await pluginManager.installPlugin(plugin);
        } else if (action === 'update') {
            await pluginManager.updatePlugin(plugin);
        } else if (action === 'uninstall') {
            await pluginManager.uninstallPlugin(plugin);
        } else if (action === 'enable') {
            await pluginManager.enablePlugin(plugin);
        } else if (action === 'disable') {
            await pluginManager.disablePlugin(plugin);
        }
        
        await pluginManager.hooks.doAction('after_plugin_action', action, plugin);
        
        res.redirect('/admin/plugins?status=success');
    } catch (error) {
        res.redirect('/admin/plugins?status=error');
    }
});



4. Plugin-Konfiguration wie in WordPress

// In DashboardPlugin.js
class DashboardPlugin {
    constructor(data) {
        // ...bestehender Code
    

        // Neue Eigenschaften
        this.views = data.views || {}; // Plugin-spezifische Templates
        this.publicAssets = data.publicAssets || null; // Öffentliche Assets (CSS, JS)
        this.adminSections = data.adminSections || {}; // Admin-Bereiche
        this.dashboardWidgets = data.dashboardWidgets || []; // Dashboard-Widgets
        this.shortcodes = data.shortcodes || {}; // Shortcodes für Templates
        
        // Automatisch alle Komponenten registrieren
        this._registerComponents();
    }

    // Komponenten beim Hooks-System registrieren
    _registerComponents() {
        // Wird beim Enable aufgerufen
    }

    // Methode zum Registrieren einer View
    registerView(viewName, template) {
        this.app.registerPluginView(this.name, viewName, template);
    }

    // Methode zum Registrieren eines Assets
    registerAsset(type, path) {
        this.app.registerPluginAsset(this.name, type, path);
    }
    
    // Widget für Dashboard registrieren
    registerWidget(widget) {
        this.app.registerDashboardWidget(this.name, widget);
    }
    
    // Shortcode registrieren
    registerShortcode(tag, callback) {
        this.app.registerShortcode(this.name, tag, callback);
    }
    
    // Hook in View hinzufügen
    addToView(location, component) {
        this.app.hooks.addViewHook(location, component);
    }

    // Admin-Sektion registrieren
    registerAdminSection(id, title, component) {
        this.app.hooks.registerAdminSection(id, title, component);
    }

    // WordPress-ähnliche Optionen-API
    async getOption(key, defaultValue = null) {
        try {
            const PluginOptions = this.dbService.getModel("PluginOptions");
            const option = await PluginOptions.findOne({
                where: { plugin: this.name, option_key: key }
            });
            
            return option ? option.option_value : defaultValue;
        } catch (error) {
            return defaultValue;
        }
    }
    
    async updateOption(key, value) {
        try {
            const PluginOptions = this.dbService.getModel("PluginOptions");
            await PluginOptions.upsert({
                plugin: this.name,
                option_key: key,
                option_value: typeof value === 'object' ? JSON.stringify(value) : value
            });
            return true;
        } catch (error) {
            return false;
        }
    }
    
    async deleteOption(key) {
        try {
            const PluginOptions = this.dbService.getModel("PluginOptions");
            await PluginOptions.destroy({
                where: { plugin: this.name, option_key: key }
            });
            return true;
        } catch (error) {
            return false;
        }
    }
}


// apps/dashboard/app.js (ergänzt)

const express = require('express');
const path = require('path');
const fs = require('fs');

class App {
    // Bestehender Code...


    // Neue Methode: Plugin-Routen registrieren
    registerPluginRoutes() {
        // Für jedes Plugin...
        for (const plugin of this.app.pluginManager.plugins) {
            // Dashboard-Routen
            if (plugin.dashboardRouter) {
                this.app.use(
                    `/dashboard/:guildId/${plugin.name}`,
                    (req, res, next) => {
                        res.locals.plugin = plugin;
                        next();
                    },
                    plugin.dashboardRouter
                );
            }
            
            // Admin-Routen
            if (plugin.adminRouter) {
                this.app.use(
                    `/admin/${plugin.name}`,
                    (req, res, next) => {
                        res.locals.plugin = plugin;
                        next();
                    },
                    plugin.adminRouter
                );
            }
            
            // API-Routen
            if (plugin.apiRouter) {
                this.app.use(
                    `/api/${plugin.name}`,
                    (req, res, next) => {
                        res.locals.plugin = plugin;
                        next();
                    },
                    plugin.apiRouter
                );
            }
        }
    }

    // Neue Methode: Plugin-Assets registrieren
    registerPluginAssets() {
        for (const plugin of this.app.pluginManager.plugins) {
            if (plugin.publicAssets) {
                const assetsPath = path.join(this.pluginsDir, plugin.name, 'public');
                if (fs.existsSync(assetsPath)) {
                    this.app.use(`/assets/${plugin.name}`, express.static(assetsPath));
                }
            }
        }
    }

    // Neue Methode: Plugin-Views registrieren
    registerPluginViews() {
        for (const plugin of this.app.pluginManager.plugins) {
            if (plugin.views) {
                const viewsPath = path.join(this.pluginsDir, plugin.name, 'views');
                if (fs.existsSync(viewsPath)) {
                    this.app.set('views', [...this.app.get('views'), viewsPath]);
                }
            }
        }
    }
    

4. EJS-Template-Erweiterung für Hooks
<!-- In layout-Template einbauen -->
<body>
    <header>
        <!-- Normaler Header -->
        
        <!-- Plugin-Header-Hooks -->
        <% if (hooks && hooks.getViewHooks) { %>
            <% const headerHooks = hooks.getViewHooks('header'); %>
            <% headerHooks.forEach(hook => { %>
                <%- include(hook.component, { plugin: hook.plugin }) %>
            <% }); %>
        <% } %>
    </header>
    
    <main>
        <%- body %>
        
        <!-- Plugin-Content-Hooks -->
        <% if (hooks && hooks.getViewHooks) { %>
            <% const contentHooks = hooks.getViewHooks('content_after'); %>
            <% contentHooks.forEach(hook => { %>
                <%- include(hook.component, { plugin: hook.plugin }) %>
            <% }); %>
        <% } %>
    </main>
</body>


5. Shortcodes für Template-Inhalte
// packages/dunebot-sdk/lib/Shortcode.js
class Shortcode {
    constructor() {
        this.shortcodes = {};
    }
    
    register(plugin, tag, callback) {
        this.shortcodes[tag] = {
            plugin,
            callback
        };
    }
    
    // Shortcodes in einem Text ersetzen
    parse(text, context = {}) {
        // Regex für [shortcode]...[/shortcode] und [shortcode attr="value"]
        const regex = /\[(\w+)(?:\s+([^\]]+))?\](?:([^\[]+)\[\/\1\])?/g;
        
        return text.replace(regex, (match, tag, attrs, content) => {
            if (!this.shortcodes[tag]) return match;
            
            // Attribute parsen
            const attributes = {};
            if (attrs) {
                const attrRegex = /(\w+)="([^"]+)"/g;
                let attrMatch;
                while ((attrMatch = attrRegex.exec(attrs)) !== null) {
                    attributes[attrMatch[1]] = attrMatch[2];
                }
            }
            
            // Shortcode ausführen
            try {
                return this.shortcodes[tag].callback(attributes, content, context);
            } catch (error) {
                console.error(`Error executing shortcode [${tag}]:`, error);
                return `[Error in shortcode ${tag}]`;
            }
        });
    }
}

6. Middleware für Plugin-Hooks

// apps/dashboard/middlewares/plugin-hooks.middleware.js
module.exports = function (req, res, next) {
    // Hooks für Templates verfügbar machen
    res.locals.hooks = req.app.pluginManager.hooks;
    
    // Shortcode-Funktion für Templates verfügbar machen
    res.locals.shortcode = (text) => {
        return req.app.shortcodeParser.parse(text, { 
            req, 
            res, 
            user: req.session?.user
        });
    };
    
    // Admin-Sektionen laden
    if (req.originalUrl.startsWith('/admin')) {
        res.locals.adminSections = req.app.pluginManager.hooks.getAdminSections();
    }
    
    // Dashboard-Widgets laden
    if (req.originalUrl.startsWith('/dashboard')) {
        res.locals.dashboardWidgets = req.app.pluginManager.getDashboardWidgets(req.params.guildId);
    }
    
    next();
};

7. Beispiel: Ein komplettes Plugin
// plugins/example/dashboard/index.js
const { DashboardPlugin } = require('dunebot-sdk');
const path = require('path');

module.exports = new DashboardPlugin({
    baseDir: __dirname,
    icon: "fa-solid fa-puzzle-piece",
    dashboardRouter: require('./dashboard.router'),
    adminRouter: require('./admin.router'),
    apiRouter: require('./api.router'),
    
    // Dashboard-Navigation
    navigationItems: [
        {
            title: "Example Plugin",
            path: (guildId) => `/dashboard/${guildId}/example`,
            icon: "fa-solid fa-flask",
            order: 10
        }
    ],
    
    // Views (Templates)
    views: {
        'dashboard': path.join(__dirname, 'views/dashboard.ejs'),
        'widget': path.join(__dirname, 'views/widget.ejs'),
        'admin': path.join(__dirname, 'views/admin.ejs')
    },
    
    // Öffentliche Assets
    publicAssets: true,
    
    // Admin-Bereiche
    adminSections: {
        'example': {
            title: "Example Settings",
            component: 'admin-example',
            priority: 50
        }
    },
    
    // Dashboard-Widgets
    dashboardWidgets: [
        {
            id: 'example-widget',
            title: 'Example Widget',
            component: 'widget',
            size: 'medium',
            order: 10
        }
    ],
    
    // Shortcodes
    shortcodes: {
        'example': (attrs, content) => {
            return `<div class="example-shortcode">${content}</div>`;
        }
    },
    
    // Plugin aktivieren
    async onEnable(app, dbService, guildId) {
        // Navigation registrieren, wenn guildId vorhanden
        if (guildId) {
            const navItems = this.navigationItems.map(item => ({
                ...item,
                path: typeof item.path === 'function' ? item.path(guildId) : item.path
            }));
            
            await this.registerNavigation(dbService, guildId, navItems);
        }
        
        // Hooks registrieren
        const hooks = app.pluginManager.hooks;
        
        // Action-Hook hinzufügen
        hooks.addAction('dashboard_init', () => {
            console.log('Dashboard initialized from example plugin');
        });
        
        // Filter-Hook hinzufügen
        hooks.addFilter('format_username', (username) => {
            return `★ ${username} ★`;
        });
        
        // View-Hook hinzufügen
        hooks.addViewHook('header', {
            plugin: this,
            component: path.join(__dirname, 'views/header-extension.ejs')
        });
        
        // Admin-Sektion registrieren
        hooks.registerAdminSection('example', 'Example Plugin', 
            path.join(__dirname, 'views/admin-section.ejs'));
        
        // Shortcode registrieren
        app.shortcodeParser.register(this.name, 'example', (attrs, content) => {
            return `<div class="example-plugin">${content}</div>`;
        });
    }
});

8. Dashboard mit Widgets
// apps/dashboard/controllers/dashboard.controller.js (ergänzt)

exports.homePage = async function(req, res) {
    // Bestehender Code...

    // Widgets von allen Plugins sammeln
    const widgets = [];

    // Für jedes aktivierte Plugin Widgets sammeln
    for (const plugin of req.app.pluginManager.plugins) {
        if (enabledPlugins.includes(plugin.name) && plugin.dashboardWidgets) {
            for (const widget of plugin.dashboardWidgets) {
                widgets.push({
                    ...widget,
                    plugin: plugin.name,
                    component: path.join(req.app.pluginsDir, plugin.name, 'dashboard', 'widgets', widget.component + '.ejs')
                });
            }
        }
    }

    // Nach Order sortieren
    widgets.sort((a, b) => a.order - b.order);
    
    // Zum Template hinzufügen
    res.render('dashboard/home', {
        // Bestehende Daten...
        widgets: widgets
    });
};

9. Admin-Bereich mit Plugin-Sektionen
<!-- views/admin/settings.ejs -->
<div class="container">
    <div class="row">
        <div class="col-md-3">
            <div class="list-group">
                <a href="/admin/settings" class="list-group-item active">General</a>
                
                <!-- Plugin-Admin-Sektionen -->
                <% if (adminSections && adminSections.length > 0) { %>
                    <% adminSections.forEach(section => { %>
                        <a href="/admin/settings/<%= section.id %>" 
                           class="list-group-item">
                            <%= section.title %>
                        </a>
                    <% }); %>
                <% } %>
            </div>
        </div>
        
        <div class="col-md-9">
            <% if (activeSection && activeSection !== 'general') { %>
                <% const section = adminSections.find(s => s.id === activeSection); %>
                <% if (section) { %>
                    <%- include(section.component) %>
                <% } %>
            <% } else { %>
                <!-- Standard-Admin-Formular -->
                <form method="post" action="/admin/settings/save">
                    <!-- ... -->
                </form>
            <% } %>
        </div>
    </div>
</div>


10. Plugin-Manifest für Metadaten
// plugins/example/manifest.json
{
    "name": "example",
    "displayName": "Example Plugin",
    "description": "A demo plugin showing the WordPress-like plugin system",
    "version": "1.0.0",
    "author": "Your Name",
    "repository": "https://github.com/yourusername/example-plugin",
    "requires": {
        "dunebot": ">=0.1.0",
        "node": ">=14.0.0"
    },
    "dependencies": ["core"],
    "tags": ["demo", "example"],
    "category": "utilities",
    "bot": {
        "commands": ["example"],
        "events": ["ready", "guildCreate"]
    },
    "dashboard": {
        "routes": ["/example"],
        "widgets": ["example-widget"],
        "adminSections": ["example-settings"]
    }
}



GitHub Copilot
Ein WordPress-ähnliches Plugin-System für DuneBot
Du hast einen guten Punkt - meine ursprünglichen Vorschläge waren ein guter Anfang, aber für ein vollwertiges WordPress-ähnliches Plugin-System brauchen wir mehr Details zur Umsetzung, besonders für Views, Routen und andere dynamische Komponenten.

Grundkonzept: Modularität durch Erweiterungspunkte
WordPress ist so mächtig, weil es klar definierte "Erweiterungspunkte" bietet. Hier ist, wie wir das für DuneBot umsetzen könnten:

1. Das Hooks-System erweitern
2. Plugin-Definition erweitern
3. Dynamisches Routing für Plugin-Routen
4. EJS-Template-Erweiterung für Hooks
5. Shortcodes für Template-Inhalte
6. Middleware für Plugin-Hooks
7. Beispiel: Ein komplettes Plugin
8. Dashboard mit Widgets
9. Admin-Bereich mit Plugin-Sektionen
10. Plugin-Manifest für Metadaten


Zusammenfassung der Architektur
Mit diesem System hättest du ein WordPress-ähnliches Plugin-System, das:

Dynamisches Routing für Plugin-Routen unterstützt
Template-Erweiterungen über Hooks erlaubt
Dashboard-Widgets von Plugins integrieren kann
Admin-Bereiche pro Plugin ermöglicht
Shortcodes in Templates unterstützt
Asset-Management für CSS und JavaScript bietet
Metadaten über Plugins verwaltet
Eine klare Plugin-API mit Standard-Methoden hat

Dies ist eine fortgeschrittene Architektur, die du schrittweise umsetzen kannst. Du könntest mit den Hooks und dem grundlegenden Routing beginnen, dann die Template-Erweiterungen hinzufügen und schließlich das Widget-System und Shortcodes implementieren.



//dunebot-core/BasePluginManager.js

Ich habe strategisch Hooks an wichtigen Stellen im Initialisierungsprozess platziert:

BASEPLUGINMANAGER HOOKS:

before_init - Vor dem Start des Initialisierungsprozesses
after_init - Nach erfolgreicher Initialisierung
init_failed - Bei Fehler während der Initialisierung
Plugin-Discovery-Hooks:

before_plugin_discovery - Vor der Erkennung der verfügbaren Plugins
plugin_meta_list - Filter für die entdeckten Plugin-Metadaten
Core-Plugin-Hooks:

before_core_plugin_enable - Vor der Aktivierung des Core-Plugins
after_core_plugin_enable - Nach der Aktivierung des Core-Plugins
Plugin-Konfiguration-Hooks:

filter_enabled_plugins - Filter für die aktivierten Plugins
before_dependency_check - Vor der Abhängigkeitsprüfung
after_dependency_check - Nach der Abhängigkeitsprüfung
plugin_skipped - Wenn ein Plugin übersprungen wird
plugin_disabled - Wenn ein Plugin deaktiviert wird
Plugin-Aktivierungs-Hooks:

filter_plugins_to_enable - Filter für die zu aktivierenden Plugins
before_determine_load_order - Vor der Bestimmung der Ladereihenfolge
filter_plugin_load_order - Filter für die Ladereihenfolge
before_plugins_enable - Vor der Aktivierung aller Plugins
before_plugin_enable - Vor der Aktivierung eines einzelnen Plugins
after_plugin_enable - Nach der Aktivierung eines einzelnen Plugins
after_plugins_enable - Nach der Aktivierung aller Plugins


Diese Hooks ermöglichen ein hohes Maß an Erweiterbarkeit und erlauben anderen Plugins, in den Initialisierungsprozess einzugreifen. Das ist genau das, was WordPress so mächtig macht - die Fähigkeit, den Kernprozess an fast jeder Stelle zu erweitern oder zu modifizieren.



PLUGINMANAGER (DASHBOARD) HOOKS:
Verwendete Hooks
Diese Implementierung fügt folgende Hook-Punkte hinzu:

Tabellen-Registrierung

before_register_tables - Vor der Registrierung von Tabellen
after_register_tables - Nach erfolgreicher Tabellen-Registrierung
register_tables_failed - Bei Fehler während der Tabellen-Registrierung

Plugin-Installation

before_install_plugin - Vor der Installation eines Plugins
after_install_plugin - Nach erfolgreicher Installation
install_plugin_failed - Bei Fehler während der Installation


Plugin-Aktivierung

before_enable_plugin - Vor der Aktivierung eines Plugins
before_load_plugin_translations - Vor dem Laden der Übersetzungen
plugin_load_failed - Bei Fehler beim Laden des Plugin-Moduls
modify_plugin_instance - Filter zum Modifizieren der Plugin-Instanz
invalid_plugin_type - Bei ungültigem Plugin-Typ
before_register_dashboard_tables - Vor der Registrierung von Dashboard-Tabellen
before_plugin_enable_method - Vor dem Aufruf der enable-Methode
after_plugin_registered - Nach der Registrierung eines Plugins
before_update_config - Vor der Aktualisierung der Konfiguration
modify_enabled_plugins - Filter zum Modifizieren der aktivierten Plugins
after_update_config - Nach der Aktualisierung der Konfiguration
after_enable_plugin - Nach erfolgreicher Aktivierung



Plugin-Deaktivierung

before_disable_plugin - Vor der Deaktivierung eines Plugins
before_plugin_disable_method - Vor dem Aufruf der onDisable-Methode
after_plugin_disable_method - Nach dem Aufruf der onDisable-Methode
after_disable_plugin - Nach erfolgreicher Deaktivierung
disable_plugin_failed - Bei Fehler während der Deaktivierung



Dashboard-Widgets

filter_plugin_widgets - Filter für Plugin-Widgets
dashboard_widgets - Filter für alle Dashboard-Widgets



Routen-Registrierung

before_register_routes - Vor der Registrierung von Routen
filter_dashboard_router - Filter für Dashboard-Router
filter_admin_router - Filter für Admin-Router
filter_api_router - Filter für API-Router
after_register_routes - Nach der Registrierung aller Routen



enableInGuild-Methode

before_enable_in_guild - Vor der Guild-spezifischen Aktivierung
enable_in_guild_failed - Bei Fehler während der Aktivierung
before_register_navigation - Vor der Registrierung der Navigation
filter_navigation_items - Filter für die Navigations-Items
after_register_navigation - Nach der Registrierung der Navigation
before_plugin_guild_enable_method - Vor dem Aufruf von plugin.onEnable
plugin_guild_enable_method_failed - Bei Fehler im onEnable-Handler
after_plugin_guild_enable_method - Nach dem Aufruf von plugin.onEnable
before_update_guild_settings - Vor der Aktualisierung der Guild-Einstellungen
modify_guild_enabled_plugins - Filter für die aktivierten Plugins einer Guild
after_update_guild_settings - Nach der Aktualisierung der Guild-Einstellungen
before_guild_specific_enable - Vor dem Aufruf von plugin.onGuildEnable
after_guild_specific_enable - Nach dem Aufruf von plugin.onGuildEnable
after_enable_in_guild - Nach der erfolgreichen Aktivierung in der Guild



disableInGuild-Methode

before_disable_in_guild - Vor der Guild-spezifischen Deaktivierung
disable_in_guild_failed - Bei Fehler während der Deaktivierung
before_guild_specific_disable - Vor dem Aufruf von plugin.onGuildDisable
after_guild_specific_disable - Nach dem Aufruf von plugin.onGuildDisable
before_update_guild_settings_disable - Vor der Aktualisierung der Guild-Einstellungen
after_update_guild_settings_disable - Nach der Aktualisierung der Guild-Einstellungen
after_disable_in_guild - Nach der erfolgreichen Deaktivierung in der Guild

Diese Hooks ermöglichen eine umfassende Erweiterbarkeit des Dashboard-PluginManagers, ähnlich wie im WordPress-System.



Plugin-Integration in das Theme-System
Ein Plugin kann nun auf mehrere Arten mit dem Theme-System interagieren:

1. Eigene Navigation registrieren

- Automatisch durch Bereitstellung eines dashboardRouter oder adminRouter
- Manuell durch Aufruf von app.themeManager.registerNavigation()

2. Hook-Punkte im Theme nutzen

- dashboard_head: Skripts und Styles im Head-Bereich einfügen
- sidebar_after_nav: Elemente in der Sidebar nach der Navigation einfügen
- before_content: Inhalte vor dem Hauptinhalt einfügen
- content_header_actions: Aktions-Buttons in der Kopfzeile einfügen
- after_content: Inhalte nach dem Hauptinhalt einfügen
- dashboard_footer_scripts: Skripts am Ende der Seite einfügen

3. Theme-Overrides
- Ein Plugin kann eigene Theme-Partials bereitstellen, die das Standard-Theme überschreiben


AKTUELLE TODOS:

A. Vereinheitlichung der Plugin-Metadaten
Einheitliches package.json-Format für alle Plugins
Standardisierte Felder für Name, Version, Author, Dashboard/Bot-Komponenten

B. Automatisierte Service-Übergabe
Services wie dbService, ServiceManager, themeManager automatisch an Plugins übergeben
Weniger manuelle Übergabe im Code

C. Vereinfachte Routen- und Navigation-Registrierung
Plugins deklarieren Routen/Navigationspunkte in einer zentralen Methode/Datei
PluginManager liest diese aus und registriert sie automatisch

D. Konsistente Hook-Nutzung
Hooks für alle wichtigen Lebenszyklen (init, enable, disable, guildEnable, guildDisable)
Dokumentation und Standardisierung der Hook-Namen und Parameter

E. Bessere Guild-spezifische Aktivierung
Klare Trennung zwischen globaler und guild-spezifischer Aktivierung
Einheitliche Methoden für beide Kontexte

F. Verbesserte Fehlerbehandlung & Logging
Einheitliches Logging für alle Plugin-Aktionen
Fehler werden klar und verständlich ausgegeben