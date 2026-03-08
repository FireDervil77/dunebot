const { Client, GatewayIntentBits, Partials } = require("discord.js");
const PluginManager = require("../helpers/PluginManager");
const CommandManager = require("../helpers/CommandManager");
const { ServiceManager, I18nManager, GuildManager } = require("dunebot-core");

const fs = require("fs");
const path = require("path");

// Kern-Verzeichnisse (unabhängig vom Plugin-System)
const CORE_EVENTS_DIR   = path.join(__dirname, "..", "events");
const CORE_COMMANDS_DIR = path.join(__dirname, "..", "commands");
const CORE_IPC_DIR      = path.join(__dirname, "..", "ipc");

class BotClient extends Client {
   constructor() {
        // Basic Discord.js client setup
        super({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent,
                GatewayIntentBits.GuildInvites,
                GatewayIntentBits.GuildMembers,
                GatewayIntentBits.GuildPresences,
                GatewayIntentBits.GuildMessageReactions,
                GatewayIntentBits.GuildVoiceStates,
                GatewayIntentBits.GuildModeration,
                GatewayIntentBits.GuildExpressions,
            ],
            partials: [Partials.User, Partials.Message, Partials.Reaction],
            allowedMentions: {
                repliedUser: false,
            },
            restRequestTimeout: 20000,
        });

        // Initialize properties (but not the instances)
        this.dbService = null;
        this.commandManager = null;
        this.logger = null;
        this.pluginManager = null;
        this.i18n = null;
        this.translations = new Map();
        this.wait = require("util").promisify(setTimeout);
    }

    async init() {
        // register Services
        const dbService = ServiceManager.get("dbService");
        const Logger = ServiceManager.get("Logger");

        if (!dbService) {
            throw new Error('DBService is required for bot initialization');
        }

        if (!Logger) {
            throw new Error('Logger is required for bot initialization');
        }

        this.dbService = dbService;
        this.logger = Logger;

        // GuildManager initialisieren und im ServiceManager registrieren
        const guildManager = new GuildManager({
            getPluginManager: () => this.pluginManager,
        });
        ServiceManager.register("guildManager", guildManager);

        // Initialize managers that need dbService          
        this.commandManager = new CommandManager(this);
        
        this.pluginManager = new PluginManager(
            this,
            process.env.REGISTRY_PATH,
            process.env.PLUGINS_DIR
        );

        // Kern-Events aus apps/bot/events/ laden
        this._loadCoreEvents();

        // Kern-Commands aus apps/bot/commands/ laden
        await this._loadCoreCommands();

        // Initialize i18n
        const baseDir = path.join(__dirname, "..", "locales");
        this.i18n = new I18nManager("bot", {
            baseDir,
            pluginsDir: process.env.PLUGINS_DIR,
            fallbackLng: this.defaultLanguage,
            useDatabase: process.env.NODE_ENV === "production"
        });

        // Initialize translations
        await this.i18n.initialize();

        this.commandManager.printDebugInfo();
        
        this.logger.info('Bot client initialized with database connection');
        return this;
        
    }


    async coreConfig() {
        try {
            const corePlugin = this.pluginManager.getPlugin("core");
            if (!corePlugin) {
                throw new Error("Core plugin not found");
            }
            
            const config = await corePlugin.getConfig();
            if (!config) {
                this.logger.error("Core config is empty, using defaults");
                return {
                    "LOCALE":  "de-DE",
                    "THEME_ENABLED": true,
                    "THEME": "default",
                    "THEME_PATH": "./themes",
                    "DASHBOARD_ENABLED": true,
                    "DASHBOARD_ENCRYPT": true,
                    "DASHBOARD_LOGO_NAME": "DuneBot",
                    "DASHBOARD_LOGO_URL": "/images/logo.png",
                    "PREFIX_COMMANDS_ENABLED": true,
                    "PREFIX_COMMANDS_PREFIX": "!",
                    "INTERACTIONS_SLASH": true,
                    "INTERACTIONS_CONTEXT": false, 
                };
            }

            // Config aus DB umwandeln in die richtige Struktur
            const structuredConfig = {
                INTERACTIONS: {
                    SLASH: config["INTERACTIONS_SLASH"] === "true",
                    CONTEXT: config["INTERACTIONS_CONTEXT"] === "true"  
                },
                PREFIX_COMMANDS: {
                    ENABLED: config["PREFIX_COMMANDS_ENABLED"] === "true",
                    DEFAULT_PREFIX: config["PREFIX_COMMANDS_PREFIX"] || "!"
                },
                LOCALE: {
                    DEFAULT: config["LOCALE"] || "de-DE"
                }
            };

            return structuredConfig;

        } catch (error) {
            this.logger.error("Failed to load core config:", error);
            throw error; 
        }
    }

    get defaultLanguage() {
        return "de-DE";
    }

    translate(key, args, locale) {
        return this.i18n.tr(key, args, locale || this.defaultLanguage);
    }

    /**
     * @param {string} search - The search string
     * @param {Boolean} exact - Whether to search for exact matches
     */
    async resolveUsers(search, exact = false) {
        if (!search || typeof search !== "string") return [];
        const users = [];

        // check if userId is passed
        const patternMatch = search.match(/(\d{17,20})/);
        if (patternMatch) {
            const id = patternMatch[1];
            try {
                const fetched = await this.users.fetch(id, { cache: true }); // check if mentions contains the ID
                if (fetched) {
                    users.push(fetched);
                    return users;
                }
            } catch (error) {
                this.logger.error(`Failed to fetch user by ID (${id}):`, error);
                return users;
            }
        }

        // check if exact tag is matched in cache
        if (exact) {
            const exactMatch = this.users.cache.find((user) => user.tag === search);
            if (exactMatch) users.push(exactMatch);
        } else {
            this.users.cache
                .filter((user) => user.tag === search)
                .forEach((match) => users.push(match));
        }

        // check matching username
        if (!exact) {
            this.users.cache
                .filter(
                    (x) =>
                        x.username.toLowerCase() === search.toLowerCase() ||
                        x.username.toLowerCase().includes(search.toLowerCase()) ||
                        x.tag.toLowerCase().includes(search.toLowerCase()),
                )
                .forEach((user) => users.push(user));
        }

        return users;
    }

    /**
     * Get bot's invite
     */
    getInvite() {
        return this.generateInvite({
            scopes: ["bot", "applications.commands"],
            permissions: [
                "AddReactions",
                "AttachFiles",
                "BanMembers",
                "ChangeNickname",
                "Connect",
                "DeafenMembers",
                "EmbedLinks",
                "KickMembers",
                "ManageChannels",
                "ManageGuild",
                "ManageMessages",
                "ManageNicknames",
                "ManageRoles",
                "ModerateMembers",
                "MoveMembers",
                "MuteMembers",
                "PrioritySpeaker",
                "ReadMessageHistory",
                "SendMessages",
                "SendMessagesInThreads",
                "Speak",
                "ViewChannel",
                "ViewAuditLog",
            ],
        });
    }

    /**
     * Lädt alle Kern-Events aus apps/bot/events/ und registriert sie am Discord-Client.
     * Diese Events laufen direkt im Bot-Kern, unabhängig vom Plugin-System.
     */
    _loadCoreEvents() {
        const Logger = ServiceManager.get("Logger");

        if (!fs.existsSync(CORE_EVENTS_DIR)) {
            Logger.debug("Kein apps/bot/events/ Verzeichnis gefunden – überspringe Kern-Events");
            return;
        }

        const eventFiles = fs.readdirSync(CORE_EVENTS_DIR).filter(f => f.endsWith(".js"));

        for (const file of eventFiles) {
            const eventName = file.replace(".js", "");
            const handler = require(path.join(CORE_EVENTS_DIR, file));
            this.on(eventName, handler);
            Logger.debug(`Kern-Event registriert: ${eventName}`);
        }

        Logger.info(`${eventFiles.length} Kern-Event(s) aus apps/bot/events/ geladen`);
    }

    /**
     * Lädt alle Kern-Commands aus apps/bot/commands/ und registriert sie im CommandManager.
     * Synthetisches "kern"-Plugin mit allen Commands als Set.
     */
    async _loadCoreCommands() {
        const Logger = ServiceManager.get("Logger");

        if (!fs.existsSync(CORE_COMMANDS_DIR)) {
            Logger.debug("Kein apps/bot/commands/ Verzeichnis – überspringe Kern-Commands");
            return;
        }

        const commandFiles = fs.readdirSync(CORE_COMMANDS_DIR).filter(f => f.endsWith(".js") && !f.startsWith("_"));
        if (commandFiles.length === 0) return;

        // Synthetisches Plugin-Objekt für CommandManager.registerPlugin()
        const commands = new Set();
        for (const file of commandFiles) {
            try {
                const cmd = require(path.join(CORE_COMMANDS_DIR, file));
                commands.add(cmd);
            } catch (err) {
                Logger.warn(`Kern-Command ${file} konnte nicht geladen werden: ${err.message}`);
            }
        }

        const kernPlugin = {
            name: 'kern',
            commands,
            prefixCount: commands.size,
            slashCount: commands.size,
        };

        await this.commandManager.registerPlugin(kernPlugin);
        Logger.info(`${commands.size} Kern-Command(s) aus apps/bot/commands/ geladen`);
    }

    /**
     * Gibt die Kern-IPC-Handler aus apps/bot/ipc/ als Map zurück.
     * Wird von IPCClient genutzt, um Kern-Handler vor Plugin-Handlern zu prüfen.
     * @returns {Map<string, Function>}
     */
    loadCoreIpcHandlers() {
        const Logger = ServiceManager.get("Logger");
        const handlers = new Map();

        if (!fs.existsSync(CORE_IPC_DIR)) return handlers;

        const files = fs.readdirSync(CORE_IPC_DIR).filter(f => f.endsWith(".js") && !f.startsWith("_"));
        for (const file of files) {
            const eventName = file.replace(".js", ""); // z.B. GET_USERS_DATA
            try {
                const handler = require(path.join(CORE_IPC_DIR, file));
                handlers.set(eventName, handler);
                Logger.debug(`Kern-IPC-Handler registriert: ${eventName}`);
            } catch (err) {
                Logger.warn(`Kern-IPC-Handler ${file} konnte nicht geladen werden: ${err.message}`);
            }
        }

        Logger.info(`${handlers.size} Kern-IPC-Handler aus apps/bot/ipc/ geladen`);
        return handlers;
    }
}

module.exports = BotClient;