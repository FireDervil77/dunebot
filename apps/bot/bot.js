// Load all extenders
require("./extenders/Guild");
require("./extenders/Interaction"); 
require("./extenders/Message");

require("dotenv").config();
const path = require("path");
const fs = require("fs");
const { ServiceManager } = require("dunebot-core");
const { Logger } = require("dunebot-sdk/utils");
const BotClient = require("./extenders/BotClient");
const IPCClient = require("./helpers/IPCClient");
const { DBService, models } = require("dunebot-db-client");
const { HookSystem } = require("dunebot-sdk");

// Setup Directories
const rootDir = path.join(__dirname, "..", "..");
const logsDir = path.join(rootDir, "logs");

// Create a Discord & IPC Client
const client = new BotClient();
const ipcClient = new IPCClient(client);

// Optional: Hook-System für den Boot-Prozess
const bootHooks = new HookSystem();

// Initialize the logger
const today = new Date();
const logsFile = `bot-${today.getFullYear()}.${today.getMonth() + 1}.${today.getDate()}.log`;
Logger.init(path.join(logsDir, logsFile), { 
    shard: client.shard?.ids?.[0] || 0,
    level: process.env.LOG_LEVEL || 'debug'
});

// Phase 0: Core Services registrieren
ServiceManager.register("Logger", Logger);
ServiceManager.register("bootHooks", bootHooks);


/**
 * Hauptfunktion für die Bot-Initialisierung
 * Implementiert den gesamten Boot-Prozess mit Hook-System
 * 
 * @author DuneBot Team
 */
(async () => {
    try {
        const Logger = ServiceManager.get('Logger');
        Logger.info("Starte Bot...");
        
        // Phase 1: Datenbank-Initialisierung
        await bootHooks.doAction('before_db_init');

        // Datenbank-Service initialisieren
        Logger.info("Verbinde mit der Datenbank...");
        const dbService = new DBService({
            database: process.env.MYSQL_DATABASE,
            username: process.env.MYSQL_USER,
            password: process.env.MYSQL_PASSWORD,
            host: process.env.MYSQL_HOST,
            port: process.env.MYSQL_PORT
        });
        await dbService.connect(models);
        ServiceManager.register("dbService", dbService);
        Logger.success("Datenbankverbindung hergestellt");
        
        await bootHooks.doAction('after_db_init', { dbService });
        
        // Phase 2: Bot-Client-Initialisierung
        await bootHooks.doAction('before_client_init', { client });

        await client.init(dbService);
        ServiceManager.register("client", client);
        ServiceManager.register("commandManager", client.commandManager);
        ServiceManager.register("pluginManager", client.pluginManager);

        // Nach der Logger-Initialisierung
        Logger.info("Registrierte Services:", ServiceManager.getServiceNames());

        await bootHooks.doAction('after_client_init', { client });

        // Phase 3: Übersetzungen laden
        await bootHooks.doAction('before_translation_init', { client });
        
        await client.i18n.initialize();
        ServiceManager.register("i18n", client.i18n);
        Logger.success("Übersetzungen geladen");
        
        await bootHooks.doAction('after_translation_init', { client });

        // Phase 4: Plugin-System initialisieren
        await bootHooks.doAction('before_plugin_init', { client });
        
        await client.pluginManager.init();
        Logger.success(`${client.pluginManager.plugins.length} Plugins initialisiert`);

        await bootHooks.doAction('after_plugin_init', { 
            client, 
            plugins: client.pluginManager.plugins 
        });

        Logger.success('Bot erfolgreich angemeldet');
        
        // Phase 5: Events registrieren
        await bootHooks.doAction('before_register_events', { client });

        // 'ready'-Event separat mit once() behandeln
        if (client.pluginManager.listeningEvents.has("ready")) {
            client.once("ready", async () => {
                Logger.info('Bot logged in successfully');
                
                // IPC nur einmal initialisieren
                ipcClient.initialize(client);
                ServiceManager.register("ipcClient", ipcClient);

                // Guild-spezifische Plugins laden
                try {
                    Logger.info('Loading guild-specific plugins...');
                    
                    // Für jede Guild die aktivierten Plugins laden
                    for (const guild of client.guilds.cache.values()) {
                        try {
                            const corePlugin = client.pluginManager.getPlugin("core");
                            if (corePlugin && corePlugin.dbService) {
                                const settings = await corePlugin.dbService.getSettings(guild.id);
                                
                                let enabledPlugins = ["core"]; // Core-Plugin immer aktiviert
                                
                                if (settings && settings.enabled_plugins) {
                                    try {
                                        if (typeof settings.enabled_plugins === 'string') {
                                            if (settings.enabled_plugins.startsWith('[')) {
                                                enabledPlugins = JSON.parse(settings.enabled_plugins);
                                            } else {
                                                enabledPlugins = settings.enabled_plugins.split(',').map(p => p.trim());
                                            }
                                        } else if (Array.isArray(settings.enabled_plugins)) {
                                            enabledPlugins = settings.enabled_plugins;
                                        }
                                    } catch (e) {
                                        Logger.warn(`Fehler beim Parsen der aktivierten Plugins für Guild ${guild.id}:`, e);
                                    }
                                }
                                
                                Logger.info(`Guild ${guild.id}: Found ${enabledPlugins.length} enabled plugins: ${enabledPlugins.join(', ')}`);
                            }
                        } catch (guildError) {
                            Logger.error(`Fehler beim Laden der Guild-spezifischen Plugins für Guild ${guild.id}:`, guildError);
                        }
                    }
                    
                    Logger.info('Guild-specific plugins loaded');
                } catch (error) {
                    Logger.error('Error loading guild-specific plugins:', error);
                }
                
                // Dann das Event auch an den PluginManager weiterleiten
                await client.pluginManager.emit("ready", client);
            });
        }

        // Alle anderen Events normal registrieren
        client.pluginManager.listeningEvents.forEach((event) => {
            if (event !== "ready") { // 'ready' überspringen, da wir es separat behandeln
                client.on(event, (...args) => {
                    client.pluginManager.emit(event, ...args);
                });
            }
        });

        // Einloggen des Bots
        await client.login(process.env.BOT_TOKEN);

        await bootHooks.doAction('after_login', { client });
    } catch (error) {
        Logger.error('Fehler bei der Bot-Initialisierung:', error);
        await bootHooks.doAction('initialization_failed', { error });
        process.exit(1);
    }
})();

// Error Handling
process.on("unhandledRejection", (err) => {
    Logger.error("Unhandled Rejection:", err);
});

process.on("uncaughtException", (err) => {
    Logger.error("Uncaught Exception:", err);
});