const crypto = require("crypto");
const { Collection, ApplicationCommandType } = require("discord.js");
const { Logger, istAn } = require("dunebot-sdk/utils");
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
        
        // Eigene Zuhörer für Befehle hängt der CommandManager nicht mehr an (K334,
        // 2026-11-09). registerClientEventHandlers() tat das nur, wenn noch niemand
        // auf interactionCreate hörte — das core-Plugin tut es immer, also lief es
        // nie; ohne core wäre es ein zweiter Weg mit eigenen Regeln gewesen. Befehle
        // verteilt allein apps/bot/handler.js über die Ereignisse des core-Plugins.
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
                    const commands = await this.#registerGuildCommands(guildId);
                    const wo = guild ? `${guild.name} (${guild.id})` : guildId;

                    // `null` heisst: Der Satz stand schon bei Discord, es wurde
                    // nichts gesendet. Frueher stand hier in dem Fall
                    // "Registered 0 interactions" — was nach Verlust aussieht.
                    if (commands === null) {
                        Logger.debug(`Slash-Commands in guild ${wo} unveraendert`);
                    } else {
                        Logger.info(`Registered ${commands.size} interactions in guild ${wo}`);
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
     *
     * Ohne `force`-Parameter: Die 10-Sekunden-Bremse sitzt in der Warteschlange
     * (#processRegistrationQueue), die Aenderungspruefung weiter unten. Hier
     * gab es fuer den Wert nichts mehr zu tun.
     */
    async #registerGuildCommands(guildId) {
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

        // Ein Schalter je Guild für alles, was Discord als Anwendungsbefehl
        // führt: Slash-Befehle und Kontextmenüs (K365, 2026-11-11).
        //
        // Bis dahin stand hier `INTERACTIONS_SLASH ?? true` und ein zweiter
        // Schlüssel `INTERACTIONS_CONTEXT`. Die Werte kommen als Text ("1"/"0"),
        // "0" ist wahr — beide waren in jeder Guild an, egal was gespeichert
        // war. Und war doch einmal alles aus, kehrte die Methode vorzeitig
        // zurück: Bei Discord blieb der alte Satz stehen. Jetzt wird bei „aus“
        // ein leerer Satz gesendet, damit die Befehle dort verschwinden.
        const slashAn = istAn(configs?.INTERACTIONS_SLASH);

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
        
        // Filter commands from enabled plugins
        if (slashAn) {
            Array.from(this.slashCommands.values())
                .filter((cmd) => {
                    const plugin = cmd.plugin;
                    if (plugin.name === 'kern') return true;
                    const isGloballyEnabled = this.client.pluginManager.isPluginEnabled(plugin.name);
                    const isGuildEnabled = enabledPlugins.includes(plugin.name);
                    return isGloballyEnabled && isGuildEnabled;
                })
                .map((cmd) => ({
                    name: cmd.name,
                    description: this.client.translate(cmd.description),
                    descriptionLocalizations: this.client.i18n.getAllTr(cmd.description),
                    type: ApplicationCommandType.ChatInput,
                    options: this.#uebersetzeOptionen(cmd.slashCommand.options),
                }))
                .forEach((s) => toRegister.push(s));
        }

        // Filter context menus from enabled plugins
        if (slashAn) {
            Array.from(this.contextMenus.values())
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
        // ────────────────────────────────────────────────────────────────
        // Nur senden, wenn sich wirklich etwas geaendert hat.
        //
        // `guild.commands.set()` ueberschreibt bei Discord den kompletten Satz.
        // Bis zum 2026-08-04 lief das bei JEDEM Start fuer JEDE Guild, ohne zu
        // fragen, ob sich etwas geaendert hat. Discord bremst das ab: Eine
        // einzelne Guild brauchte 59 Sekunden, ueber alle hinweg waren die
        // Befehle rund vier Minuten lang weg. Bei 23 Neustarts an einem Tag
        // war das viermal taeglich ein Ausfall ohne jeden Anlass.
        // ────────────────────────────────────────────────────────────────
        const pruefsumme = CommandManager.#satzPruefsumme(toRegister);

        // `force` bleibt hier bewusst aussen vor.
        //
        // Es bedeutet "umgeh die 10-Sekunden-Bremse", nicht "sende auch, wenn
        // sich nichts geaendert hat" — und wird beim Laden JEDES Plugins fuer
        // JEDE Guild gesetzt (updatePluginStatus → #queueGuildRegistration mit
        // true). Wuerde es auch diese Pruefung uebergehen, waere die Ersparnis
        // beim Start sofort wieder weg: genau der Fall, der am 2026-08-04 in
        // den Protokollen stand, waehrend fuenf Guilds sauber uebersprangen.
        //
        // Aendert ein Plugin die Befehle wirklich, faellt das ueber die
        // Pruefsumme ohnehin auf. Soll doch einmal erzwungen neu gesendet
        // werden (etwa weil bei Discord von Hand etwas geloescht wurde), reicht
        // ein DELETE der Zeile aus `guild_command_state`.
        if (await this.#satzUnveraendert(guildId, pruefsumme)) {
            Logger.info(`Slash-Commands fuer Guild ${guildId} unveraendert (${toRegister.length}) — nichts gesendet`);
            return null;
        }

        try {
            const commands = await guild.commands.set(toRegister);
            Logger.debug(`Successfully registered ${commands.size} commands for guild ${guildId}`);
            await this.#merkeSatz(guildId, pruefsumme, toRegister.length);
            return commands;
        } catch (error) {
            Logger.error(`Error registering commands for guild ${guildId}:`, error);
            throw error;
        }
    }

    /**
     * Uebersetzt die Optionen eines Befehls — ohne die Vorlage anzufassen.
     *
     * Vorher stand hier `opt.description = translate(opt.description)`. Das
     * beschrieb das Befehlsobjekt selbst, und zwar dauerhaft: Beim naechsten
     * Aufruf lag dort nicht mehr der Uebersetzungsschluessel, sondern deutscher
     * Text. `translate()` fand dafuer nichts mehr, und `getAllTr()` bekam ihn
     * ebenfalls als Schluessel gereicht — die Lokalisierungen anderer Sprachen
     * waren ab der zweiten Guild dahin.
     *
     * Aufgefallen ist es an der neuen Pruefsumme: Fuer Guilds mit
     * Optionen-Befehlen kam bei jedem Durchlauf ein anderer Satz heraus, also
     * wurde jedes Mal neu registriert. Die kleinen Guilds (nur Kern-Befehle
     * ohne Optionen) uebersprangen dagegen sauber.
     *
     * Der zweite Fehler steckte in der Reihenfolge: `getAllTr` wurde erst NACH
     * der Zuweisung aufgerufen, bekam also schon den uebersetzten Text statt
     * des Schluessels — selbst beim allerersten Durchlauf.
     */
    #uebersetzeOptionen(optionen) {
        if (!Array.isArray(optionen)) return optionen;

        return optionen.map((opt) => {
            const kopie = { ...opt };

            if (opt.description) {
                kopie.description = this.client.translate(opt.description);
                kopie.descriptionLocalizations = this.client.i18n.getAllTr(opt.description);
            }
            // Auswahlnamen genauso, aber nur, wenn sie ein Sprachschlüssel sind
            // (2026-11-06, zuerst für /music filter und /music loop). Feste
            // Namen wie "ON" oder "TIMEOUT" bleiben unberührt.
            if (Array.isArray(opt.choices)) {
                kopie.choices = opt.choices.map((wahl) => (
                    /^[a-z][a-z0-9_-]*:[A-Z0-9_.]+$/.test(wahl.name)
                        ? {
                            ...wahl,
                            name: this.client.translate(wahl.name),
                            nameLocalizations: this.client.i18n.getAllTr(wahl.name),
                        }
                        : wahl
                ));
            }
            if (Array.isArray(opt.options)) {
                kopie.options = this.#uebersetzeOptionen(opt.options);
            }

            return kopie;
        });
    }

    /**
     * Pruefsumme eines Befehlssatzes.
     *
     * Die Reihenfolge, in der die Befehle zusammenkommen, haengt an der
     * Ladereihenfolge der Plugins — deshalb wird nach Namen sortiert, bevor
     * gehasht wird. Sonst gaebe es bei gleichem Inhalt unterschiedliche
     * Summen, und die Ersparnis waere dahin.
     */
    static #satzPruefsumme(befehle) {
        const sortiert = [...befehle].sort((a, b) =>
            String(a.name).localeCompare(String(b.name)) || (a.type || 0) - (b.type || 0));
        return crypto.createHash('sha256')
            .update(JSON.stringify(sortiert))
            .digest('hex');
    }

    /**
     * Steht dieser Satz bei Discord schon?
     *
     * Im Zweifel `false`: Lieber einmal zu viel senden als eine Guild ohne
     * Befehle zuruecklassen, weil die Tabelle nicht erreichbar war.
     */
    async #satzUnveraendert(guildId, pruefsumme) {
        const dbService = ServiceManager.get("dbService");
        try {
            const [zeile] = await dbService.query(
                'SELECT commands_hash FROM guild_command_state WHERE guild_id = ? LIMIT 1',
                [guildId]
            );
            return zeile?.commands_hash === pruefsumme;
        } catch (error) {
            ServiceManager.get("Logger").warn(
                `[CommandManager] Stand fuer Guild ${guildId} nicht lesbar, registriere sicherheitshalber:`,
                error.message
            );
            return false;
        }
    }

    /** Haelt fest, was jetzt bei Discord steht. */
    async #merkeSatz(guildId, pruefsumme, anzahl) {
        const dbService = ServiceManager.get("dbService");
        try {
            await dbService.query(`
                INSERT INTO guild_command_state (guild_id, commands_hash, command_count)
                VALUES (?, ?, ?)
                ON DUPLICATE KEY UPDATE commands_hash = VALUES(commands_hash),
                                        command_count = VALUES(command_count)
            `, [guildId, pruefsumme, anzahl]);
        } catch (error) {
            // Nicht schlimm: Beim naechsten Start wird eben neu registriert.
            ServiceManager.get("Logger").warn(
                `[CommandManager] Stand fuer Guild ${guildId} nicht speicherbar:`, error.message
            );
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
}
module.exports = CommandManager;