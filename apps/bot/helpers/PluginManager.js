const fs = require("fs");
const path = require("path");

const { ServiceManager, BasePluginManager } = require("dunebot-core");
const { BotPlugin } = require("dunebot-sdk");


/**
 * Bot-spezifischer Plugin-Manager für die Verwaltung von Bot-Plugins
 * Unterstützt die neue WordPress-ähnliche Plugin-Struktur
 * 
 * @author DuneBot Team
 */
class PluginManager extends BasePluginManager {
    #listeningEvents = new Set();
    #hooks = null;

    /**
     * Erstellt eine neue Instanz des Bot Plugin Managers
     * @param {import('discord.js').Client} client - Discord.js Client
     * @param {string} registryPath - Pfad zur Plugin-Registry
     * @param {string} pluginDir - Pfad zum Plugin-Verzeichnis
     */
    constructor(client, registryPath, pluginDir) {
        super(registryPath, pluginDir);
        this.client = client;
        
        // Optional: HookSystem für Bot-Plugins initialisieren
        try {
            const { HookSystem } = require('dunebot-sdk');
            const Logger = ServiceManager.get("Logger");
            this.#hooks = new HookSystem();
            this.hooks = this.#hooks; // Öffentlich verfügbar machen
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
            // "before_init" Hook ausführen
            if (this.#hooks) {
                await this.#hooks.doAction('before_init');
            }
            
            if (!dbService) {
                throw new Error("dbService not in ServiceManager. Call ServiceManager.get(SERVICE) first.");
            }
            
            // Plugins aus der Datenbank laden
            const result = await dbService.query(
                "SELECT * FROM configs WHERE plugin_name = 'core' AND config_key = 'ENABLED_PLUGINS' AND context = 'shared' LIMIT 1"
            );
            
            let enabledPlugins = ["core"]; // Core immer aktiviert
            if (result && result[0]?.config_value) {
                try {
                    enabledPlugins = JSON.parse(result[0].config_value);
                } catch (e) {
                    Logger.warn("Fehler beim Parsen der aktivierten Plugins:", e);
                }
            }
            
            // "before_plugins_enable" Hook ausführen
            if (this.#hooks) {
                await this.#hooks.doAction('before_plugins_enable', enabledPlugins);
            }
            
            // Plugins aktivieren
            for (const pluginName of enabledPlugins) {
                // "before_plugin_enable" Hook ausführen
                if (this.#hooks) {
                    await this.#hooks.doAction('before_plugin_enable', { pluginName });
                }
                
                const pluginResult = await this.enablePlugin(pluginName);
                // Hier prüfen wir den Rückgabewert korrekt
                if (!pluginResult || !pluginResult.success) {
                    Logger.warn(`Plugin ${pluginName} konnte nicht aktiviert werden.`);
                    continue;
                }
                
                // "after_plugin_enable" Hook ausführen
                if (this.#hooks) {
                    await this.#hooks.doAction('after_plugin_enable', { 
                        pluginName, 
                        plugin: this.getPlugin(pluginName)
                    });
                }
            }
            
            // "after_plugins_enable" Hook ausführen
            if (this.#hooks) {
                await this.#hooks.doAction('after_plugins_enable', this.getPlugins());
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

        // Guild-Commands aktualisieren
        await this.client.commandManager.updatePluginStatus(pluginName, true);

        // Plugin registrieren
        this.setPlugin(pluginName, plugin);

        if (this.#hooks) {
            await this.#hooks.doAction('after_plugin_registered', { plugin });
        }

        // Core-Config aktualisieren, wenn es nicht das Core-Plugin ist
        if (pluginName !== "core") {
            // Beispiel: Core-Konfiguration in der DB aktualisieren
            const [config] = await dbService.query(
                "SELECT * FROM configs WHERE plugin_name = 'core' AND config_key = 'ENABLED_PLUGINS' AND context = 'shared' LIMIT 1"
            );
            let enabledPlugins = [];
            if (config && config.config_value) {
                try {
                    enabledPlugins = JSON.parse(config.config_value);
                } catch (e) {
                    Logger.warn("Fehler beim Parsen der Core-Konfiguration:", e);
                }
            }
            if (!enabledPlugins.includes(pluginName)) {
                enabledPlugins.push(pluginName);
                await dbService.query(
                    "UPDATE configs SET config_value = ? WHERE plugin_name = 'core' AND config_key = 'ENABLED_PLUGINS' AND context = 'shared'",
                    [JSON.stringify(enabledPlugins)]
                );
            }
        }

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

        if (this.#hooks) {
            await this.#hooks.doAction('before_enable_in_guild', { pluginName, guildId });
        }
        
        try {
            const plugin = this.getPlugin(pluginName);
            if (!plugin) {
                throw new Error(`Plugin ${pluginName} ist nicht aktiviert.`);
            }

            // Guild-spezifische Navigation registrieren
            if (this.#hooks) {
                await this.#hooks.doAction('before_register_navigation', { plugin, guildId });
            }
            
            // Navigation für dieses Plugin in der Guild registrieren
            let navigationItems = [];
            if (plugin.getGuildNavigationItems) {
                navigationItems = plugin.getGuildNavigationItems(guildId);
                
                if (this.#hooks) {
                    navigationItems = await this.#hooks.applyFilters('filter_navigation_items', navigationItems, { plugin, guildId });
                }
            }
            
            if (this.#hooks) {
                await this.#hooks.doAction('after_register_navigation', { plugin, guildId, navigationItems });
            }

            // Plugin-spezifische Initialisierung für die Guild
            if (this.#hooks) {
                await this.#hooks.doAction('before_plugin_guild_enable_method', { plugin, guildId });
            }
            
            if (plugin.onEnable) {
                try {
                    await plugin.onEnable(this.client, guildId);
                } catch (error) {
                    Logger.error(`Fehler beim Aufrufen von onEnable für Plugin ${pluginName} in Guild ${guildId}:`, error);
                    
                    if (this.#hooks) {
                        await this.#hooks.doAction('plugin_guild_enable_method_failed', { plugin, guildId, error });
                    }
                }
            }
            
            if (this.#hooks) {
                await this.#hooks.doAction('after_plugin_guild_enable_method', { plugin, guildId });
            }
            
            // Guild-Einstellungen aktualisieren
            if (this.#hooks) {
                await this.#hooks.doAction('before_update_guild_settings', { plugin, guildId });
            }
            
            // Prüfen, ob Guild-Settings existieren
            const [settings] = await dbService.query(
                "SELECT * FROM guild_settings WHERE guild_id = ? LIMIT 1",
                [guildId]
            );
            
            let enabledPlugins = [];
            if (settings) {
                enabledPlugins = JSON.parse(settings.enabled_plugins || "[]");
            }
            
            // Filter für aktivierte Plugins anwenden
            if (this.#hooks) {
                enabledPlugins = await this.#hooks.applyFilters('modify_guild_enabled_plugins', enabledPlugins, { plugin, guildId });
            }
            
            if (!enabledPlugins.includes(pluginName)) {
                enabledPlugins.push(pluginName);
                
                // Settings aktualisieren oder erstellen
                await dbService.query(`
                    INSERT INTO guild_settings (guild_id, enabled_plugins)
                    VALUES (?, ?)
                    ON DUPLICATE KEY UPDATE enabled_plugins = VALUES(enabled_plugins)
                `, [
                    guildId,
                    JSON.stringify(enabledPlugins)
                ]);
            }
            
            if (this.#hooks) {
                await this.#hooks.doAction('after_update_guild_settings', { plugin, guildId, enabledPlugins });
            }
            
            // Guild-spezifische Plugin-Aktivierung
            if (this.#hooks) {
                await this.#hooks.doAction('before_guild_specific_enable', { plugin, guildId });
            }
            
            if (plugin.onGuildEnable) {
                await plugin.onGuildEnable(guildId);
            }
            
            if (this.#hooks) {
                await this.#hooks.doAction('after_guild_specific_enable', { plugin, guildId });
            }
            
            // Slash-Commands für die Guild aktualisieren
            await this.client.commandManager.registerCommandsForGuild(guildId);
            
            Logger.success(`Plugin ${pluginName} erfolgreich für Guild ${guildId} aktiviert`);
            
            if (this.#hooks) {
                await this.#hooks.doAction('after_enable_in_guild', { plugin, guildId });
            }
            
            return true;
        } catch (error) {
            Logger.error(`Fehler beim Aktivieren des Plugins ${pluginName} für Guild ${guildId}:`, error);
            
            if (this.#hooks) {
                await this.#hooks.doAction('enable_in_guild_failed', { pluginName, guildId, error });
            }
            
            return false;
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

            // Guild-spezifische Plugin-Deaktivierung
            if (this.#hooks) {
                await this.#hooks.doAction('before_guild_specific_disable', { plugin, guildId });
            }
            
            if (plugin.onGuildDisable) {
                await plugin.onGuildDisable(guildId);
            }
            
            if (this.#hooks) {
                await this.#hooks.doAction('after_guild_specific_disable', { plugin, guildId });
            }

            // Guild-Einstellungen aktualisieren
            if (this.#hooks) {
                await this.#hooks.doAction('before_update_guild_settings_disable', { plugin, guildId });
            }
            
            // Settings aus der Datenbank abrufen
            const [settings] = await dbService.query(
                "SELECT * FROM guild_settings WHERE guild_id = ? LIMIT 1",
                [guildId]
            );
            
            if (settings) {
                let enabledPlugins = JSON.parse(settings.enabled_plugins || "[]");
                const index = enabledPlugins.indexOf(pluginName);
                
                if (index > -1) {
                    enabledPlugins.splice(index, 1);
                    await dbService.query(
                        "UPDATE guild_settings SET enabled_plugins = ? WHERE guild_id = ?",
                        [JSON.stringify(enabledPlugins), guildId]
                    );
                }
            }
            
            if (this.#hooks) {
                await this.#hooks.doAction('after_update_guild_settings_disable', { plugin, guildId });
            }

            // Slash-Commands für die Guild aktualisieren
            await this.client.commandManager.registerCommandsForGuild(guildId);
            
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
     * Aktiviert ein Plugin für eine bestimmte Guild
     * @param {string} pluginName - Name des Plugins
     * @param {string} guildId - ID der Guild
     * @returns {Promise<boolean>} Erfolgsstatus
     */
    async enableInGuild(pluginName, guildId) {
        const Logger = ServiceManager.get("Logger");
        const dbService = ServiceManager.get("dbService");
        // Hook vor der Aktivierung des Plugins in der Guild ausführen
        if (this.#hooks) {
            await this.#hooks.doAction('before_enable_in_guild', { pluginName, guildId });
        }
        
        try {
            const plugin = this.getPlugin(pluginName);
            if (!plugin) {
                throw new Error(`Plugin ${pluginName} ist nicht aktiviert.`);
            }

            // Guild-spezifische Navigation registrieren
            if (this.#hooks) {
                await this.#hooks.doAction('before_register_navigation', { plugin, guildId });
            }
            
            // Navigation für dieses Plugin in der Guild registrieren
            // Diese Funktion muss implementiert werden, wenn Navigationseinträge unterstützt werden sollen
            let navigationItems = [];
            if (plugin.getGuildNavigationItems) {
                navigationItems = plugin.getGuildNavigationItems(guildId);
                
                // Filter anwenden, um Navigationselemente zu modifizieren
                if (this.#hooks) {
                    navigationItems = await this.#hooks.applyFilters('filter_navigation_items', navigationItems, { plugin, guildId });
                }
                
                // Hier könnte Navigation in der Datenbank gespeichert werden
            }
            
            if (this.#hooks) {
                await this.#hooks.doAction('after_register_navigation', { plugin, guildId, navigationItems });
            }

            // Plugin-spezifische Initialisierung für die Guild
            if (this.#hooks) {
                await this.#hooks.doAction('before_plugin_guild_enable_method', { plugin, guildId });
            }
            
            // onEnable-Methode des Plugins aufrufen, falls vorhanden
            if (plugin.onEnable) {
                try {
                    await plugin.onEnable(this.client, guildId);
                } catch (error) {
                    Logger.error(`Fehler beim Aufrufen von onEnable für Plugin ${pluginName} in Guild ${guildId}:`, error);
                    
                    if (this.#hooks) {
                        await this.#hooks.doAction('plugin_guild_enable_method_failed', { plugin, guildId, error });
                    }
                }
            }
            
            if (this.#hooks) {
                await this.#hooks.doAction('after_plugin_guild_enable_method', { plugin, guildId });
            }
            
            // Guild-Einstellungen aktualisieren
            if (this.#hooks) {
                await this.#hooks.doAction('before_update_guild_settings', { plugin, guildId });
            }
            
            // Guild-Settings-Modell abrufen (oder erstellen, falls es nicht existiert)
            const GuildSettings = this.dbService.getModel("GuildSettings");
            let settings = await GuildSettings.findOne({ where: { guild_id: guildId } });
            
            if (!settings) {
                settings = await GuildSettings.create({
                    guild_id: guildId,
                    enabled_plugins: JSON.stringify([]),
                });
            }
            
            // Aktivierte Plugins für die Guild abrufen und aktualisieren
            let enabledPlugins = JSON.parse(settings.enabled_plugins || "[]");
            
            // Filter für aktivierte Plugins anwenden
            if (this.#hooks) {
                enabledPlugins = await this.#hooks.applyFilters('modify_guild_enabled_plugins', enabledPlugins, { plugin, guildId });
            }
            
            if (!enabledPlugins.includes(pluginName)) {
                enabledPlugins.push(pluginName);
                settings.enabled_plugins = JSON.stringify(enabledPlugins);
                await settings.save();
            }
            
            if (this.#hooks) {
                await this.#hooks.doAction('after_update_guild_settings', { plugin, guildId, settings });
            }
            
            // Guild-spezifische Plugin-Aktivierung
            if (this.#hooks) {
                await this.#hooks.doAction('before_guild_specific_enable', { plugin, guildId });
            }
            
            if (plugin.onGuildEnable) {
                await plugin.onGuildEnable(guildId);
            }
            
            if (this.#hooks) {
                await this.#hooks.doAction('after_guild_specific_enable', { plugin, guildId });
            }
            
            // Slash-Commands für die Guild aktualisieren
            await this.client.commandManager.registerCommandsForGuild(guildId);
            
            Logger.success(`Plugin ${pluginName} erfolgreich für Guild ${guildId} aktiviert`);
            
            // Hook nach der Aktivierung des Plugins in der Guild ausführen
            if (this.#hooks) {
                await this.#hooks.doAction('after_enable_in_guild', { plugin, guildId });
            }
            
            return true;
        } catch (error) {
            Logger.error(`Fehler beim Aktivieren des Plugins ${pluginName} für Guild ${guildId}:`, error);
            
            // Hook für fehlgeschlagene Plugin-Aktivierung in der Guild
            if (this.#hooks) {
                await this.#hooks.doAction('enable_in_guild_failed', { pluginName, guildId, error });
            }
            
            return false;
        }
    }

    /**
     * Deaktiviert ein Plugin für eine bestimmte Guild
     * @param {string} pluginName - Name des Plugins
     * @param {string} guildId - ID der Guild
     * @returns {Promise<boolean>} Erfolgsstatus
     */
    async disableInGuild(pluginName, guildId) {
        const Logger = ServiceManager.get("Logger");
        const dbService = ServiceManager.get("dbService");
        // Hook vor der Deaktivierung des Plugins in der Guild ausführen
        if (this.#hooks) {
            await this.#hooks.doAction('before_disable_in_guild', { pluginName, guildId });
        }
        
        try {
            const plugin = this.getPlugin(pluginName);
            if (!plugin) {
                throw new Error(`Plugin ${pluginName} ist nicht aktiviert.`);
            }

            // Guild-spezifische Plugin-Deaktivierung
            if (this.#hooks) {
                await this.#hooks.doAction('before_guild_specific_disable', { plugin, guildId });
            }
            
            if (plugin.onGuildDisable) {
                await plugin.onGuildDisable(guildId);
            }
            
            if (this.#hooks) {
                await this.#hooks.doAction('after_guild_specific_disable', { plugin, guildId });
            }

            // Guild-Einstellungen aktualisieren
            if (this.#hooks) {
                await this.#hooks.doAction('before_update_guild_settings_disable', { plugin, guildId });
            }
            
            const GuildSettings = this.dbService.getModel("GuildSettings");
            let settings = await GuildSettings.findOne({ where: { guild_id: guildId } });
            
            if (settings) {
                let enabledPlugins = JSON.parse(settings.enabled_plugins || "[]");
                const index = enabledPlugins.indexOf(pluginName);
                
                if (index > -1) {
                    enabledPlugins.splice(index, 1);
                    settings.enabled_plugins = JSON.stringify(enabledPlugins);
                    await settings.save();
                }
            }
            
            if (this.#hooks) {
                await this.#hooks.doAction('after_update_guild_settings_disable', { plugin, guildId });
            }

            // Slash-Commands für die Guild aktualisieren
            await this.client.commandManager.registerCommandsForGuild(guildId);
            
            Logger.success(`Plugin ${pluginName} erfolgreich für Guild ${guildId} deaktiviert`);
            
            // Hook nach der Deaktivierung des Plugins in der Guild ausführen
            if (this.#hooks) {
                await this.#hooks.doAction('after_disable_in_guild', { plugin, guildId });
            }
            
            return true;
        } catch (error) {
            Logger.error(`Fehler beim Deaktivieren des Plugins ${pluginName} für Guild ${guildId}:`, error);
            
            // Hook für fehlgeschlagene Plugin-Deaktivierung in der Guild
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
        // Prüfen, ob überhaupt Listener für dieses Event registriert sind
        if (!this.#listeningEvents.has(eventName)) {
            return [];
        }
        
        // Debug-Log für kritische Events
        if (["guildCreate", "guildDelete"].includes(eventName)) {
            Logger.debug(`[PluginManager] Verarbeite ${eventName}-Event`);
        }
        
        // Alle aktivierten Plugins ermitteln (Standard: alle Plugins aktiviert)
        let enabled_plugins = this.plugins.map((p) => p.name);
        
        // Guild-spezifische Plugin-Aktivierung berücksichtigen
        try {
            // Bei guildCreate/guildDelete ist das erste Argument die Guild
            const guild = args[0]; 
            
            if (guild && guild.id && eventName !== "guildCreate") {
                // Bei guildCreate sollten wir die Guild-Settings nicht prüfen, da sie noch nicht existieren
                const corePlugin = this.getPlugin("core");
                if (corePlugin && corePlugin.dbService) {
                    const coreSettings = await corePlugin.dbService.getSettings(guild.id);
                    
                    if (coreSettings && coreSettings.enabled_plugins) {
                        try {
                            // Verschiedene Formate unterstützen
                            if (typeof coreSettings.enabled_plugins === 'string') {
                                if (coreSettings.enabled_plugins.startsWith('[')) {
                                    enabled_plugins = JSON.parse(coreSettings.enabled_plugins);
                                } else {
                                    enabled_plugins = coreSettings.enabled_plugins.split(',').map(p => p.trim());
                                }
                            } else if (Array.isArray(coreSettings.enabled_plugins)) {
                                enabled_plugins = coreSettings.enabled_plugins;
                            }
                        } catch (e) {
                            Logger.warn(`[PluginManager] Fehler beim Parsen von enabled_plugins für Guild ${guild.id}:`, e);
                        }
                    }
                }
            }
        } catch (error) {
            Logger.warn(`[PluginManager] Fehler beim Ermitteln aktivierter Plugins für Event ${eventName}:`, error);
        }
        
        // Einfache Implementierung für bessere Fehlerbehebung
        if (process.env.SIMPLE_EVENT_HANDLING === "true") {
            return Array.from(this.getPlugins().values())
                .filter(plugin => 
                    plugin.eventHandlers.has(eventName) && 
                    enabled_plugins.includes(plugin.name)
                )
                .map(plugin => {
                    try {
                        const handler = plugin.eventHandlers.get(eventName);
                        return handler(...args);
                    } catch (error) {
                        Logger.error(`Error in plugin ${plugin.name}::`, error);
                        return undefined;
                    }
                });
        }

        // Standardimplementierung mit Promise.all
        // Zuerst Plugins ohne Abhängigkeiten ausführen
        const results = await Promise.all(
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