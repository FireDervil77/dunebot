const { Collection, ApplicationCommandType } = require("discord.js");
const { Logger } = require("dunebot-sdk/utils");
const { ServiceManager } = require("dunebot-core");

/**
 * Verwaltet Bot-Befehle (Prefix-Commands, Slash-Commands, Context-Menüs)
 * Angepasst für das neue WordPress-ähnliche Plugin-System
 * 
 * @author FireBot Team
 */
class CommandManager {
    /**
     * Erstellt eine neue Instanz des Command Managers
     * @param {import('discord.js').Client} client - Discord.js Client
     */
    constructor(client) {
        this.client = client;
        this.prefixCommands = new Collection();
        this.slashCommands = new Collection();
        this.contextMenus = new Collection();
        this.pendingRegistrations = new Map(); // Track pending command registrations
        this.registrationQueue = []; // Queue for guild IDs that need registration
        this.isProcessingQueue = false;
        
        // Hook-System initialisieren, falls verfügbar
        try {
            const { HookSystem } = require('dunebot-sdk');
            this.hooks = new HookSystem();
            Logger.debug('Hook-System für CommandManager initialisiert');
            
            // Standard-Hooks registrieren
            this.#registerDefaultHooks();
        } catch (error) {
            this.hooks = null;
            Logger.debug('Hook-System für CommandManager nicht verfügbar');
        }
        
        // Client-Event-Handler nach der Initialisierung registrieren
        if (client.isReady()) {
            this.registerClientEventHandlers();
        } else {
            client.once('ready', () => {
                this.registerClientEventHandlers();
                Logger.debug('CommandManager Client-Event-Handler registriert nach Ready');
            });
        }
    }

    /**
     * Registriert Standard-Hooks für den CommandManager
     * @private
     */
    #registerDefaultHooks() {
        if (!this.hooks) return;
        
        // Hook zum Überwachen von Befehlskonflikten
        this.hooks.addAction('command_conflict', ({ command, existingCommand, type }) => {
            Logger.warn(`Befehlskonflikt: ${command.name} (${type}) kollidiert mit Plugin ${existingCommand.plugin?.name}`);
        });
        
        // Hook zum Überwachen von erfolgreichen Befehlsregistrierungen
        this.hooks.addAction('after_register_prefix_command', ({ command }) => {
            Logger.debug(`Prefix-Befehl erfolgreich registriert: ${command.name} (Plugin: ${command.plugin?.name})`);
        });
        
        this.hooks.addAction('after_register_slash_command', ({ command }) => {
            Logger.debug(`Slash-Befehl erfolgreich registriert: ${command.name} (Plugin: ${command.plugin?.name})`);
        });
        
        // Hook zum Modifizieren von Befehlen - kann für globale Änderungen verwendet werden
        this.hooks.addFilter('modify_command', (command, context) => {
            // Hier könnte man globale Änderungen an Befehlen vornehmen
            // z.B. bestimmte Standardwerte setzen
            // Sicherstellen, dass 'enabled' richtig gesetzt ist (Default: true)
            if (command.command && command.command.enabled === undefined) {
                command.command.enabled = true;
            }
            if (command.slashCommand && command.slashCommand.enabled === undefined) {
                command.slashCommand.enabled = true;
            }
            return command;
        });
    }

    /**
     * Registriert Befehle und Kontextmenüs eines Plugins
     * Unterstützt die neue Plugin-Struktur
     * 
     * @param {import("dunebot-sdk").BotPlugin} plugin - Das Plugin, dessen Befehle registriert werden sollen
     */
    async registerPlugin(plugin) {
        Logger.info(`Registriere Befehle aus Plugin ${plugin.name}...`);
        
        // Debug-Log für besseres Verständnis
        Logger.debug(`Plugin ${plugin.name} hat ${plugin.commands.size} Befehle, ${plugin.prefixCount} Prefix und ${plugin.slashCount} Slash`);
        
        // Hook vor der Befehlsregistrierung ausführen
        if (this.hooks) {
            this.hooks.doAction('before_register_commands', { plugin });
        }
        
        // Prüfen, ob das Plugin überhaupt Befehle hat
        if (!plugin.commands || plugin.commands.size === 0) {
            Logger.warn(`Plugin ${plugin.name} hat keine Befehle zum Registrieren`);
            return;
        }

        // Zähler für die Ausgabe
        let registeredPrefix = 0;
        let registeredSlash = 0;

        // Iterate over commands
        for (const cmd of plugin.commands) {
            // Skip invalid commands
            if (!cmd || typeof cmd !== 'object' || !cmd.name) {
                continue;
            }
            
            try {
                // Grundlegende Validierung
                if (!cmd || typeof cmd !== 'object') {
                    Logger.warn(`Ungültiger Befehl in Plugin ${plugin.name}: ${typeof cmd}`);
                    continue;
                }
                
                if (!cmd.name) {
                    Logger.warn(`Befehl ohne Namen in Plugin ${plugin.name} wird übersprungen`);
                    continue;
                }
                
                // WICHTIG: Plugin-Referenz zum Command hinzufügen
                cmd.plugin = plugin;
                
                // Befehl kann durch einen Hook modifiziert werden
                let cmdToRegister = cmd;
                if (this.hooks) {
                    // KORREKTUR: getFilterCallbackCount durch getFilterCount ersetzen
                    // Die Methode heißt in PluginHooks "getFilterCount"
                    Logger.debug(`Applying filter: modify_command with ${this.hooks.getFilterCount('modify_command')} callbacks`);
                    cmdToRegister = await this.hooks.applyFilters('modify_command', cmdToRegister, { plugin });
                    
                    // Sicherstellen, dass die Plugin-Referenz auch nach dem Filter noch vorhanden ist
                    if (!cmdToRegister.plugin) {
                        cmdToRegister.plugin = plugin;
                    }
                }
                
                // Debug-Informationen vor der Registrierung
                Logger.debug(`Verarbeite Befehl ${cmdToRegister.name}: command=${!!cmdToRegister.command}, slashCommand=${!!cmdToRegister.slashCommand}`);
                if (cmdToRegister.command) Logger.debug(`- command.enabled: ${cmdToRegister.command.enabled}`);
                if (cmdToRegister.slashCommand) Logger.debug(`- slashCommand.enabled: ${cmdToRegister.slashCommand.enabled}`);
                
                // Prefix-Befehl registrieren
                if (cmdToRegister.command && cmdToRegister.command.enabled !== false) {
                    Logger.debug(`Registriere Prefix-Befehl: ${cmdToRegister.name} aus Plugin ${plugin.name}`);
                    
                    if (this.prefixCommands.has(cmdToRegister.name.toLowerCase())) {
                        // Hook für Befehlskonflikte
                        if (this.hooks) {
                            this.hooks.doAction('command_conflict', { 
                                command: cmdToRegister, 
                                existingCommand: this.prefixCommands.get(cmdToRegister.name.toLowerCase()),
                                type: 'prefix' 
                            });
                        }
                        Logger.warn(`Befehl ${cmdToRegister.name} ist bereits registriert, wird übersprungen`);
                    } else {
                        this.prefixCommands.set(cmdToRegister.name.toLowerCase(), cmdToRegister);
                        registeredPrefix++;
                        
                        // Aliases registrieren
                        if (Array.isArray(cmdToRegister.command.aliases)) {
                            cmdToRegister.command.aliases.forEach((alias) => {
                                if (this.prefixCommands.has(alias.toLowerCase())) {
                                    // Hook für Alias-Konflikte
                                    if (this.hooks) {
                                        this.hooks.doAction('alias_conflict', { 
                                            command: cmdToRegister,
                                            alias,
                                            existingCommand: this.prefixCommands.get(alias.toLowerCase())
                                        });
                                    }
                                    Logger.warn(`Alias ${alias} ist bereits registriert, wird übersprungen`);
                                    return;
                                }
                                this.prefixCommands.set(alias.toLowerCase(), cmdToRegister);
                                Logger.debug(`Registriere Alias: ${alias} für Befehl ${cmdToRegister.name}`);
                            });
                        }
                        
                        // Hook nach der Registrierung eines Prefix-Befehls
                        if (this.hooks) {
                            this.hooks.doAction('after_register_prefix_command', { command: cmdToRegister });
                        }
                    }
                }

                // Slash-Befehl registrieren (separat von Prefix-Befehlen)
                if (cmdToRegister.slashCommand && cmdToRegister.slashCommand.enabled !== false) {
                    Logger.debug(`Registriere Slash-Befehl: ${cmdToRegister.name} aus Plugin ${plugin.name}`);
                    
                    if (this.slashCommands.has(cmdToRegister.name.toLowerCase())) {
                        // Hook für Befehlskonflikte
                        if (this.hooks) {
                            this.hooks.doAction('command_conflict', { 
                                command: cmdToRegister, 
                                existingCommand: this.slashCommands.get(cmdToRegister.name.toLowerCase()),
                                type: 'slash' 
                            });
                        }
                        Logger.warn(`Slash-Befehl ${cmdToRegister.name} ist bereits registriert, wird übersprungen`);
                    } else {
                        // Nur registrieren, wenn kein Konflikt
                        this.slashCommands.set(cmdToRegister.name.toLowerCase(), cmdToRegister);
                        registeredSlash++;
                        
                        // Hook nach der Registrierung eines Slash-Befehls
                        if (this.hooks) {
                            this.hooks.doAction('after_register_slash_command', { command: cmdToRegister });
                        }
                    }
                } else if (cmdToRegister.slashCommand) {
                    // Nur ausgeben, wenn slashCommand existiert, aber nicht aktiviert ist
                    Logger.debug(`Überspringe Slash-Befehl ${cmdToRegister.name}. Deaktiviert!`);
                }
            } catch (error) {
                Logger.error(`Fehler bei der Registrierung des Befehls ${cmd.name || 'unbekannt'} aus Plugin ${plugin.name}:`, error);
            }
        }

        // Kontextmenüs registrieren
        let userContexts = 0;
        let messageContexts = 0;
        
        if (plugin.contexts && plugin.contexts.size > 0) {
            const contexts = Array.from(plugin.contexts);
            for (const ctx of contexts) {
                if (!ctx || typeof ctx !== 'object' || !ctx.name) {
                    Logger.warn(`Ungültiges Kontextmenü in Plugin ${plugin.name}`);
                    continue;
                }

                if (ctx.enabled === false) {
                    Logger.debug(`Kontextmenü ${ctx.name} ist deaktiviert`);
                    continue;
                }

                if (this.contextMenus.has(ctx.name)) {
                    Logger.warn(`Kontextmenü ${ctx.name} ist bereits registriert, wird übersprungen`);
                    continue;
                }

                // WICHTIGE ÄNDERUNG: Plugin-Referenz auch zu Kontextmenüs hinzufügen
                ctx.plugin = plugin;
                
                this.contextMenus.set(ctx.name, ctx);
                
                // Zählen nach Typ
                if (ctx.type === ApplicationCommandType.User) {
                    userContexts++;
                } else if (ctx.type === ApplicationCommandType.Message) {
                    messageContexts++;
                }
                
                Logger.debug(`Registriere Kontextmenü: ${ctx.name} (${ctx.type})`);
            }
        }

        // Anzahl der registrierten Befehle ausgeben
        Logger.info(`${registeredPrefix + registeredSlash} Befehle geladen [${registeredPrefix} Prefix, ${registeredSlash} Slash]`);
        Logger.info(`${userContexts + messageContexts} Kontextmenüs geladen [${userContexts} User, ${messageContexts} Message]`);
    }

    /**
     * Find a prefix command by name or alias
     * @param {string} commandName - The command name or alias
     * @returns {import("dunebot-sdk").CommandType|undefined}
     */
    findPrefixCommand(commandName) {
        return this.prefixCommands.get(commandName.toLowerCase());
    }

    /**
     * Find a slash command by name
     * @param {string} commandName - The command name
     * @returns {import("dunebot-sdk").CommandType|undefined}
     */
    findSlashCommand(commandName) {
        return this.slashCommands.get(commandName);
    }

    /**
     * Find a context menu by name
     * @param {string} contextName - The context menu name
     * @returns {import("dunebot-sdk").ContextType|undefined}
     */
    findContextMenu(contextName) {
        return this.contextMenus.get(contextName);
    }

    /**
     * Register slash commands and context menus for a guild
     * @param {string} guildId - The guild ID to register commands in
     * @param {boolean} [force=false] - Whether to force registration regardless of plugin status
     */
    async registerInteractions(guildId, force = false) {
        try {
            // Add to queue and process
            this.#queueGuildRegistration(guildId, force);
            return this.#processRegistrationQueue();
        } catch (error) {
            Logger.error("Failed to register interactions", error);
            throw error;
        }
    }

    /**
     * Queue a guild for command registration
     * @param {string} guildId - The guild ID to register commands for
     * @param {boolean} force - Whether to force registration
     */
    #queueGuildRegistration(guildId, force = false) {
        // Check if this guild is already in the queue
        if (!this.registrationQueue.some((item) => item.guildId === guildId)) {
            this.registrationQueue.push({ guildId, force, timestamp: Date.now() });
            Logger.info(`Queued command registration for guild ${guildId}`);
        }
    }

    /**
     * Process the registration queue with rate limit awareness
     */
    async #processRegistrationQueue() {
        // If already processing, don't start a new processing cycle
        if (this.isProcessingQueue) {
            return;
        }

        this.isProcessingQueue = true;

        try {
            // Process queue in chunks to avoid blocking the main thread
            const processChunk = async () => {
                if (this.registrationQueue.length === 0) {
                    this.isProcessingQueue = false;
                    return;
                }

                // Process a small number of items per tick
                const item = this.registrationQueue.shift();
                const { guildId, force } = item;

                // Skip if this guild had a registration in the last 10 seconds
                const lastRegistration = this.pendingRegistrations.get(guildId);
                if (lastRegistration && Date.now() - lastRegistration < 10000 && !force) {
                    Logger.info(`Skipping registration for guild ${guildId}, too recent`);

                    // Continue with next chunk after a small delay
                    setTimeout(() => processChunk(), 10);
                    return;
                }

                this.pendingRegistrations.set(guildId, Date.now());

                try {
                    const guild = this.client.guilds.cache.get(guildId);
                    const commands = await this.#registerGuildCommands(guildId, force);
                    
                    if (guild) {
                        Logger.info(`Registered ${commands.length || 0} interactions in guild ${guild.name} (${guild.id})`);
                    } else {
                        Logger.info(`Registered ${commands.length || 0} interactions in guild ${guildId}`);
                    }
                } catch (error) {
                    Logger.error(`Failed to register commands for guild ${guildId}:`, error);
                }

                // Continue with next chunk after a delay to respect rate limits
                // Add more delay between operations (250ms) to avoid locking the main thread
                setTimeout(() => processChunk(), 250);
            };

            // Start processing the first chunk
            processChunk();
        } catch (error) {
            Logger.error("Error processing registration queue:", error);
            this.isProcessingQueue = false;

            // Clean up old pending registrations
            this.#cleanupPendingRegistrations();
        }
    }

    /**
     * Clean up old pending registrations
     */
    #cleanupPendingRegistrations() {
        const now = Date.now();
        for (const [guildId, timestamp] of this.pendingRegistrations.entries()) {
            if (now - timestamp > 60000) {
                // 1 minute
                this.pendingRegistrations.delete(guildId);
            }
        }
    }

    /**
     * Register commands for a specific guild based on enabled plugins
     * @param {string} guildId - The guild ID
     * @param {boolean} force - Whether to force registration
     */
    async #registerGuildCommands(guildId, force = false) {
        const Logger = ServiceManager.get("Logger");
        const dbService = ServiceManager.get("dbService");
        const client = ServiceManager.get("client");

        Logger.info(`[DEBUG] Starte Registrierung der Slash-Commands für Guild ${guildId}`);
        const guild = this.client.guilds.cache.get(guildId);
        if (!guild) {
            throw new Error(`Guild ${guildId} not found`);
        }

         // Config aus der DB laden
        const configs = await dbService.getConfigs(guildId, "core", "shared");

        // Sicherer Zugriff mit Optional Chaining und Fallback
        const slashEnabled = configs?.INTERACTIONS_SLASH ?? true;
        const contextEnabled = configs?.INTERACTIONS_CONTEXT ?? false;

        if (!slashEnabled && !contextEnabled) {
            Logger.info("Skipping command registration - no interactions enabled");
            return;
        }

        const toRegister = [];

        // Get enabled plugins for this guild - NEU: Aus guild_plugins Tabelle
        let enabledPlugins;
        try {
            const pluginRows = await dbService.query(
                "SELECT plugin_name FROM guild_plugins WHERE guild_id = ? AND is_enabled = 1",
                [guildId]
            );
            
            enabledPlugins = pluginRows.map(row => row.plugin_name);
            
            // Sicherstellen dass core immer aktiviert ist
            if (!enabledPlugins.includes("core")) {
                enabledPlugins.push("core");
            }
        } catch (error) {
            Logger.error(`Fehler beim Laden der aktivierten Plugins für Guild ${guildId}:`, error);
            enabledPlugins = ['core'];
        }

        Logger.debug(`Aktivierte Plugins für Guild ${guildId}: ${enabledPlugins.join(', ')}`);
        
        // Get list of disabled commands
        const disabledSlashCommands = configs?.DISABLED_SLASH || [];

        // Filter commands from enabled plugins
        if (configs?.INTERACTIONS_SLASH === "1" || configs?.INTERACTIONS_SLASH === true) {
            this.slashCommands
                .filter((cmd) => {
                    // Check if the command is disabled
                    if (Array.isArray(disabledSlashCommands) && disabledSlashCommands.includes(cmd.name)) {
                        Logger.debug(`Command ${cmd.name} ist für Guild ${guildId} deaktiviert`);
                        return false;
                    }

                    // Check if the plugin is globally enabled AND enabled for this guild
                    const plugin = cmd.plugin;

                    // Kern-Commands ('kern') sind immer registriert – unabhängig vom Plugin-System
                    if (plugin.name === 'kern') return true;

                    const isGloballyEnabled = this.client.pluginManager.isPluginEnabled(
                        plugin.name,
                    );

                    // Plugin muss in enabledPlugins sein (force wird nur für Cooldown verwendet)
                    const isGuildEnabled = enabledPlugins.includes(plugin.name);

                    return isGloballyEnabled && isGuildEnabled;
                })
                .map((cmd) => ({
                    name: cmd.name,
                    description: this.client.translate(cmd.description),
                    descriptionLocalizations: this.client.i18n.getAllTr(cmd.description),
                    type: ApplicationCommandType.ChatInput,
                    options: cmd.slashCommand.options?.map((opt) => {
                        if (opt.description) {
                            opt.description = this.client.translate(opt.description);
                            opt.descriptionLocalizations = this.client.i18n.getAllTr(
                                opt.description,
                            );
                        }
                        if (opt.options) {
                            opt.options = opt.options.map((o) => {
                                if (o.description) {
                                    o.description = this.client.translate(o.description);
                                    o.descriptionLocalizations = this.client.i18n.getAllTr(
                                        o.description,
                                    );
                                }
                                return o;
                            });
                        }
                        return opt;
                    }),
                }))
                .forEach((s) => toRegister.push(s));
        }

        // Filter context menus from enabled plugins
        if (configs["INTERACTIONS_CONTEXT"]) {
            this.contextMenus
                .filter((ctx) => {
                    // Check if the plugin is globally enabled AND enabled for this guild
                    const plugin = ctx.plugin;

                    // Kern-Commands sind immer aktiviert
                    if (plugin.name === 'kern') return true;

                    const isGloballyEnabled = this.client.pluginManager.isPluginEnabled(
                        plugin.name,
                    );

                    // Plugin muss in enabledPlugins sein (force wird nur für Cooldown verwendet)
                    const isGuildEnabled = enabledPlugins.includes(plugin.name);

                    return isGloballyEnabled && isGuildEnabled;
                })
                .map((ctx) => ({
                    name: ctx.name,
                    type: ctx.type,
                }))
                .forEach((c) => toRegister.push(c));
        }
        try {
            // Nach der Registrierung der Commands
            const commands = await guild.commands.set(toRegister);
            Logger.debug(`Successfully registered ${commands.size} commands for guild ${guildId}`);
            return commands;
        } catch (error) {
            Logger.error(`Error registering commands for guild ${guildId}:`, error);
            throw error;
        }      
    }

    /**
     * Update commands when a plugin is enabled or disabled
     * @param {string} pluginName - The plugin name
     * @param {boolean} enabled - Whether the plugin is being enabled or disabled
     * @param {string|null} guildId - Guild ID if this is per-guild, null if global
     */
    async updatePluginStatus(pluginName, enabled, guildId = null) {
        try {
            if (guildId) {
                // Per-guild plugin status change - FORCE update um Cache zu umgehen
                Logger.info(
                    `Plugin ${pluginName} ${enabled ? "enabled" : "disabled"} for guild ${guildId}`,
                );
                this.#queueGuildRegistration(guildId, true); // Force=true für Plugin-Updates
            } else {
                // Global plugin status change - need to update all guilds
                Logger.info(`Plugin ${pluginName} ${enabled ? "enabled" : "disabled"} globally`);

                // Get all guilds where bot is present
                const guilds = this.client.guilds.cache.map((guild) => guild.id);

                // Queue updates with priority balancing
                guilds.forEach((guildId, index) => {
                    // Stagger the queuing to avoid overwhelming the system
                    setTimeout(() => {
                        this.#queueGuildRegistration(guildId, true); // Force=true für Plugin-Updates
                    }, index * 50); // Small delay between each queue addition
                });
            }

            // Start processing the queue but don't await its completion
            this.#processRegistrationQueue();
            return true;
        } catch (error) {
            Logger.error(`Failed to update plugin status for ${pluginName}:`, error);
            return false;
        }
    }

    /**
     * Get a summary of registered commands
     */
    getSummary() {
        return {
            prefixCommands: this.prefixCommands.size,
            slashCommands: this.slashCommands.size,
            contextMenus: this.contextMenus.size,
            userContexts: this.contextMenus.filter(
                (ctx) => ctx.type === ApplicationCommandType.User,
            ).size,
            messageContexts: this.contextMenus.filter(
                (ctx) => ctx.type === ApplicationCommandType.Message,
            ).size,
        };
    }

    /**
     * Registriert die Standard-Event-Handler für den Discord-Client
     * Dies stellt sicher, dass die Ereignisse, die den Bot betreffen, 
     * korrekt verarbeitet werden.
     */
    registerClientEventHandlers() {
        // Für interactionCreate (Slash-Commands und Kontext-Menüs)
        if (!this.client._events.interactionCreate) {
            Logger.debug('Registriere interactionCreate-Handler für den Client');
            
            this.client.on('interactionCreate', async (interaction) => {
                // Autocomplete-Interaktionen separat behandeln
                if (interaction.isAutocomplete()) {
                    const command = this.slashCommands.get(interaction.commandName.toLowerCase());
                    if (command?.autocomplete) {
                        try {
                            await command.autocomplete({ interaction, client: this.client });
                        } catch (err) {
                            Logger.error(`[Autocomplete] Fehler bei ${interaction.commandName}:`, err);
                            await interaction.respond([]).catch(() => {});
                        }
                    }
                    return;
                }

                // Nur für Slash-Commands und Kontext-Menüs
                if (!interaction.isCommand() && !interaction.isContextMenuCommand()) return;
                
                const commandName = interaction.commandName;
                Logger.debug(`Interaktion erhalten: ${commandName}`);

                // Guild-Kontext und Konfiguration laden
                if (!interaction.guild) {
                    Logger.warn(`Interaktion ohne Guild-Kontext erhalten: ${commandName}`);
                    return;
                }

                const dbService = ServiceManager.get("dbService");
                
                // DEBUG: Alle verfügbaren Guild-Informationen loggen
                Logger.debug(`📊 DEBUG: Interaktion Details:`, {
                    commandName,
                    guildId: interaction.guild?.id,
                    guildName: interaction.guild?.name,
                    channelId: interaction.channel?.id,
                    userId: interaction.user?.id,
                    shardId: interaction.guild?.shardId
                });
                
                // SICHERHEITSPRÜFUNG: Nur Guilds erlauben, die in der DB registriert sind
                // Verhindert Command-Ausführung durch nicht-autorisierte Guilds
                const [guildData] = await dbService.query(
                    "SELECT _id, guild_name, is_active_guild FROM guilds WHERE _id = ? LIMIT 1",
                    [interaction.guild.id]
                );
                
                // DEBUG: Wenn nicht gefunden, alle Guilds in DB anzeigen
                if (!guildData) {
                    const allGuilds = await dbService.query("SELECT _id, guild_name FROM guilds LIMIT 10");
                    Logger.warn(`🚫 SECURITY: Guild ${interaction.guild.id} (${interaction.guild.name}) ist nicht in der Datenbank registriert.`);
                    Logger.debug(`📋 Registrierte Guilds in DB:`, allGuilds.map(g => `${g.guild_name} (${g._id})`));
                    
                    try {
                        await interaction.reply({
                            content: '⚠️ Dieser Server ist nicht autorisiert. Bitte besuche das Dashboard und wähle den Server aus, um ihn zu aktivieren.',
                            ephemeral: true
                        });
                    } catch (e) {
                        Logger.error(`Fehler beim Antworten auf Interaktion in nicht-registrierter Guild:`, e);
                    }
                    return;
                }
                
                Logger.debug(`✅ Guild ${guildData.guild_name} (${guildData._id}) ist registriert und autorisiert`);
                
                const guildConfigs = await dbService.getConfigs(interaction.guild.id, "core", "shared");

                // Prüfen ob Interactions aktiviert sind
                if (interaction.isContextMenuCommand() && 
                    (guildConfigs?.INTERACTIONS_CONTEXT === "0" || guildConfigs?.INTERACTIONS_CONTEXT === false)) {
                    Logger.debug(`Context-Menüs sind für Guild ${interaction.guild.id} deaktiviert`);
                    return;
                }

                if (interaction.isChatInputCommand() && 
                    (guildConfigs?.INTERACTIONS_SLASH === "0" || guildConfigs?.INTERACTIONS_SLASH === false)) {
                    Logger.debug(`Slash-Commands sind für Guild ${interaction.guild.id} deaktiviert`);
                    return;
                }
                
                // Befehl finden
                let command;
                if (interaction.isContextMenuCommand()) {
                    command = this.contextMenus.get(commandName.toLowerCase());
                } else {
                    command = this.slashCommands.get(commandName.toLowerCase());
                }
                
                // Wenn kein Befehl gefunden wurde, abbrechen
                if (!command) {
                    Logger.warn(`Kein Befehl gefunden für Interaktion: ${commandName}`);
                    return;
                }

                // Prüfen ob das Plugin aktiviert ist (aus guild_plugins Tabelle)
                let enabledPlugins = ['core'];
                try {
                    const pluginRows = await dbService.query(
                        "SELECT plugin_name FROM guild_plugins WHERE guild_id = ? AND is_enabled = 1",
                        [interaction.guild.id]
                    );
                    enabledPlugins = pluginRows.map(row => row.plugin_name);
                    
                    // Sicherstellen dass core immer aktiviert ist
                    if (!enabledPlugins.includes("core")) {
                        enabledPlugins.push("core");
                    }
                } catch (error) {
                    Logger.error(`Fehler beim Laden der aktivierten Plugins für Guild ${interaction.guild.id}:`, error);
                }

                if (!enabledPlugins.includes(command.plugin?.name)) {
                    Logger.debug(`Plugin ${command.plugin?.name} ist für Guild ${interaction.guild.id} nicht aktiviert`);
                    await interaction.reply({
                        content: 'Dieser Befehl ist in diesem Server nicht aktiviert.',
                        ephemeral: true
                    });
                    return;
                }

                // Prüfen ob der Command deaktiviert ist
                const disabledCommands = guildConfigs?.DISABLED_SLASH || [];
                if (Array.isArray(disabledCommands) && disabledCommands.includes(commandName)) {
                    Logger.debug(`Command ${commandName} ist für Guild ${interaction.guild.id} deaktiviert`);
                    await interaction.reply({
                        content: 'Dieser Befehl wurde von einem Administrator deaktiviert.',
                        ephemeral: true
                    });
                    return;
                }
                
                // Prüfen, ob der Plugin-Handler den Befehl verarbeiten kann
                try {
                    // Ephemeral-Status bestimmen (Standard: false)
                    let ephemeral = false;
                    if (command.slashCommand && command.slashCommand.ephemeral !== undefined) {
                        ephemeral = !!command.slashCommand.ephemeral;
                    }
                    
                    // Interaktion bestätigen
                    await interaction.deferReply({ ephemeral });
                    
                    // Plugin-Methode aufrufen, wenn vorhanden
                    if (command.interactionRun) {
                        await command.interactionRun({ interaction, client: this.client });
                    } else {
                        await interaction.followUp({ 
                            content: 'Dieser Befehl ist nicht vollständig implementiert.',
                            ephemeral: true 
                        });
                    }
                } catch (error) {
                    Logger.error(`Fehler bei der Verarbeitung der Interaktion ${commandName}:`, error);
                    
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({
                            content: 'Ein Fehler ist aufgetreten.',
                            ephemeral: true
                        }).catch(e => {});
                    } else if (interaction.deferred) {
                        await interaction.followUp({
                            content: 'Ein Fehler ist aufgetreten.',
                            ephemeral: true
                        }).catch(e => {});
                    }
                }
            });
        }
        
        // Für messageCreate (Prefix-Commands)
        if (!this.client._events.messageCreate) {
        Logger.debug('Registriere messageCreate-Handler für den Client');
        
        this.client.on('messageCreate', async (message) => {
            if (message.author.bot) return;
            
            try {
                // Standard-Prefix
                let prefix = "!";
                
                // Versuche Guild-spezifischen Prefix zu laden
                if (message.guild) {
                    try {
                        const dbService = ServiceManager.get("dbService");
                        
                        // SICHERHEITSPRÜFUNG: Nur Guilds erlauben, die in der DB registriert sind
                        const [guildData] = await dbService.query(
                            "SELECT _id, guild_name FROM guilds WHERE _id = ? LIMIT 1",
                            [message.guild.id]
                        );
                        
                        if (!guildData) {
                            Logger.debug(`🚫 SECURITY: Guild ${message.guild.id} (${message.guild.name}) ist nicht in der Datenbank registriert. Prefix-Command wird blockiert.`);
                            // Stille ignorieren - keine Nachricht senden bei Prefix-Commands
                            return;
                        }
                        
                        const configs = await dbService.getConfigs(message.guild.id, "core", "shared");
                             
                        if (configs?.['PREFIX_COMMANDS_PREFIX']) {
                            prefix = configs['PREFIX_COMMANDS_PREFIX'];
                        }
                    } catch (err) {
                        Logger.warn(`Konnte Präfix für Guild ${message.guild.id} nicht laden:`, err);
                    }
                }

                // Guild-spezifische Konfigurationen prüfen
                const dbService = ServiceManager.get("dbService");
                const guildConfigs = message.guild ? 
                    await dbService.getConfigs(message.guild.id, "core", "shared") : 
                    null;

                // Prüfen ob Prefix-Commands überhaupt aktiviert sind
                if (guildConfigs?.PREFIX_COMMANDS_ENABLED === "0" || 
                    guildConfigs?.PREFIX_COMMANDS_ENABLED === false) {
                    return;
                }

                // Prüfen ob Nachricht mit Prefix beginnt
                if (!message.content.startsWith(prefix)) return;

                const args = message.content.slice(prefix.length).trim().split(/\s+/);
                const commandName = args.shift()?.toLowerCase();
                
                if (!commandName) return;

                // Prüfen ob der Command deaktiviert ist
                const disabledCommands = guildConfigs?.DISABLED_PREFIX || [];
                if (Array.isArray(disabledCommands) && disabledCommands.includes(commandName)) {
                    Logger.debug(`Command ${commandName} ist für Guild ${message.guild.id} deaktiviert`);
                    return;
                }

                const command = this.prefixCommands.get(commandName);
                if (!command) return;

                // Prüfen ob das Plugin für diese Guild aktiviert ist (aus guild_plugins Tabelle)
                let enabledPlugins = ['core'];
                try {
                    const pluginRows = await dbService.query(
                        "SELECT plugin_name FROM guild_plugins WHERE guild_id = ? AND is_enabled = 1",
                        [message.guild.id]
                    );
                    enabledPlugins = pluginRows.map(row => row.plugin_name);
                    
                    // Sicherstellen dass core immer aktiviert ist
                    if (!enabledPlugins.includes("core")) {
                        enabledPlugins.push("core");
                    }
                } catch (error) {
                    Logger.error(`Fehler beim Laden der aktivierten Plugins für Guild ${message.guild.id}:`, error);
                }

                if (!enabledPlugins.includes(command.plugin?.name)) {
                    Logger.debug(`Plugin ${command.plugin?.name} ist für Guild ${message.guild.id} nicht aktiviert`);
                    return;
                }

                if (command.messageRun) {
                    await command.messageRun({ 
                        message, 
                        args, 
                        prefix,
                        client: this.client 
                    });
                }
            } catch (error) {
                Logger.error(`Fehler bei der Verarbeitung der Nachricht:`, error);
            }
        });
        } else {
            Logger.debug('messageCreate-Handler für den Client bereits registriert');
        }
        
        Logger.debug('Client-Event-Handler für CommandManager registriert');
    }
    
    /**
     * Druckt eine Zusammenfassung der registrierten Befehle und Event-Handler
     * Hilfreich für Debug-Zwecke
     */
    printDebugInfo() {
        Logger.info('=== CommandManager Debug Information ===');
        Logger.info(`Registrierte Prefix-Befehle: ${this.prefixCommands.size}`);
        if (this.prefixCommands.size > 0) {
            Logger.info('Prefix-Befehle:');
            this.prefixCommands.forEach((cmd, name) => {
                Logger.info(`- ${name} (Plugin: ${cmd.plugin ? cmd.plugin.name : 'unbekannt'})`);
            });
        }
        
        Logger.info(`Registrierte Slash-Befehle: ${this.slashCommands.size}`);
        if (this.slashCommands.size > 0) {
            Logger.info('Slash-Befehle:');
            this.slashCommands.forEach((cmd, name) => {
                Logger.info(`- ${name} (Plugin: ${cmd.plugin ? cmd.plugin.name : 'unbekannt'})`);
            });
        }
        
        Logger.info(`Registrierte Kontext-Menüs: ${this.contextMenus.size}`);
        
        // Client-Events überprüfen
        Logger.info('Discord.js Client Event-Handler:');
        if (this.client && this.client._events) {
            for (const [event, handlers] of Object.entries(this.client._events)) {
                const count = Array.isArray(handlers) ? handlers.length : (handlers ? 1 : 0);
                Logger.info(`- ${event}: ${count} Handler`);
            }
        } else {
            Logger.info('- Keine Client-Events gefunden!');
        }
        
        Logger.info('======================================');
    }

    /**
     * Deregistriert alle Befehle und Kontextmenüs eines Plugins
     * Gegenstück zu registerPlugin - wird beim Deaktivieren eines Plugins aufgerufen
     * 
     * @param {import("dunebot-sdk").BotPlugin} plugin - Das Plugin, dessen Befehle deregistriert werden sollen
     * @returns {Object} Statistik über die entfernten Befehle
     */
    unregisterPlugin(plugin) {
        Logger.info(`Deregistriere Befehle aus Plugin ${plugin.name}...`);
        
        // Hook vor der Befehlsderegistrierung ausführen
        if (this.hooks) {
            this.hooks.doAction('before_unregister_commands', { plugin });
        }
        
        // Zähler für die Statistik
        let removedPrefix = 0;
        let removedSlash = 0;
        let removedContexts = 0;
        
        // Prefix-Befehle entfernen
        for (const [name, cmd] of this.prefixCommands.entries()) {
            if (cmd.plugin && cmd.plugin.name === plugin.name) {
                this.prefixCommands.delete(name);
                removedPrefix++;
                
                // Hook nach dem Entfernen eines Prefix-Befehls
                if (this.hooks) {
                    this.hooks.doAction('after_unregister_prefix_command', { command: cmd });
                }
            }
        }
        
        // Slash-Befehle entfernen
        for (const [name, cmd] of this.slashCommands.entries()) {
            if (cmd.plugin && cmd.plugin.name === plugin.name) {
                this.slashCommands.delete(name);
                removedSlash++;
                
                // Hook nach dem Entfernen eines Slash-Befehls
                if (this.hooks) {
                    this.hooks.doAction('after_unregister_slash_command', { command: cmd });
                }
            }
        }
        
        // Kontextmenüs entfernen
        for (const [name, ctx] of this.contextMenus.entries()) {
            if (ctx.plugin && ctx.plugin.name === plugin.name) {
                this.contextMenus.delete(name);
                removedContexts++;
                
                // Hook nach dem Entfernen eines Kontextmenüs
                if (this.hooks) {
                    this.hooks.doAction('after_unregister_context', { context: ctx });
                }
            }
        }
        
        // Statistik ausgeben
        Logger.info(`${removedPrefix + removedSlash} Befehle deregistriert [${removedPrefix} Prefix, ${removedSlash} Slash]`);
        Logger.info(`${removedContexts} Kontextmenüs deregistriert`);
        
        // Hook nach der Befehlsderegistrierung ausführen
        if (this.hooks) {
            this.hooks.doAction('after_unregister_commands', { 
                plugin, 
                stats: { removedPrefix, removedSlash, removedContexts } 
            });
        }
        
        // Statistik zurückgeben
        return { removedPrefix, removedSlash, removedContexts };
    }
}
module.exports = CommandManager;