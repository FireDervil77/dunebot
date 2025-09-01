const { Client, GatewayIntentBits, Partials } = require("discord.js");
const PluginManager = require("../helpers/PluginManager");
const CommandManager = require("../helpers/CommandManager");
const { ServiceManager, I18nManager } = require("dunebot-core");

const path = require("path");

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

        // Initialize managers that need dbService          
        this.commandManager = new CommandManager(this);
        
        this.pluginManager = new PluginManager(
            this,
            process.env.REGISTRY_PATH,
            process.env.PLUGINS_DIR
        );

        // Initialize i18n
        const baseDir = path.join(__dirname, "..", "locales");
        this.i18n = new I18nManager("bot", {
            baseDir,
            pluginsDir: process.env.PLUGINS_DIR,
            fallbackLng: this.defaultLanguage,
            useDatabase: process.env.NODE_ENV === "production"
        });

        // Initialize translations
        this.i18n.initialize();
        
        // Set dbService for i18n if needed
        if (process.env.NODE_ENV === "production") {
            await this.i18n.setDBService(dbService);
        }

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
                    INTERACTIONS: { SLASH: true, CONTEXT: false },
                    PREFIX_COMMANDS: { ENABLED: true, DEFAULT_PREFIX: "!" },
                    LOCALE: { DEFAULT: "de-DE" }
                };
            }
            return config;
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
}

module.exports = BotClient;