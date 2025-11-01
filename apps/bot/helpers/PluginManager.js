const fs = require("fs");
const path = require("path");

const { ServiceManager, BasePluginManager } = require("dunebot-core");
const { BotPlugin, Config } = require("dunebot-sdk");

/**
 * Bot-spezifischer Plugin-Manager für die Verwaltung von Bot-Plugins
 * Unterstützt die neue WordPress-ähnliche Plugin-Struktur
 * 
 * @author DuneBot Team
 */
class PluginManager extends BasePluginManager {
    #listeningEvents = new Set();
    #hooks = null;
    #config = null;

    /**
     * Erstellt eine neue Instanz des Bot Plugin Managers
     * @param {import('discord.js').Client} client - Discord.js Client
     * @param {string} registryPath - Pfad zur Plugin-Registry
     * @param {string} pluginDir - Pfad zum Plugin-Verzeichnis
     */
    constructor(client, registryPath, pluginDir) {
        super(registryPath, pluginDir);
        this.client = client;
        
        // NEU: Config-System initialisieren
        //const dbService = ServiceManager.get("dbService");
        //this.#config = new Config("core", dbService);
        // NEU: Korrekte Initialisierung mit pluginDir
        this.#config = new Config("core", path.join(this.pluginsDir, "core"));

        // Optional: HookSystem für Bot-Plugins initialisieren
        try {
            const { HookSystem } = require('dunebot-sdk');
            const Logger = ServiceManager.get("Logger");
            this.#hooks = new HookSystem();
            this.hooks = this.#hooks;
            Logger.debug('Hook-System für Bot-Plugins initialisiert');
        } catch (error) {
            Logger.debug('Hook-System nicht verfügbar, fahre ohne fort');
        }
    }

    /**
     * Initialisiert alle Plugins und deren Abhängigkeiten
     * @returns {Promise<Array>} Liste der geladenen Plugins
     * @throws {Error} Bei Fehlern während der Initialisierung
     * @author FireDervil
     */
    async init() {
        const Logger = ServiceManager.get("Logger");
        const dbService = ServiceManager.get("dbService");

        try {
            if (this.#hooks) {
                await this.#hooks.doAction('before_init');
            }
            
            // NEU: Core Config initialisieren
            await this.#config.init();
            
            // GLOBALE Plugins aus guild_plugins holen (alle aktivierten Plugins über alle Guilds)
            // Dies lädt nur Plugins die mindestens in EINER Guild aktiviert sind
            let enabledPlugins = ["core"]; // Core ist immer aktiviert
            
            try {
                const rows = await dbService.query(`
                    SELECT DISTINCT plugin_name 
                    FROM guild_plugins 
                    WHERE is_enabled = 1
                `);
                
                const guildPlugins = rows.map(row => row.plugin_name);
                enabledPlugins = [...new Set([...enabledPlugins, ...guildPlugins])];
                
                Logger.debug(`Global aktivierte Plugins aus guild_plugins: ${enabledPlugins.join(', ')}`);
            } catch (error) {
                Logger.warn("Fehler beim Laden der aktivierten Plugins aus guild_plugins:", error);
                Logger.warn("Fallback: Nur Core-Plugin wird geladen");
            }

            if (this.#hooks) {
                await this.#hooks.doAction('before_plugins_enable', enabledPlugins);
            }
            
            // Plugins aktivieren
            for (const pluginName of enabledPlugins) {
                if (this.#hooks) {
                    await this.#hooks.doAction('before_plugin_enable', { pluginName });
                }
                
                const pluginResult = await this.enablePlugin(pluginName);
                if (!pluginResult?.success) {
                    Logger.warn(`Plugin ${pluginName} konnte nicht aktiviert werden.`);
                    continue;
                }

                if (this.#hooks) {
                    await this.#hooks.doAction('after_plugin_enable', { 
                        pluginName, 
                        plugin: this.getPlugin(pluginName)
                    });
                }
            }
            
            Logger.success(`Loaded ${this.getPlugins().length} plugins.`);
            
            // "after_init" Hook ausführen
            if (this.#hooks) {
                await this.#hooks.doAction('after_init', this.getPlugins());
            }
            
            return this.getPlugins();
        } catch (error) {
            // "init_failed" Hook ausführen
            if (this.#hooks) {
                await this.#hooks.doAction('init_failed', { error });
            }
            throw error;
        }
    }

    /**
     * Gibt die aktuell registrierten Events zurück
     * @returns {Set<string>} Set von Event-Namen
     */
    get listeningEvents() {
        return this.#listeningEvents;
    }

    /**
     * Bot-spezifische Implementierung der Tabellen-Registrierung
     * Unterstützt die neue Plugin-Verzeichnisstruktur
     * 
     * @param {Object} plugin - Das Plugin-Objekt
     * @returns {Promise<void>}
     */
    async registerBotTables(plugin) {
        const Logger = ServiceManager.get("Logger");

        // Hook vor der Registrierung der Bot-Tabellen ausführen
        if (this.#hooks) {
            await this.#hooks.doAction('before_register_bot_tables', { plugin });
        }
        
        try {
            // Standard-Tabellen-Registrierung (plugin/bot/schemas oder plugin/schemas)
            await super.registerPluginTables(plugin, 'bot');
            
            // Neue Struktur: Prüfen auf spezielle Verzeichnisse in der neuen Struktur
            
            // 1. Bot-spezifische Datenbank-Tabellen
            const botDatabaseDir = path.join(this.pluginsDir, plugin.name, 'bot', 'database');
            if (fs.existsSync(botDatabaseDir)) {
                Logger.debug(`Registriere Bot-Datenbanktabellen aus ${botDatabaseDir} für Plugin ${plugin.name}`);
                await this.registerSchemasFromDir(plugin, botDatabaseDir, 'bot-database');
            }
            
            // 2. Discord-spezifische Modelle
            const discordModelsDir = path.join(this.pluginsDir, plugin.name, 'bot', 'discord-models');
            if (fs.existsSync(discordModelsDir)) {
                Logger.debug(`Registriere Discord-Modelle aus ${discordModelsDir} für Plugin ${plugin.name}`);
                await this.registerSchemasFromDir(plugin, discordModelsDir, 'discord-models');
            }
            
            // 3. Alte Struktur für Abwärtskompatibilität
            const legacyModelsDir = path.join(this.pluginsDir, plugin.name, 'models');
            if (fs.existsSync(legacyModelsDir) && !fs.existsSync(path.join(this.pluginsDir, plugin.name, 'bot', 'models'))) {
                Logger.debug(`Registriere Legacy-Models aus ${legacyModelsDir} für Plugin ${plugin.name}`);
                await this.registerModelsFromDir(plugin, legacyModelsDir, 'legacy');
            }
            
            // Hook nach der Registrierung der Bot-Tabellen ausführen
            if (this.#hooks) {
                await this.#hooks.doAction('after_register_bot_tables', { plugin });
            }
        } catch (error) {
            Logger.error(`Fehler bei der Registrierung der Bot-Tabellen für ${plugin.name}:`, error);
            
            // Hook für fehlgeschlagene Tabellen-Registrierung
            if (this.#hooks) {
                await this.#hooks.doAction('register_bot_tables_failed', { plugin, error });
            }
        }
    }

 /**
 * Aktiviert ein Plugin für den Bot
 * Unterstützt die neue WordPress-ähnliche Plugin-Struktur
 * 
 * @param {string} pluginName - Name des Plugins
 * @returns {Promise<{success: boolean, plugin?: BotPlugin, error?: Error}>}
 */
async enablePlugin(pluginName) {
    const Logger = ServiceManager.get("Logger");
    const dbService = ServiceManager.get("dbService");

    // Hook vor der Aktivierung des Plugins ausführen
    if (this.#hooks) {
        await this.#hooks.doAction('before_enable_plugin', { pluginName });
    }

    const pluginDir = path.join(this.pluginsDir, pluginName);
    const botEntryPoint = path.join(pluginDir, "bot");
    const legacyEntryPoint = pluginDir;

    try {
        // Übersetzungen vor dem Plugin-Laden initialisieren
        if (this.#hooks) {
            await this.#hooks.doAction('before_load_plugin_translations', { pluginName });
        }
        await this.client.i18n.loadPluginTranslations(pluginName);

        // Plugin-Modul laden - zuerst neue Struktur versuchen, dann alte
        let plugin;
        if (fs.existsSync(path.join(botEntryPoint, 'index.js'))) {
            Logger.debug(`Lade Plugin ${pluginName} aus neuer Struktur: ${botEntryPoint}`);
            plugin = require(botEntryPoint);
        } else if (fs.existsSync(path.join(legacyEntryPoint, 'index.js'))) {
            Logger.debug(`Lade Plugin ${pluginName} aus alter Struktur: ${legacyEntryPoint}`);
            plugin = require(legacyEntryPoint);
        } else {
            Logger.info(`Plugin ${pluginDir} hat keinen Bot-Einstiegspunkt. Überspringe.`);
            if (this.#hooks) {
                await this.#hooks.doAction('plugin_load_failed', { 
                    pluginName, 
                    error: new Error('Kein Bot-Einstiegspunkt gefunden') 
                });
            }
            // Immer ein Objekt zurückgeben!
            return { success: false, error: new Error('Kein Bot-Einstiegspunkt gefunden') };
        }

        // Prüfen, ob das Plugin eine gültige BotPlugin-Instanz ist
        if (!plugin || !(plugin instanceof BotPlugin)) {
            throw new Error("Kein gültiges Plugin (Exportiert es eine Instanz der BotPlugin-Klasse?)");
        }

        // Überprüfen, ob das Plugin bereits geladen ist
        if (this.isPluginEnabled(pluginName)) {
            Logger.info(`Plugin ${pluginName} ist bereits aktiviert`);
            return { success: true, plugin };
        }

        // Plugin-Datenbank-Service setzen
        plugin.dbService = dbService;

        // Plugin kann durch einen Hook modifiziert werden
        if (this.#hooks) {
            plugin = await this.#hooks.applyFilters('modify_plugin_instance', plugin, { pluginName });
        }

        // Bot-Tabellen registrieren VOR dem Plugin-Enable
        if (this.#hooks) {
            await this.#hooks.doAction('before_register_bot_tables', { plugin });
        }
        await this.registerBotTables(plugin);

        // Plugin aktivieren
        if (this.#hooks) {
            await this.#hooks.doAction('before_plugin_enable_method', { plugin });
        }
        await plugin.enable(this.client, dbService);

        // Detailliertes Debug-Logging für die Befehle
        Logger.debug(`Plugin ${plugin.name} hat nach dem Enable:`);
        Logger.debug(`- ${plugin.commands.size} Command-Objekte`);
        Logger.debug(`- ${plugin.prefixCount} Prefix-Commands laut Zähler`);
        Logger.debug(`- ${plugin.slashCount} Slash-Commands laut Zähler`);

        // Überprüfe, ob die commands-Collection korrekt initialisiert ist
        if (!plugin.commands || !(plugin.commands instanceof Set)) {
            Logger.warn(`Plugin ${plugin.name} hat keine gültige commands-Collection!`);
            plugin.commands = new Set();
        }

        // Liste alle gefundenen Befehle auf
        for (const cmd of plugin.commands) {
            Logger.debug(`- Befehl: ${cmd.name || 'Unbenannt'} (prefix=${!!cmd.command?.enabled}, slash=${!!cmd.slashCommand?.enabled})`);
        }

        // Commands registrieren
        if (plugin.commands.size > 0) {
            this.client.commandManager.registerPlugin(plugin);
        } else {
            Logger.warn(`Plugin ${plugin.name} hat keine Befehle zum Registrieren`);
        }

        // Events aus dem Plugin registrieren und zum #listeningEvents-Set hinzufügen
        if (plugin.eventHandlers && plugin.eventHandlers.size > 0) {
            plugin.eventHandlers.forEach((handler, eventName) => {
                this.#listeningEvents.add(eventName);
                Logger.debug(`Event "${eventName}" aus Plugin "${pluginName}" registriert`);
            });

            // Debug-Log für wichtige Events
            const importantEvents = ['guildCreate', 'guildDelete'];
            importantEvents.forEach(eventName => {
                if (plugin.eventHandlers.has(eventName)) {
                    Logger.info(`Wichtiges Event "${eventName}" aus Plugin "${pluginName}" registriert`);
                }
            });
        }

            // WICHTIG: Commands global beim Plugin Manager registrieren
        // Dies muss VOR updatePluginStatus geschehen, damit die Commands bekannt sind
        await this.client.commandManager.registerPlugin(plugin);
        
        // Guild-Commands aktualisieren - löst Command-Registrierung bei Discord aus
        await this.client.commandManager.updatePluginStatus(pluginName, true);

        // Plugin registrieren
        this.setPlugin(pluginName, plugin);        
        if (this.#hooks) {
            await this.#hooks.doAction('after_plugin_registered', { plugin });
        }

        // HINWEIS: Globale ENABLED_PLUGINS Config ist obsolet
        // Plugins werden jetzt per guild_plugins Tabelle pro Guild aktiviert
        // Die init() Methode lädt alle Plugins die in mind. einer Guild aktiv sind

        Logger.success(`Plugin ${pluginName} aktiviert [${plugin.prefixCount} Prefix, ${plugin.slashCount} Slash]`);
        if (this.#hooks) {
            await this.#hooks.doAction('after_enable_plugin', { plugin });
        }
        return { success: true, plugin };
    } catch (error) {
        Logger.error(`Fehler beim Aktivieren des Plugins ${pluginName}:`, error);
        if (this.#hooks) {
            await this.#hooks.doAction('enable_plugin_failed', { pluginName, error });
        }
        // Bei Fehlern immer ein Objekt zurückgeben:
        return { success: false, error };
    }
}

    /**
     * Aktiviert ein Plugin für eine bestimmte Guild
     * @param {string} pluginName - Name des Plugins
     * @param {string} guildId - ID der Guild
     * @returns {Promise<boolean>} Erfolgsstatus
     */
    async enableInGuild(pluginName, guildId) {
        const Logger = ServiceManager.get("Logger");
        const dbService = ServiceManager.get("dbService");

        try {
            // Pre-Hook
            if (this.#hooks) {
                await this.#hooks.doAction('before_enable_in_guild', { pluginName, guildId });
            }

            // Plugin laden wenn noch nicht geladen
            if (!this.isPluginEnabled(pluginName)) {
                Logger.debug(`Plugin ${pluginName} wird für Guild ${guildId} geladen...`);
                const result = await this.enablePlugin(pluginName);
                
                // Plugin aktivieren
                if (!result?.success) {
                    throw new Error(`Plugin ${pluginName} konnte nicht geladen werden`);
                }
            }

            const plugin = this.getPlugin(pluginName);
            if (!plugin) {
                throw new Error(`Plugin ${pluginName} konnte nicht gefunden werden`);
            }

            // Navigation Setup
            if (this.#hooks) {
                await this.#hooks.doAction('before_register_navigation', { plugin, guildId });
            }

            let navigationItems = [];
            if (plugin.getGuildNavigationItems) {
                navigationItems = plugin.getGuildNavigationItems(guildId);
                
                // Navigation Items Filter Hook
                if (this.#hooks) {
                    navigationItems = await this.#hooks.applyFilters(
                        'filter_navigation_items',
                        navigationItems,
                        { plugin, guildId }
                    );
                }

                // Navigation registrieren wenn Items vorhanden
                if (navigationItems.length > 0) {
                    const navManager = ServiceManager.get('navigationManager');
                    if (navManager) {
                        await navManager.registerNavigation(pluginName, guildId, navigationItems);
                        Logger.debug(`Navigation für Plugin ${pluginName} in Guild ${guildId} registriert`);
                    }
                }
            }

            if (this.#hooks) {
                await this.#hooks.doAction('after_register_navigation', { plugin, guildId, navigationItems });
            }

            // Plugin für Guild aktivieren
            if (plugin.onGuildEnable) {
                if (this.#hooks) {
                    await this.#hooks.doAction('before_guild_specific_enable', { plugin, guildId });
                }

                await plugin.onGuildEnable(guildId);

                if (this.#hooks) {
                    await this.#hooks.doAction('after_guild_specific_enable', { plugin, guildId });
                }
            }

            // NEU: guild_plugins Tabelle aktualisieren statt ENABLED_PLUGINS JSON
            const pluginObj = this.getPlugin(pluginName);
            const pluginVersion = pluginObj?.version || null;
            
            // User-ID aus Session extrahieren (falls verfügbar, sonst null)
            // Im Bot-Context haben wir keine Session, daher ist userId immer null
            const userId = null;
            
            await dbService.enablePluginForGuild(guildId, pluginName, pluginVersion, userId);
            
            Logger.debug(`Plugin ${pluginName} in guild_plugins für Guild ${guildId} aktiviert`);

            // NEU: CommandManager benachrichtigen, um Commands neu zu registrieren
            Logger.debug(`Aktualisiere Commands für Guild ${guildId} nach Plugin-Aktivierung: ${pluginName}`);
            await this.client.commandManager.updatePluginStatus(pluginName, true, guildId);

            Logger.success(`Plugin ${pluginName} erfolgreich für Guild ${guildId} aktiviert`);
            
            // Final Hook
            if (this.#hooks) {
                await this.#hooks.doAction('after_enable_in_guild', { plugin, guildId });
            }

            return true;

        } catch (error) {
            Logger.error(`Fehler beim Aktivieren des Plugins ${pluginName} für Guild ${guildId}:`, error);
            if (this.#hooks) {
                await this.#hooks.doAction('enable_in_guild_failed', { pluginName, guildId, error });
            }
            throw error;
        }
    }

    /**
     * Debug-Funktion, die alle registrierten Events und ihre Handler anzeigt
     */
    debugEvents() {
        const Logger = ServiceManager.get("Logger");
        Logger.info("=== PLUGIN EVENT DEBUG ===");
        
        // Alle registrierten Events auflisten
        Logger.info(`Registrierte Events (${this.#listeningEvents.size}): ${Array.from(this.#listeningEvents).join(', ')}`);
        
        // Für jedes Plugin die registrierten Events anzeigen
        for (const plugin of this.plugins) {
            const events = plugin.eventHandlers ? Array.from(plugin.eventHandlers.keys()) : [];
            Logger.info(`Plugin ${plugin.name} hat ${events.length} Event-Handler: ${events.join(', ')}`);
            
            // Prüfen, ob wichtige Events vorhanden sind
            if (events.includes('guildCreate')) {
                Logger.info(`[WICHTIG] Plugin ${plugin.name} hat Handler für guildCreate-Event`);
            }
            
            if (events.includes('guildDelete')) {
                Logger.info(`[WICHTIG] Plugin ${plugin.name} hat Handler für guildDelete-Event`);
            }
        }
        
        Logger.info("=========================");
    }

    /**
     * Gibt alle aktuell registrierten Plugins zurück
     * @returns {Map<string, BotPlugin>} Map der Plugins mit Name als Schlüssel
     */
    getPlugins() {
        // Erstelle eine Map mit allen Plugins
        const pluginsMap = new Map();
        
        for (const plugin of this.plugins) {
            pluginsMap.set(plugin.name, plugin);
        }
        
        return pluginsMap;
    }

    /**
     * Aktiviert ein Plugin für eine bestimmte Guild
     * @param {string} pluginName - Name des Plugins
     * @param {string} guildId - ID der Guild
     * @returns {Promise<boolean>} Erfolgsstatus
     */

    /**
     * Deaktiviert ein Plugin für eine bestimmte Guild
     * @param {string} pluginName - Name des Plugins
     * @param {string} guildId - ID der Guild
     * @returns {Promise<boolean>} Erfolgsstatus
     */
    async disableInGuild(pluginName, guildId) {
        const Logger = ServiceManager.get("Logger");
        const dbService = ServiceManager.get("dbService");
        if (this.#hooks) {
            await this.#hooks.doAction('before_disable_in_guild', { pluginName, guildId });
        }
        try {
            const plugin = this.getPlugin(pluginName);
            if (!plugin) {
                throw new Error(`Plugin ${pluginName} ist nicht aktiviert.`);
            }
            if (this.#hooks) {
                await this.#hooks.doAction('before_guild_specific_disable', { plugin, guildId });
            }
            if (plugin.onGuildDisable) {
                await plugin.onGuildDisable(guildId);
            }
            if (this.#hooks) {
                await this.#hooks.doAction('after_guild_specific_disable', { plugin, guildId });
            }
            if (this.#hooks) {
                await this.#hooks.doAction('before_update_guild_settings_disable', { plugin, guildId });
            }

            // NEU: guild_plugins Tabelle aktualisieren statt ENABLED_PLUGINS JSON
            // User-ID aus Session extrahieren (im Bot-Context immer null)
            const userId = null;
            
            await dbService.disablePluginForGuild(guildId, pluginName, userId);
            
            Logger.debug(`Plugin ${pluginName} in guild_plugins für Guild ${guildId} deaktiviert`);

            if (this.#hooks) {
                await this.#hooks.doAction('after_update_guild_settings_disable', { plugin, guildId });
            }
            
            // NEU: CommandManager benachrichtigen, um Commands neu zu registrieren
            Logger.debug(`Aktualisiere Commands für Guild ${guildId} nach Plugin-Deaktivierung: ${pluginName}`);
            await this.client.commandManager.updatePluginStatus(pluginName, false, guildId);
            
            Logger.success(`Plugin ${pluginName} erfolgreich für Guild ${guildId} deaktiviert`);
            if (this.#hooks) {
                await this.#hooks.doAction('after_disable_in_guild', { plugin, guildId });
            }
            return true;
        } catch (error) {
            Logger.error(`Fehler beim Deaktivieren des Plugins ${pluginName} für Guild ${guildId}:`, error);
            if (this.#hooks) {
                await this.#hooks.doAction('disable_in_guild_failed', { pluginName, guildId, error });
            }
            return false;
        }
    }

    
    /**
     * Calls the event handlers of all plugins.
     * @param {string} eventName
     * @param  {...any} args
     * @returns {Promise<Array|Object>} Results of event handlers
     */
    async emit(eventName, ...args) {
        const Logger = ServiceManager.get("Logger");
        const dbService = ServiceManager.get("dbService");

        // 1. Prüfen ob Events für dieses Plugin registriert sind
        if (!this.#listeningEvents.has(eventName)) {
            return [];
        }

        // 2. Default: Nur Core-Plugin ist aktiviert
        let enabled_plugins = ["core"]; // Core ist IMMER aktiviert

        // 3. Guild-Kontext ermitteln und guild-spezifische Plugins laden
        try {
            // WICHTIG: args[0] ist die Interaction/Message, NICHT die Guild!
            // Die Guild ist unter args[0].guild zu finden
            const firstArg = args[0];
            const guildPartial = firstArg?.guild || firstArg; // Fallback für direkte Guild-Events
            
            if (guildPartial?.id && eventName !== "guildCreate") {
                // =====================================================
                // KRITISCH: Guild aus Cache holen statt Partial zu nutzen!
                // Discord sendet manchmal nur Partial-Objekte ohne .client!
                // =====================================================
                
                const guildId = guildPartial.id;
                
                // Client vom Partial oder vom PluginManager holen
                const client = this.client;
                
                if (!client) {
                    Logger.error(`[PluginManager] ❌ Kein Discord-Client verfügbar für Guild ${guildId}!`);
                    return [];
                }
                
                // Guild aus dem Cache holen (die ECHTE Guild, nicht das Partial!)
                const guild = client.guilds.cache.get(guildId);
                
                // AUSNAHME: Bei guildDelete ist es NORMAL dass Guild nicht im Cache ist!
                if (!guild && eventName !== "guildDelete") {
                    Logger.error(`[PluginManager] ❌ GHOST-ID BLOCKIERT: Guild ${guildId} NICHT im Discord-Cache!`);
                    Logger.error(`[PluginManager] Event="${eventName}", Partial=${!guildPartial.name}`);
                    Logger.error(`[PluginManager] Bekannte Guilds: ${Array.from(client.guilds.cache.keys()).join(', ')}`);
                    return []; // Strikt blockieren (außer bei guildDelete)
                }
                
                if (guild) {
                    Logger.debug(`[PluginManager] ✅ Guild gefunden: ${guild.name} (${guild.id})`);
                } else if (eventName === "guildDelete") {
                    Logger.debug(`[PluginManager] ✅ guildDelete Event für Guild ${guildId} (Cache-Ausnahme)`);
                }
                
                // 2. Prüfen ob Guild in Datenbank ist
                const [guildExists] = await dbService.query(
                    "SELECT 1 FROM guilds WHERE _id = ? LIMIT 1",
                    [guildId]
                );
                
                if (!guildExists) {
                    Logger.error(`[PluginManager] ❌ GHOST-ID BLOCKIERT: Guild ${guildId} NICHT in Datenbank!`);
                    Logger.error(`[PluginManager] Guild muss erst via guildCreate registriert werden!`);
                    return []; // Strikt blockieren
                }
                
                // Guild ist valide - Configs laden
                // NEU: guild_plugins Tabelle statt configs.ENABLED_PLUGINS
                const pluginRows = await dbService.query(
                    "SELECT plugin_name FROM guild_plugins WHERE guild_id = ? AND is_enabled = 1",
                    [guildId] // Verwende guildId statt guild.id (für guildDelete Kompatibilität)
                );
                
                enabled_plugins = pluginRows.map(row => row.plugin_name);
                
                // Sicherstellen dass core immer aktiviert ist
                if (!enabled_plugins.includes("core")) {
                    enabled_plugins.push("core");
                }
                
                Logger.debug(`[PluginManager] Aktivierte Plugins für Guild ${guildId}: ${enabled_plugins.join(', ')}`);
            }
        } catch (error) {
            Logger.warn(`[PluginManager] Fehler beim Ermitteln aktivierter Plugins für Event ${eventName}:`, error);
            return []; // Bei Fehlern keine Plugins ausführen
        }

        // 4. Implementierung mit Promise.all und Abhängigkeiten
        const pluginResults = await Promise.all(
            this.plugins
                .filter(
                    (plugin) =>
                        enabled_plugins.includes(plugin.name) &&
                        plugin.eventHandlers && 
                        plugin.eventHandlers.has(eventName) &&
                        (!plugin.dependencies || plugin.dependencies.length === 0)
                )
                .map(async (plugin) => {
                    try {
                        const handler = plugin.eventHandlers.get(eventName);
                        const data = await handler(...args);
                        return { name: plugin.name, success: true, data };
                    } catch (error) {
                        Logger.error(`Error in plugin ${plugin.name}:`, error);
                        return { name: plugin.name, success: false, data: null };
                    }
                })
        );

        return pluginResults;

        // Response-Map erstellen für Plugins mit Abhängigkeiten
        const responseMap = Object.fromEntries(
            results.map((result) => [result.name, { success: result.success, data: result.data }])
        );

        // Plugins mit Abhängigkeiten ausführen
        for (const plugin of this.plugins.filter(
            (p) =>
                enabled_plugins.includes(p.name) &&
                p.eventHandlers && 
                p.eventHandlers.has(eventName) &&
                p.dependencies && 
                p.dependencies.length > 0
        )) {
            const depArgs = Object.fromEntries(
                plugin.dependencies.map((dep) => [dep, responseMap[dep]])
            );

            try {
                const handler = plugin.eventHandlers.get(eventName);
                const data = await handler(...args, depArgs);
                responseMap[plugin.name] = { success: true, data };
            } catch (error) {
                Logger.error(`Error in plugin ${plugin.name}:`, error);
                responseMap[plugin.name] = { success: false, data: null };
            }
        }

        return responseMap;
    }
    
}

module.exports = PluginManager;