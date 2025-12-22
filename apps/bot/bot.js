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
 * @author FireBot Team
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
        
        client.i18n.initialize();
        ServiceManager.register("i18n", client.i18n);
        Logger.success("Übersetzungen geladen");
        
        await bootHooks.doAction('after_translation_init', { client });

        // Phase 4: Plugin-System initialisieren
        await bootHooks.doAction('before_plugin_init', { client });
        
        await client.pluginManager.init();
        Logger.success('Bot erfolgreich angemeldet');
        
        // Phase 5: Events registrieren
        await bootHooks.doAction('before_register_events', { client });

        // 'ready'-Event separat behandeln
        if (client.pluginManager.listeningEvents.has("ready")) {
            client.on("ready", async () => { // Änderung von once zu on
                Logger.info('Bot logged in successfully');
                
                // IPC nur einmal initialisieren wenn noch nicht vorhanden
                if (!ServiceManager.has("ipcClient")) {
                    ipcClient.initialize(client);
                    ServiceManager.register("ipcClient", ipcClient);
                }

                // Guild-spezifische Plugins laden
                try {
                    Logger.info('Loading guild-specific plugins...');
                    
                    // Für jede Guild die aktivierten Plugins laden
                    for (const guild of client.guilds.cache.values()) {
                        try {
                            // NEU: Aktivierte Plugins aus guild_plugins Tabelle laden
                            const enabledPlugins = await dbService.getEnabledPlugins(guild.id);
                            
                            if (!enabledPlugins || enabledPlugins.length === 0) {
                                Logger.warn(`Guild ${guild.id} hat keine aktivierten Plugins in guild_plugins Tabelle!`);
                                continue;
                            }

                            // Für jedes aktivierte Plugin (außer core, das ist bereits geladen)
                            for (const pluginName of enabledPlugins) {
                                if (pluginName === 'core') continue;
                                
                                try {
                                    await client.pluginManager.enableInGuild(pluginName, guild.id);
                                } catch (err) {
                                    Logger.error(`Fehler beim Aktivieren von Plugin ${pluginName} für Guild ${guild.id}:`, err);
                                }
                            }
                            
                            Logger.info(`Guild ${guild.id} (${guild.name}): ${enabledPlugins.length} plugins aktiviert: ${enabledPlugins.join(', ')}`);
                        } catch (guildError) {
                            Logger.error(`Fehler beim Laden der Guild-spezifischen Plugins für Guild ${guild.id}:`, guildError);
                        }
                    }
                    
                    // WICHTIG: Erst NACH dem Laden aller Guild-Plugins das ready Event emittieren
                    await client.pluginManager.emit("ready", client);
                    
                    Logger.info('Guild-specific plugins loaded and ready event emitted');
                } catch (error) {
                    Logger.error('Error loading guild-specific plugins:', error);
                }
            });
        }

        // WICHTIG: Alle anderen Events registrieren
        client.pluginManager.listeningEvents.forEach((event) => {
            if (event !== "ready") {
                client.on(event, async (...args) => {
                    // =====================================================
                    // FIX: Guild-Partials durch vollständige Objekte ersetzen
                    // Bei interactionCreate/messageCreate ist args[0].guild ein Partial!
                    // =====================================================
                    const fixedArgs = args.map(arg => {
                        // Prüfe ob arg.guild ein Partial ist (hat .id aber kein .name)
                        if (arg?.guild?.id && !arg.guild.name) {
                            const fullGuild = client.guilds.cache.get(arg.guild.id);
                            if (fullGuild) {
                                // Ersetze das Guild-Partial durch die vollständige Guild
                                return { ...arg, guild: fullGuild };
                            } else {
                                Logger.warn(`[bot.js] Guild ${arg.guild.id} nicht im Cache gefunden!`);
                            }
                        }
                        return arg;
                    });
                    
                    await client.pluginManager.emit(event, ...fixedArgs); 
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

// Cleanup-Funktion für sauberes Beenden
async function cleanup() {
    const Logger = ServiceManager.get("Logger");
    try {
        // Presence/Status zurücksetzen
        if (client?.user) {
            client.user.setPresence({ 
                activities: [],
                status: 'invisible'
            });
        }

        // Plugins cleanup
        if (client?.pluginManager) {
            for (const plugin of client.pluginManager.plugins) {
                if (typeof plugin.cleanup === 'function') {
                    await plugin.cleanup();
                }
            }
        }

        // IPC Client cleanup
        if (ServiceManager.has("ipcClient")) {
            await ServiceManager.get("ipcClient").cleanup();
        }

        // Discord Client zerstören
        if (client?.destroy) {
            await client.destroy();
        }

        Logger.info('Bot-Instanz erfolgreich beendet');
        
    } catch (error) {
        Logger.error('Fehler beim Cleanup der Bot-Instanz:', error);
    }
}

// Signal Handler registrieren
process.on('SIGTERM', async () => {
    const Logger = ServiceManager.get("Logger");
    Logger.info('SIGTERM empfangen, beende Bot-Instanz...');
    await cleanup();
    process.exit(0);
});

process.on('SIGINT', async () => {
    const Logger = ServiceManager.get("Logger");
    Logger.info('SIGINT empfangen, beende Bot-Instanz...');
    await cleanup();
    process.exit(0);
});

// Error Handling
process.on("unhandledRejection", (err) => {
    Logger.error("Unhandled Rejection:", err);
});

process.on("uncaughtException", (err) => {
    Logger.error("Uncaught Exception:", err);
});