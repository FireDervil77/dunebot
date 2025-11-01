const fs = require("fs");
const path = require("path");

const { ServiceManager } = require("dunebot-core");

const { ApplicationCommandType } = require("discord.js");
const { MiscUtils, permissions } = require("./utils");

const Config = require("./Config");



/**
 * Basisklasse für Dunebot-Bot
 * 
 * @author firedervil
 * @class BotPlugin
 */
class BotPlugin {
    /**
     * @param {Object} data - Plugin-Daten
     * @param {string} data.name - Name des Plugins
     * @param {string} data.displayName - Anzeigename des Plugins
     * @param {string} data.description - Beschreibung des Plugins
     * @param {string} data.version - Version des Plugins
     * @param {string} data.author - Autor des Plugins
     * @param {string} data.icon - Icon-Klasse des Plugins
     * @param {string} data.baseDir - Basisverzeichnis des Plugins
     */
    constructor(data) {
        const Logger = ServiceManager.get("Logger");
        
        Logger.debug("Initializing plugin", data);
        BotPlugin.#validate(data);
        
        this.pluginDir = path.join(data.baseDir, "..");
        
        // Versuche zuerst, Daten aus package.json zu laden
        try {
            const packageJson = require(path.join(this.pluginDir, "package.json"));
            this.name = data.name || packageJson.name;
            this.version = data.version || packageJson.version;
            this.displayName = data.displayName || packageJson.displayName || this.name;
            this.description = data.description || packageJson.description || '';
            this.author = data.author || packageJson.author || 'Unbekannt';
        } catch (error) {
            // Fallback, wenn package.json nicht existiert
            this.name = data.name;
            this.displayName = data.displayName || data.name;
            this.description = data.description || '';
            this.version = data.version || '1.0.0';
            this.author = data.author || 'Unbekannt';
        }

        this.baseDir = data.baseDir;
        this.ownerOnly = data.ownerOnly || false;
        this.dependencies = data.dependencies || [];
        this.icon = data.icon || 'fa-solid fa-robot';

        // Callback-Methoden
        this.onEnable = data.onEnable || this.onEnable;
        this.onDisable = data.onDisable || this.onDisable;
        this.onGuildEnable = data.onGuildEnable || this.onGuildEnable;
        this.onGuildDisable = data.onGuildDisable || this.onGuildDisable;
        
        // Event- und Command-Container
        this.eventHandlers = new Map();
        this.events = new Map();
        this.listeningEvents = new Set();
        this.ipcEvents = new Map();
        this.commands = new Set();
        this.contexts = new Set();
        this.prefixCount = 0;
        this.slashCount = 0;
        this.userContextsCount = 0;
        this.messageContextsCount = 0;

        // Konfiguration initialisieren
        this.config = new Config(this.name, this.pluginDir);
        
        Logger.debug(`Initialized plugin "${this.name}" in BotPlugin`);
    }


    /**
     * Aktiviert das Plugin für den Bot
     * 
     * @param {import('discord.js').Client} botClient - Discord.js Client
     * @param {import('dunebot-db-client').DBService} dbService - Datenbank-Service
     * @returns {Promise<void>}
     * @author DuneBot Team
     */
    async enable(botClient) {
        const Logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');

        if (!botClient) throw new TypeError("botClient is required");
        if (!dbService) throw new TypeError("dbService is required or not in ServiceManager"); 

        try {            
            // Config mit dbService initialisieren (nur einmal)
            await this.config.init(dbService);
            
            // Plugin-Struktur laden
            this.#loadPluginStructure();
            
            // WICHTIG: Die Befehlszähler werden bereits in #loadCommands aktualisiert,
            // daher hier KEINE zweite Zählung mehr durchführen
            
            // Plugin-spezifische Initialisierung
            if (this.onEnable) {
                await this.onEnable(botClient);
            }
            
            Logger.debug(`Plugin ${this.name} enabled with commands: ${this.prefixCount} prefix, ${this.slashCount} slash`);
        } catch (error) {
            Logger.error(`Failed to enable plugin ${this.name} in BotPlugin:`, error);
            throw error;
        }
    }

    /**
     * Lädt alle Plugin-Komponenten (Events, Commands, Contexts)
     * @private
     */
    #loadPluginStructure() {
        const Logger = ServiceManager.get('Logger');

        Logger.debug(`Loading plugin structure for ${this.name}`);
        
        // Prüfen auf neue Verzeichnisstruktur (plugins/NAME/bot)
        const botDir = path.join(this.pluginDir, 'bot');
        const isNewStructure = fs.existsSync(botDir);
        
        // Basisverzeichnis für Events, Commands, etc. festlegen
        const baseDir = isNewStructure ? botDir : this.baseDir;
        
        // Events laden
        this.#loadEvents(baseDir);
        
        // Commands laden
        this.#loadCommands(baseDir);
        
        // Contexts laden
        this.#loadContexts(baseDir);
        
        // Erfolgslog mit Details
        const details = {
            events: this.eventHandlers.size,
            ipcEvents: this.ipcEvents.size,
            commands: this.commands.size,
            contexts: this.contexts.size
        };
        
        Logger.debug(`Plugin structure loaded for ${this.name}:`, details);
    }

    /**
     * Lädt alle Events des Plugins
     * @param {string} baseDir - Basisverzeichnis des Plugins
     * @private
     */
    #loadEvents(baseDir) {
        const Logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');
        const eventsDir = `${baseDir}/events`;
        if (!fs.existsSync(eventsDir)) {
            Logger.warn(`Events directory ${eventsDir} not found for plugin ${this.name}`);
            return;
        }

        // Alle Event-Dateien rekursiv einlesen
        const eventFiles = MiscUtils.recursiveReadDirSync(eventsDir)
            .filter(file => !path.basename(file).startsWith('_') && file.endsWith('.js'));

        // IPC-Events separat laden
        const ipcEventsDir = `${eventsDir}/ipc`;
        if (fs.existsSync(ipcEventsDir)) {
            const ipcEventFiles = MiscUtils.recursiveReadDirSync(ipcEventsDir)
                .filter(file => !path.basename(file).startsWith('_') && file.endsWith('.js'));

            for (const file of ipcEventFiles) {
                try {
                    const eventName = path.basename(file, '.js');
                    const event = require(file);

                    if (typeof event !== 'function') {
                        Logger.warn(`IPC event ${eventName} does not export a function in plugin ${this.name}`);
                        continue;
                    }

                    // IPC-Event mit Name und Callback speichern
                    this.ipcEvents.set(eventName, event);
                    Logger.debug(`Loaded IPC event ${eventName} for plugin ${this.name}`);
                } catch (error) {
                    Logger.error(`Error loading IPC event ${file} for plugin ${this.name}:`, error);
                } finally {
                    delete require.cache[require.resolve(file)];
                }
            }
        }

        // Discord.js Events laden
        for (const file of eventFiles) {
            try {
                // IPC-Events überspringen, die werden separat geladen
                if (file.includes('/ipc/')) continue;
                
                const eventName = path.basename(file, '.js');
                const event = require(file);

                if (typeof event !== 'function') {
                    Logger.warn(`Event ${eventName} does not export a function in plugin ${this.name}`);
                    continue;
                }

                // WICHTIG: Event sowohl in events als auch eventHandlers speichern
                this.events.set(eventName, event);
                this.eventHandlers.set(eventName, event); // Diese Zeile wurde hinzugefügt!
                
                // Event zum Plugin Manager hinzufügen für globale Registrierung
                this.listeningEvents.add(eventName);
                
                // Wichtige Events explizit loggen
                if (["guildCreate", "guildDelete", "ready", "interactionCreate", "messageCreate"].includes(eventName)) {
                    Logger.info(`Loaded event ${eventName} for plugin ${this.name}`);
                } else {
                    Logger.debug(`Loaded event ${eventName} for plugin ${this.name}`);
                }
            } catch (error) {
                Logger.error(`Error loading event ${file} for plugin ${this.name}:`, error);
            } finally {
                delete require.cache[require.resolve(file)];
            }
        }

        Logger.info(`Loaded ${this.events.size} events and ${this.ipcEvents.size} IPC events for plugin ${this.name}`);
    }

    /**
     * Lädt alle Commands des Plugins
     * @param {string} baseDir - Basisverzeichnis des Plugins
     * @private
     */
    #loadCommands(baseDir) {
        const Logger = ServiceManager.get('Logger');

        const commandsDir = `${baseDir}/commands`;
        if (!fs.existsSync(commandsDir)) {
            Logger.warn(`Command directory ${commandsDir} not found for plugin ${this.name}`);
            return;
        }

        // Prefix- und Slash-Command-Zähler zurücksetzen
        this.prefixCount = 0;
        this.slashCount = 0;

        // Rekursiv alle Befehlsdateien einlesen (auch in Unterverzeichnissen)
        const commandFiles = MiscUtils.recursiveReadDirSync(commandsDir)
            .filter(file => !path.basename(file).startsWith('_') && file.endsWith('.js'));
            
        Logger.debug(`Found ${commandFiles.length} command files for plugin ${this.name}`);
            
        for (const file of commandFiles) {
            try {
                const cmd = require(file);
                if (typeof cmd !== "object") {
                    Logger.warn(`Command file ${path.basename(file)} does not export an object in plugin ${this.name}`);
                    continue;
                }
                
                // Befehlsnamen aus Dateinamen ableiten, wenn nicht definiert
                if (!cmd.name) {
                    cmd.name = path.basename(file, '.js');
                    Logger.warn(`Command in ${file} has no name property, using filename: ${cmd.name}`);
                }
                
                // Standardwerte setzen
                cmd.enabled = cmd.enabled !== false; // Standardmäßig aktiviert
                cmd.cooldown = cmd.cooldown || 0;
                cmd.botPermissions = cmd.botPermissions || [];
                cmd.userPermissions = cmd.userPermissions || [];
                cmd.validations = cmd.validations || [];
                cmd.command = cmd.command || {};
                cmd.slashCommand = cmd.slashCommand || {};
                
                // Wichtig: Referenz zum Plugin setzen
                cmd.plugin = this;

                // Überprüfen, ob der Befehl aktiviert ist
                if (cmd.enabled === false) {
                    Logger.debug(`Command ${cmd.name} is disabled in plugin ${this.name}`);
                    continue;
                }

                // Präfix und Slash-Befehle richtig zählen
                if (cmd.command && cmd.command.enabled) {
                    this.prefixCount++;
                }
                
                if (cmd.slashCommand && cmd.slashCommand.enabled) {
                    this.slashCount++;
                }

                // Zum Befehlsset hinzufügen
                this.commands.add(cmd);
                Logger.debug(`Loaded command ${cmd.name} in plugin ${this.name} from ${path.basename(file)}`);
            } catch (error) {
                Logger.error(`Error loading command ${file} in plugin ${this.name}:`, error);
            } finally {
                delete require.cache[require.resolve(file)];
            }
        }
        
        // Nach dem Laden Zusammenfassung ausgeben
        if (this.commands.size > 0) {
            Logger.info(`Loaded ${this.commands.size} commands for plugin ${this.name} [${this.prefixCount} Prefix, ${this.slashCount} Slash]`);
        } else {
            Logger.warn(`No commands loaded for plugin ${this.name} from ${commandsDir}`);
        }
    }

    /**
     * Lädt alle Context-Menü-Einträge des Plugins
     * @param {string} baseDir - Basisverzeichnis des Plugins
     * @private
     */
    #loadContexts(baseDir) {
        const Logger = ServiceManager.get('Logger');

        const contextsDir = `${baseDir}/contexts`;
        if (!fs.existsSync(contextsDir)) {
            return;
        }

        const contextFiles = MiscUtils.recursiveReadDirSync(contextsDir)
            .filter(file => !path.basename(file).startsWith('_'));
            
        for (const file of contextFiles) {
            try {
                const context = require(file);
                BotPlugin.#validateContext(context);
                context.plugin = this;
                
                if (context.type === ApplicationCommandType.User) {
                    this.userContextsCount++;
                } else if (context.type === ApplicationCommandType.Message) {
                    this.messageContextsCount++;
                }
                
                this.contexts.add(context);
                Logger.debug(`Loaded context menu ${context.name} in plugin ${this.name}`);
            } catch (error) {
                Logger.error(`Error loading context ${file} in plugin ${this.name}:`, error);
            } finally {
                delete require.cache[require.resolve(file)];
            }
        }
    }

    /**
     * Deaktiviert das Plugin
     * Bereinigt Referenzen und führt Plugin-spezifische Aufräumarbeiten durch
     * 
     * @param {import('discord.js').Client} botClient - Discord.js Client
     * @returns {Promise<void>}
     * @author DuneBot Team
     */
    async disable(botClient) {
        const Logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');

        try {
            // Cleanup
            this.eventHandlers.clear();
            this.commands.clear();
            this.contexts.clear();
            this.prefixCount = 0;
            this.slashCount = 0;

            // DBService cleanup - nur ausführen, wenn die Methode existiert
            if (dbService && typeof dbService.close === 'function') {
                Logger.debug(`Schließe DBService für Plugin ${this.name}`);
                await dbService.close();
            } else {
                // Keine Aktion notwendig, nur ein Debug-Log
                Logger.debug(`Kein DBService.close für Plugin ${this.name} verfügbar`);
            }

            // Plugin-spezifische Cleanup
            if (this.onDisable) {
                Logger.debug(`Führe onDisable für Plugin ${this.name} aus`);
                await this.onDisable(botClient);
            }
            
            Logger.debug(`Plugin ${this.name} erfolgreich deaktiviert`);
        } catch (error) {
            Logger.error(`Failed to disable plugin ${this.name} in BotPlugin:`, error);
            throw error;
        }
    }

    /**
     * Reload-Methode für Plugin-Komponenten
     * Lädt Schemas, Models, Commands und Events neu ohne Server-Restart
     * 
     * @param {Object} options - Reload-Optionen
     * @param {boolean} [options.schemas=true] - Schemas neu laden
     * @param {boolean} [options.models=true] - Models neu registrieren
     * @param {boolean} [options.commands=false] - Commands neu laden
     * @param {boolean} [options.events=false] - Events neu laden
     * @param {boolean} [options.config=false] - Config refreshen
     * @returns {Promise<Object>} Reload-Status mit Details
     * @author DuneBot Team
     */
    async onReload(options = {}) {
        const Logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');
        
        const opts = {
            schemas: options.schemas !== false,
            models: options.models !== false,
            commands: options.commands === true,
            events: options.events === true,
            config: options.config === true
        };
        
        const result = {
            success: true,
            schemas: { loaded: 0, failed: 0, files: [] },
            models: { registered: 0, failed: 0, names: [] },
            commands: { loaded: 0, failed: 0, names: [] },
            events: { loaded: 0, failed: 0, names: [] },
            config: { refreshed: false },
            errors: []
        };
        
        Logger.info(`[Reload] Starting reload for plugin ${this.name}`, opts);
        
        try {
            // 1. Schemas nachladen
            if (opts.schemas && dbService) {
                try {
                    const schemasDir = path.join(this.baseDir, 'schemas');
                    if (fs.existsSync(schemasDir)) {
                        const schemaFiles = fs.readdirSync(schemasDir)
                            .filter(f => f.endsWith('.sql') || f.endsWith('.js'));
                        
                        for (const file of schemaFiles) {
                            try {
                                const schemaPath = path.join(schemasDir, file);
                                
                                if (file.endsWith('.sql')) {
                                    const sql = fs.readFileSync(schemaPath, 'utf8');
                                    await dbService.query(sql);
                                    result.schemas.loaded++;
                                    result.schemas.files.push(file);
                                    Logger.debug(`[Reload] Schema loaded: ${file}`);
                                } else if (file.endsWith('.js')) {
                                    delete require.cache[require.resolve(schemaPath)];
                                    const schema = require(schemaPath);
                                    if (typeof schema === 'function') {
                                        await schema(dbService);
                                    }
                                    result.schemas.loaded++;
                                    result.schemas.files.push(file);
                                    Logger.debug(`[Reload] Schema executed: ${file}`);
                                }
                            } catch (error) {
                                result.schemas.failed++;
                                result.errors.push(`Schema ${file}: ${error.message}`);
                                Logger.error(`[Reload] Failed to load schema ${file}:`, error);
                            }
                        }
                    }
                } catch (error) {
                    result.errors.push(`Schemas: ${error.message}`);
                    Logger.error('[Reload] Schema loading failed:', error);
                }
            }
            
            // 2. Models neu registrieren
            if (opts.models && dbService) {
                try {
                    const modelsDir = path.join(this.baseDir, 'models');
                    if (fs.existsSync(modelsDir)) {
                        const modelFiles = fs.readdirSync(modelsDir)
                            .filter(f => f.endsWith('.js'));
                        
                        for (const file of modelFiles) {
                            try {
                                const modelPath = path.join(modelsDir, file);
                                delete require.cache[require.resolve(modelPath)];
                                const model = require(modelPath);
                                
                                if (model && model.name) {
                                    // Model im DBService registrieren (falls Methode existiert)
                                    if (typeof dbService.registerModel === 'function') {
                                        await dbService.registerModel(model.name, model);
                                        result.models.registered++;
                                        result.models.names.push(model.name);
                                        Logger.debug(`[Reload] Model registered: ${model.name}`);
                                    }
                                }
                            } catch (error) {
                                result.models.failed++;
                                result.errors.push(`Model ${file}: ${error.message}`);
                                Logger.error(`[Reload] Failed to register model ${file}:`, error);
                            }
                        }
                    }
                } catch (error) {
                    result.errors.push(`Models: ${error.message}`);
                    Logger.error('[Reload] Model registration failed:', error);
                }
            }
            
            // 3. Commands neu laden (optional, da Commands im CommandManager sind)
            if (opts.commands) {
                try {
                    const botDir = path.join(this.pluginDir, 'bot');
                    const baseDir = fs.existsSync(botDir) ? botDir : this.baseDir;
                    
                    // Commands cachen und neu laden
                    this.commands.clear();
                    this.prefixCount = 0;
                    this.slashCount = 0;
                    this.#loadCommands(baseDir);
                    
                    result.commands.loaded = this.commands.size;
                    result.commands.names = Array.from(this.commands).map(cmd => cmd.name);
                    Logger.debug(`[Reload] Commands reloaded: ${result.commands.loaded} total`);
                } catch (error) {
                    result.commands.failed++;
                    result.errors.push(`Commands: ${error.message}`);
                    Logger.error('[Reload] Command reload failed:', error);
                }
            }
            
            // 4. Events neu laden (optional)
            if (opts.events) {
                try {
                    const botDir = path.join(this.pluginDir, 'bot');
                    const baseDir = fs.existsSync(botDir) ? botDir : this.baseDir;
                    
                    // Events cachen und neu laden
                    this.eventHandlers.clear();
                    this.events.clear();
                    this.ipcEvents.clear();
                    this.#loadEvents(baseDir);
                    
                    result.events.loaded = this.eventHandlers.size + this.ipcEvents.size;
                    result.events.names = [
                        ...Array.from(this.eventHandlers.keys()),
                        ...Array.from(this.ipcEvents.keys())
                    ];
                    Logger.debug(`[Reload] Events reloaded: ${result.events.loaded} total`);
                } catch (error) {
                    result.events.failed++;
                    result.errors.push(`Events: ${error.message}`);
                    Logger.error('[Reload] Event reload failed:', error);
                }
            }
            
            // 5. Config refreshen
            if (opts.config) {
                try {
                    await this.config.reload();
                    result.config.refreshed = true;
                    Logger.debug('[Reload] Config refreshed');
                } catch (error) {
                    result.errors.push(`Config: ${error.message}`);
                    Logger.error('[Reload] Config refresh failed:', error);
                }
            }
            
            result.success = result.errors.length === 0;
            Logger.info(`[Reload] Completed for plugin ${this.name}:`, {
                schemas: `${result.schemas.loaded} loaded, ${result.schemas.failed} failed`,
                models: `${result.models.registered} registered, ${result.models.failed} failed`,
                commands: opts.commands ? `${result.commands.loaded} loaded` : 'skipped',
                events: opts.events ? `${result.events.loaded} loaded` : 'skipped',
                config: result.config.refreshed ? 'refreshed' : 'skipped',
                errors: result.errors.length
            });
            
            return result;
            
        } catch (error) {
            Logger.error(`[Reload] Critical error for plugin ${this.name}:`, error);
            result.success = false;
            result.errors.push(`Critical: ${error.message}`);
            return result;
        }
    }

    /**
     * Lädt die Konfiguration des Plugins
     * @param {string} [context='shared'] - Kontext der Konfiguration
     * @returns {Promise<Object>} Die Konfiguration
     */
    async getConfig(context = 'shared') {
        return await this.config.get(context);
    }

    /**
     * Speichert einen Konfigurationswert
     * @param {string} key - Konfigurationsschlüssel
     * @param {*} value - Konfigurationswert
     * @param {string} [context='shared'] - Kontext der Konfiguration
     * @returns {Promise<boolean>} Erfolg der Operation
     */
    async saveConfig(key, value, context = 'shared') {
        return await this.config.set(key, value, context);
    }
    
    /**
     * Speichert mehrere Konfigurationswerte auf einmal
     * @param {Object} configValues - Objekt mit Schlüssel-Wert-Paaren
     * @param {string} [context='shared'] - Kontext der Konfiguration
     * @returns {Promise<boolean>} Erfolg der Operation
     */
    async saveMultipleConfig(configValues, context = 'shared') {
        return await this.config.setMultiple(configValues, context);
    }

    static #validate(data) {
        if (typeof data !== "object") {
            throw new TypeError("BotPlugin data must be an Object.");
        }

        if (!data.baseDir || typeof data.baseDir !== "string") {
            throw new Error("BotPlugin baseDir must be a string");
        }

        const fs = require("fs");
        if (!fs.existsSync(data.baseDir)) {
            throw new Error("BotPlugin baseDir does not exist");
        }

        const packageJsonPath = path.join(data.baseDir, "../package.json");
        if (!fs.existsSync(packageJsonPath)) {
            throw new Error("No package.json found in plugin directory");
        }

        if (data.dependencies && !Array.isArray(data.dependencies)) {
            throw new Error("BotPlugin dependencies must be an array");
        }

        if (data.onEnable && typeof data.onEnable !== "function") {
            throw new Error("BotPlugin onEnable must be a function");
        }

        if (data.onDisable && typeof data.onDisable !== "function") {
            throw new Error("BotPlugin onDisable must be a function");
        }

        if (data.onGuildEnable && typeof data.onGuildEnable !== "function") {
            throw new Error("BotPlugin onGuildEnable must be a function");
        }

        if (data.onGuildDisable && typeof data.onGuildDisable !== "function") {
            throw new Error("BotPlugin onGuildDisable must be a function");
        }

        if (data.dbService && !(data.dbService instanceof DBService)) {
            throw new Error("BotPlugin dbService must be an instance of DBService");
        }
    }

    static #validateCommand(cmd) {
        if (typeof cmd !== "object") {
            throw new TypeError("Command data must be an Object.");
        }
        if (typeof cmd.name !== "string" || cmd.name !== cmd.name.toLowerCase()) {
            throw new Error("Command name must be a lowercase string.");
        }
        if (typeof cmd.description !== "string") {
            throw new TypeError("Command description must be a string.");
        }
        if (cmd.cooldown && typeof cmd.cooldown !== "number") {
            throw new TypeError("Command cooldown must be a number");
        }
        if (cmd.userPermissions) {
            if (!Array.isArray(cmd.userPermissions)) {
                throw new TypeError(
                    "Command userPermissions must be an Array of permission key strings.",
                );
            }
            for (const perm of cmd.userPermissions) {
                if (!permissions[perm])
                    throw new RangeError(`Invalid command userPermission: ${perm}`);
            }
        }
        if (cmd.botPermissions) {
            if (!Array.isArray(cmd.botPermissions)) {
                throw new TypeError(
                    "Command botPermissions must be an Array of permission key strings.",
                );
            }
            for (const perm of cmd.botPermissions) {
                if (!permissions[perm])
                    throw new RangeError(`Invalid command botPermission: ${perm}`);
            }
        }
        if (cmd.validations) {
            if (!Array.isArray(cmd.validations)) {
                throw new TypeError("Command validations must be an Array of validation Objects.");
            }
            for (const validation of cmd.validations) {
                if (typeof validation !== "object") {
                    throw new TypeError("Command validations must be an object.");
                }
                if (typeof validation.callback !== "function") {
                    throw new TypeError("Command validation callback must be a function.");
                }
                if (typeof validation.message !== "string") {
                    throw new TypeError("Command validation message must be a string.");
                }
            }
        }

        if (cmd.command) {
            if (typeof cmd.command !== "object") {
                throw new TypeError("Command.command must be an object");
            }
            if (
                Object.prototype.hasOwnProperty.call(cmd.command, "enabled") &&
                typeof cmd.command.enabled !== "boolean"
            ) {
                throw new TypeError("Command.command enabled must be a boolean value");
            }
            if (
                cmd.command.aliases &&
                (!Array.isArray(cmd.command.aliases) ||
                    cmd.command.aliases.some(
                        (ali) => typeof ali !== "string" || ali !== ali.toLowerCase(),
                    ))
            ) {
                throw new TypeError(
                    "Command.command aliases must be an Array of lowercase strings.",
                );
            }
            if (cmd.command.usage && typeof cmd.command.usage !== "string") {
                throw new TypeError("Command.command usage must be a string");
            }
            if (cmd.command.minArgsCount && typeof cmd.command.minArgsCount !== "number") {
                throw new TypeError("Command.command minArgsCount must be a number");
            }
            if (cmd.command.subcommands && !Array.isArray(cmd.command.subcommands)) {
                throw new TypeError("Command.command subcommands must be an array");
            }
            if (cmd.command.subcommands) {
                for (const sub of cmd.command.subcommands) {
                    if (typeof sub !== "object") {
                        throw new TypeError(
                            "Command.command subcommands must be an array of objects",
                        );
                    }
                    if (typeof sub.trigger !== "string") {
                        throw new TypeError("Command.command subcommand trigger must be a string");
                    }
                    if (typeof sub.description !== "string") {
                        throw new TypeError(
                            "Command.command subcommand description must be a string",
                        );
                    }
                }
            }
            if (cmd.command.enabled && typeof cmd.messageRun !== "function") {
                throw new TypeError("Missing 'messageRun' function");
            }
        }

        if (cmd.slashCommand) {
            if (typeof cmd.slashCommand !== "object") {
                throw new TypeError("Command.slashCommand must be an object");
            }
            if (
                Object.prototype.hasOwnProperty.call(cmd.slashCommand, "enabled") &&
                typeof cmd.slashCommand.enabled !== "boolean"
            ) {
                throw new TypeError("Command.slashCommand enabled must be a boolean value");
            }
            if (
                Object.prototype.hasOwnProperty.call(cmd.slashCommand, "ephemeral") &&
                typeof cmd.slashCommand.ephemeral !== "boolean"
            ) {
                throw new TypeError("Command.slashCommand ephemeral must be a boolean value");
            }
            if (cmd.slashCommand.options && !Array.isArray(cmd.slashCommand.options)) {
                throw new TypeError("Command.slashCommand options must be a array");
            }
            if (cmd.slashCommand.enabled && typeof cmd.interactionRun !== "function") {
                throw new TypeError("Missing 'interactionRun' function");
            }
        }
    }

    static #validateContext(context) {
        if (typeof context !== "object") {
            throw new TypeError("Context must be an object");
        }
        if (typeof context.name !== "string" || context.name !== context.name.toLowerCase()) {
            throw new Error("Context name must be a lowercase string.");
        }
        if (typeof context.description !== "string") {
            throw new TypeError("Context description must be a string.");
        }
        if (
            context.type !== ApplicationCommandType.User &&
            context.type !== ApplicationCommandType.Message
        ) {
            throw new TypeError("Context type must be a either User/Message.");
        }
        if (
            Object.prototype.hasOwnProperty.call(context, "enabled") &&
            typeof context.enabled !== "boolean"
        ) {
            throw new TypeError("Context enabled must be a boolean value");
        }
        if (
            Object.prototype.hasOwnProperty.call(context, "ephemeral") &&
            typeof context.ephemeral !== "boolean"
        ) {
            throw new TypeError("Context enabled must be a boolean value");
        }
        if (
            Object.prototype.hasOwnProperty.call(context, "defaultPermission") &&
            typeof context.defaultPermission !== "boolean"
        ) {
            throw new TypeError("Context defaultPermission must be a boolean value");
        }
        if (
            Object.prototype.hasOwnProperty.call(context, "cooldown") &&
            typeof context.cooldown !== "number"
        ) {
            throw new TypeError("Context cooldown must be a number");
        }
        if (context.userPermissions) {
            if (!Array.isArray(context.userPermissions)) {
                throw new TypeError(
                    "Context userPermissions must be an Array of permission key strings.",
                );
            }
            for (const perm of context.userPermissions) {
                if (!permissions[perm])
                    throw new RangeError(`Invalid command userPermission: ${perm}`);
            }
        }
    }
}

module.exports = BotPlugin;
