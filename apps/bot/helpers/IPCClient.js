const veza = require("veza");
const { Logger } = require("dunebot-sdk/utils");
const { languagesMeta } = require("dunebot-core");
const { ChannelType } = require("discord.js");

class IPCClient {
    /**
     * @param {import('discord.js').Client} discordClient
     */
    constructor(discordClient) {
        if (!discordClient?.shard?.ids?.length) {
            throw new Error("Discord client must be sharded");
        }

        if (!process.env.IPC_SERVER_PORT) {
            throw new Error("IPC_SERVER_PORT environment variable is required");
        }

        if (!process.env.IPC_SERVER_HOST) {
            throw new Error("IPC_SERVER_HOST environment variable is required");
        }
        this.port = parseInt(process.env.IPC_SERVER_PORT, 10);
        this.host = process.env.IPC_SERVER_HOST;
        this.discordClient = discordClient;
        this.shardId = discordClient.shard.ids[0];
        this.firstConnect = false;
        this.logger = Logger;
        this._initialized = false;
        this._reconnectInterval = null;
        this.node = this.createNode();
    }

    createNode() {
        return new veza.Client(`Bot #${this.shardId}`, {
            retryTime: 1000,
            maxRetries: 10,  // Maximale Anzahl von Wiederverbindungsversuchen
        })
            .on("error", (error, client) => {
                // Verbesserte Fehlerbehandlung
                if (error.code === 'ECONNRESET') {
                    this.logger.warn(`[IPC] Verbindung zurückgesetzt von ${client?.name || 'unbekannt'}, versuche neu zu verbinden...`);
                    // Wiederverbindung nach kurzer Verzögerung versuchen
                    setTimeout(() => this.reconnect(), 2000);
                    return;
                }
                this.logger.error(`[IPC] Fehler von ${client?.name || 'unbekannt'}:`, error);
            })
            .on("disconnect", (client) => {
                this.logger.warn(`[IPC] Verbindung getrennt von ${client?.name || 'unbekannt'}, versuche neu zu verbinden...`);
                // Wiederverbindung nach kurzer Verzögerung versuchen
                setTimeout(() => this.reconnect(), 2000);
            })
            .on("ready", async (_client) => {
                this.logger.success(`[IPC] Bot-Client (Shard#${this.shardId}) erfolgreich mit Dashboard-IPC-Server verbunden`);
                this.firstConnect = true;
            });
    }

    /**
     * Versucht erneut, eine Verbindung zum IPC-Server herzustellen
     * @returns {Promise<void>}
     */
    async reconnect() {
        try {
            this.logger.info(`[IPC] Versuche, erneut eine Verbindung zum IPC-Server herzustellen: ${this.host}:${this.port}`);
            
            // Prüfen, ob der Port erreichbar ist
            const isPortAvailable = await this.isPortReachable(this.port, this.host);
            if (!isPortAvailable) {
                this.logger.warn(`[IPC] Port ${this.port} auf Host ${this.host} scheint nicht erreichbar zu sein`);
            }
            
            await this.connect();
        } catch (error) {
            this.logger.error("[IPC] Fehler bei der Wiederverbindung:", error);
        }
    }

    /**
     * Prüft, ob ein bestimmter Port auf einem Host erreichbar ist
     * @param {number} port - Der zu prüfende Port
     * @param {string} host - Der Hostname oder die IP-Adresse
     * @returns {Promise<boolean>} - true, wenn der Port erreichbar ist, sonst false
     */
    isPortReachable(port, host) {
        const net = require('net');
        return new Promise((resolve) => {
            const socket = new net.Socket();
            
            const onError = () => {
                socket.destroy();
                resolve(false);
            };
            
            socket.setTimeout(1000);
            socket.once('error', onError);
            socket.once('timeout', onError);
            
            socket.connect(port, host, () => {
                socket.end();
                resolve(true);
            });
        });
    }

    /**
     * Stellt eine Verbindung zum IPC-Server her, nachdem geprüft wurde ob der Port erreichbar ist
     * @returns {Promise<void>}
     */
    async connect() {
        try {
            // Zuerst prüfen, ob der Port überhaupt erreichbar ist
            const isReachable = await this.isPortReachable(this.port, this.host);
            
            if (!isReachable) {
                this.logger.warn(`[IPC] Port ${this.port} auf Host ${this.host} ist nicht erreichbar. IPC-Server läuft vermutlich nicht.`);
                
                // Optional: Hier könnten wir nach einer Verzögerung einen erneuten Versuch planen
                setTimeout(() => this.reconnect(), 5000); // Längere Verzögerung, um unnötige Verbindungsversuche zu vermeiden
                return;
            }
            
            this.logger.debug(`[IPC] Port ${this.port} auf Host ${this.host} ist erreichbar. Verbindungsversuch wird gestartet...`);
            
            // Verbindung herstellen, wenn der Port erreichbar ist
            return this.node
                .connectTo(this.port, this.host)
                .then(() => {
                    this.firstConnect = true;
                    this.logger.info("[IPC] Verbindung hergestellt");
                })
                .catch((error) => {
                    if (error.code == "ECONNREFUSED") {
                        this.logger.warn("[IPC] Verbindung verweigert - Server möglicherweise nicht gestartet oder überlastet");
                        return;
                    }
                    this.logger.error("[IPC] Verbindungsfehler:", error);
                });
        } catch (error) {
            this.logger.error("[IPC] Fehler beim Verbindungsversuch:", error);
        }
    }

     /**
     * Initialisiert den IPC-Client und stellt die erste Verbindung her
     * @param {import('discord.js').Client} client - Discord-Client-Instanz
     * @returns {void}
     */
    initialize(client) {
        // Schutz vor mehrfacher Initialisierung
        if (this._initialized) {
            this.logger.debug("[IPC] IPC-Client wurde bereits initialisiert, überspringe...");
            return;
        }
        
        this.logger.info("[IPC] Initialisiere IPC-Client...");
        this._initialized = true;
        this.discordClient = client;
        
        // Event-Handler für Nachrichten registrieren
        if (this.node) {
            // Alle bestehenden Listener entfernen um Duplikate zu vermeiden
            this.node.removeAllListeners("message");
            this.node.on("message", this.handleMessage.bind(this));
        }

        // Erste Verbindung versuchen
        this.connect();
    }

    /**
     * Bereinigt Ressourcen bei Beendigung
     */
    cleanup() {
        if (this._reconnectInterval) {
            clearInterval(this._reconnectInterval);
            this._reconnectInterval = null;
        }
        
        if (this.node) {
            try {
                this.node.disconnect();
            } catch (error) {
                // Ignorieren, da wir sowieso aufräumen
            }
        }
    }

    /**
     * Handlet die eingehenden messages
     * ruft für jede message den passenden message context auf
     */
    async handleMessage(message) {
        try {
            // DEBUG: Message-Struktur loggen
            this.logger.debug(`[IPC-DEBUG] handleMessage() aufgerufen, event: ${message?.data?.event}`);
            
            if (!message?.data?.event) {
                this.logger.warn('[IPC-DEBUG] Keine Event-Daten, abgebrochen');
                return;
            }

            const { event, payload } = message.data;
            this.logger.info(`[IPC] Bot empfängt IPC-Event: ${event}`);
            
            const [pluginName, eventName] = event.split(":");

            if (!pluginName || !eventName) {
                this.logger.warn(`[IPC] Ungültiges Event-Format: ${event}`);
                return message.reply({ success: false, error: "Invalid event format" });
            }

            if (pluginName === "dashboard") {
                this.logger.debug(`[IPC] Verarbeite Dashboard-Event: ${eventName}`);
                return await this.#handleBaseMessage(eventName, message);
            }

            const plugin = this.discordClient.pluginManager.getPlugin(pluginName);
            if (!plugin?.ipcEvents?.has(eventName)) {
                this.logger.warn(`[IPC] Handler nicht gefunden: ${pluginName}:${eventName}`);
                return message.reply({ success: false, error: "Handler not found" });
            }

            try {
                const handler = plugin.ipcEvents.get(eventName);
                const data = await handler(payload, this.discordClient);
                return message.reply({
                    success: true,
                    data: data,
                });
            } catch (error) {
                this.logger.error(`Error in plugin ${pluginName} IPC handler: ${error.message}`, error);
                return message.reply({
                    success: false,
                    error: error.message,
                });
            }
        } catch (error) {
            this.logger.error(`[IPC] FATAL ERROR in handleMessage():`, error);
            if (message?.reply) {
                return message.reply({ success: false, error: error.message });
            }
        }
    }

    /**
     * Verarbeitet Standard-Dashboard-IPC-Events
     * @param {string} eventName - Name des Events (nach "dashboard:")
     * @param {object} message - Veza-Nachrichtenobjekt
     * @returns {Promise<void>}
     * @private
     */
    async #handleBaseMessage(eventName, message) {
        this.logger.debug(`[IPC] Verarbeite Dashboard-Event: ${eventName}`);
        const { payload } = message.data;
        
        try {
            switch (eventName) {
                case "PING_PONG":
                    return await this.#handlePingPong(message);
                    
                case "GET_STATS":
                    return await this.#handleGetStats(message);
                    
                case "GET_GUILD_STATS":
                    return await this.#handleGetGuildStats(message, payload);
                
                case "GET_GUILD_EXTENDED_STATS":
                    return await this.#handleGetGuildExtendedStats(message, payload);

                case "VALIDATE_GUILD":
                    return await this.#handleValidateGuild(message, payload);
                    
                case "GET_BOT_GUILDS":
                    return await this.#handleGetBotGuilds(message);
                    
                case "SEND_NOTIFICATION":
                    return await this.#handleSendNotification(message, payload);
                    
                case "GET_CMDS_SUMMARY":
                    return await this.#handleGetCommandsSummary(message, payload);
                    
                case "GET_PLUGIN_CMDS":
                    return await this.#handleGetPluginCommands(message, payload);
                    
                case "GET_LOCALE_BUNDLE":
                    return await this.#handleGetLocaleBundle(message, payload);
                    
                case "SET_LOCALE_BUNDLE":
                    return await this.#handleSetLocaleBundle(message, payload);
                    
                case "UPDATE_PLUGIN":
                    return await this.#handleUpdatePlugin(message, payload);
                    
                case "RELOAD_PLUGIN":
                    return await this.#handleReloadPlugin(message, payload);
                
                case "GET_GUILD_INFO":
                    return await this.#handleGetGuildInfo(message, payload);
                    
                case "GET_GUILD_CHANNELS":
                    return await this.#handleGetGuildChannels(message, payload);
                    
                case "GET_GUILD_ROLES":
                    return await this.#handleGetGuildRoles(message, payload);
                    
                case "GET_GUILD_MEMBERS":
                    return await this.#handleGetGuildMembers(message, payload);
                    
                case "GET_ALL_GUILD_MEMBERS":
                    return await this.#handleGetAllGuildMembers(message, payload);
                    
                case "BOT_HEALTH_CHECK":
                    return await this.#handleBotHealthCheck(message);
                    
                default:
                    this.logger.warn(`[IPC] Unbekanntes Dashboard-Event: ${eventName}`);
                    return message.reply({
                        success: false,
                        error: `Unbekanntes Event: ${eventName}`
                    });
            }
        } catch (error) {
            this.logger.error(`[IPC] Fehler bei der Verarbeitung von Dashboard-Event ${eventName}:`, error);
            return message.reply({
                success: false,
                error: error.message || "Ein unbekannter Fehler ist aufgetreten"
            });
        }
    }
    
    // REGISTER ALL THE HANDLERS WE NEED HERE!

    /**
     * 
     * 
     * 
     */
    async #handlePingPong(message) {
        return message.reply({
                        success: true,
                        pong: true,
                        timestamp: Date.now()
                    });
    }


    /**
     * Liefert detaillierte Informationen zu einer Guild
     * @param {object} message - Veza-Nachrichtenobjekt
     * @param {object} payload - Enthält die Guild-ID
     * @returns {Promise<void>}
     * @private
     */
    async #handleGetGuildInfo(message, payload) {
        try {
            if (!payload?.guildId) {
                return message.reply({
                    success: false,
                    error: "Guild-ID ist erforderlich"
                });
            }
            
            const guild = this.discordClient.guilds.cache.get(payload.guildId);
            if (!guild) {
                return message.reply({
                    success: false,
                    error: "Guild nicht gefunden"
                });
            }

            // Detaillierte Guild-Informationen sammeln
            const guildInfo = {
                id: guild.id,
                name: guild.name,
                icon: guild.iconURL({ dynamic: true }),
                channels: guild.channels.cache.map(channel => ({
                    id: channel.id,
                    name: channel.name,
                    type: channel.type,
                    parentId: channel.parentId
                })),
                roles: guild.roles.cache.map(role => ({
                    id: role.id,
                    name: role.name,
                    color: role.color,
                    position: role.position,
                    permissions: role.permissions.toArray()
                })),
                emojis: guild.emojis.cache.map(emoji => ({
                    id: emoji.id,
                    name: emoji.name,
                    animated: emoji.animated,
                    url: emoji.url
                })),
                features: guild.features,
                memberCount: guild.memberCount,
                owner_id: guild.ownerId,
                region: guild.preferredLocale
            };

            return message.reply({
                success: true,
                data: guildInfo
            });
        } catch (error) {
            this.logger.error("[IPC] Fehler beim Abrufen der Guild-Informationen:", error);
            return message.reply({
                success: false,
                error: error.message
            });
        }
    }

    /**
     * Liefert alle Text-Channels einer Guild für Dropdown-Selects
     * @param {object} message - Veza-Nachrichtenobjekt
     * @param {object} payload - Enthält die Guild-ID
     * @returns {Promise<void>}
     * @private
     * @author DuneBot Team
     */
    async #handleGetGuildChannels(message, payload) {
        const { ChannelType } = require('discord.js');
        
        try {
            if (!payload?.guildId) {
                this.logger.warn('[IPC] GET_GUILD_CHANNELS: Keine guildId im Payload');
                return message.reply({
                    success: false,
                    error: "Guild-ID ist erforderlich"
                });
            }
            
            const guild = this.discordClient.guilds.cache.get(payload.guildId);
            if (!guild) {
                this.logger.warn(`[IPC] GET_GUILD_CHANNELS: Guild ${payload.guildId} nicht gefunden`);
                return message.reply({
                    success: false,
                    error: "Guild nicht gefunden"
                });
            }

            // Nur Text-Channels (ChannelType.GuildText = 0)
            const channels = guild.channels.cache
                .filter(ch => ch.type === ChannelType.GuildText)
                .map(ch => ({
                    id: ch.id,
                    name: ch.name,
                    type: ch.type,
                    parentId: ch.parentId,
                    parentName: ch.parent?.name || null
                }))
                .sort((a, b) => {
                    // Sortierung: Erst nach Category, dann alphabetisch
                    if (a.parentName && !b.parentName) return 1;
                    if (!a.parentName && b.parentName) return -1;
                    if (a.parentName !== b.parentName) {
                        return (a.parentName || '').localeCompare(b.parentName || '');
                    }
                    return a.name.localeCompare(b.name);
                });

            this.logger.debug(`[IPC] GET_GUILD_CHANNELS: ${channels.length} Channels für Guild ${payload.guildId}`);

            return message.reply({
                success: true,
                channels: channels
            });
        } catch (error) {
            this.logger.error("[IPC] Fehler beim Abrufen der Guild-Channels:", error);
            return message.reply({
                success: false,
                error: error.message
            });
        }
    }

    /**
     * Liefert Rollen einer Guild zurück
     * Filtert @everyone, managed roles und Rollen höher als Bot
     * @param {object} message - Veza-Nachrichtenobjekt
     * @param {object} payload - Enthält die Guild-ID
     * @returns {Promise<void>}
     * @private
     * @author DuneBot Team
     */
    async #handleGetGuildRoles(message, payload) {
        try {
            if (!payload?.guildId) {
                this.logger.warn('[IPC] GET_GUILD_ROLES: Keine guildId im Payload');
                return message.reply({
                    success: false,
                    error: "Guild-ID ist erforderlich"
                });
            }
            
            const guild = this.discordClient.guilds.cache.get(payload.guildId);
            if (!guild) {
                this.logger.warn(`[IPC] GET_GUILD_ROLES: Guild ${payload.guildId} nicht gefunden`);
                return message.reply({
                    success: false,
                    error: "Guild nicht gefunden"
                });
            }

            // Debug: Alle Rollen ausgeben
            const allRoles = guild.roles.cache.size;
            const botMember = guild.members.me;
            
            this.logger.info(`[IPC] GET_GUILD_ROLES Debug - Guild: ${guild.name}`);
            this.logger.info(`[IPC] - Gesamt-Rollen: ${allRoles}`);
            this.logger.info(`[IPC] - Bot Member: ${botMember ? 'Ja' : 'Nein'}`);
            if (botMember) {
                this.logger.info(`[IPC] - Bot höchste Rolle: ${botMember.roles.highest.name} (Position: ${botMember.roles.highest.position})`);
            }

            // Filtere Rollen: Keine @everyone, keine managed roles, nicht höher als Bot
            const roles = guild.roles.cache
                .filter(role => {
                    // @everyone ausschließen
                    if (role.id === guild.id) {
                        this.logger.debug(`[IPC]   ❌ ${role.name} - @everyone`);
                        return false;
                    }
                    
                    // Managed roles (z.B. Bot-Rollen, Boosts) ausschließen
                    if (role.managed) {
                        this.logger.debug(`[IPC]   ❌ ${role.name} - managed`);
                        return false;
                    }
                    
                    // Rollen höher als Bot ausschließen (gleiche Position ist erlaubt!)
                    if (botMember && role.position > botMember.roles.highest.position) {
                        this.logger.debug(`[IPC]   ❌ ${role.name} - Position ${role.position} > Bot ${botMember.roles.highest.position}`);
                        return false;
                    }
                    
                    this.logger.debug(`[IPC]   ✅ ${role.name} - OK (Position: ${role.position})`);
                    return true;
                })
                .map(role => ({
                    id: role.id,
                    name: role.name,
                    color: role.color,
                    position: role.position,
                    hexColor: role.hexColor
                }))
                .sort((a, b) => b.position - a.position); // Sortierung: Höchste Position zuerst

            this.logger.debug(`[IPC] GET_GUILD_ROLES: ${roles.length} Rollen für Guild ${payload.guildId}`);

            return message.reply({
                success: true,
                roles: roles
            });
        } catch (error) {
            this.logger.error("[IPC] Fehler beim Abrufen der Guild-Rollen:", error);
            return message.reply({
                success: false,
                error: error.message
            });
        }
    }

    /**
     * Liefert Guild-Members für eine bestimmte Guild
     * Löst User-IDs zu Discord-Usernamen auf
     * @param {object} message - Veza-Nachrichtenobjekt
     * @param {object} payload - Enthält guildId und userIds
     * @returns {Promise<void>}
     * @private
     * @author DuneBot Team
     */
    async #handleGetGuildMembers(message, payload) {
        try {
            if (!payload?.guildId) {
                this.logger.warn('[IPC] GET_GUILD_MEMBERS: Keine guildId im Payload');
                return message.reply({
                    success: false,
                    error: "Guild-ID ist erforderlich"
                });
            }
            
            if (!payload?.userIds || !Array.isArray(payload.userIds)) {
                this.logger.warn('[IPC] GET_GUILD_MEMBERS: userIds fehlt oder ist kein Array');
                return message.reply({
                    success: false,
                    error: "userIds muss ein Array sein"
                });
            }
            
            const guild = this.discordClient.guilds.cache.get(payload.guildId);
            if (!guild) {
                this.logger.warn(`[IPC] GET_GUILD_MEMBERS: Guild ${payload.guildId} nicht gefunden`);
                return message.reply({
                    success: false,
                    error: "Guild nicht gefunden"
                });
            }

            const members = {};
            
            // Batch-Fetch falls Member nicht im Cache
            if (guild.members.cache.size < guild.memberCount) {
                try {
                    await guild.members.fetch();
                    this.logger.debug('[IPC] GET_GUILD_MEMBERS: Members aus API gefetcht');
                } catch (err) {
                    this.logger.warn('[IPC] Member-Fetch fehlgeschlagen, nutze Cache:', err.message);
                }
            }
            
            // User-Daten für alle übergebenen IDs abrufen
            for (const userId of payload.userIds) {
                try {
                    const member = guild.members.cache.get(userId);
                    
                    if (member) {
                        members[userId] = {
                            id: member.id,
                            username: member.user.username,
                            discriminator: member.user.discriminator,
                            displayName: member.displayName,
                            nickname: member.nickname,
                            tag: member.user.tag,
                            avatar: member.user.displayAvatarURL({ dynamic: true }),
                            joinedAt: member.joinedTimestamp
                        };
                    } else {
                        // Fallback: User nicht in Guild
                        this.logger.debug(`[IPC] GET_GUILD_MEMBERS: User ${userId} nicht in Guild gefunden`);
                        members[userId] = {
                            id: userId,
                            username: `Unknown User (${userId.slice(0, 8)}...)`,
                            displayName: 'Unknown',
                            nickname: null,
                            tag: 'Unknown#0000',
                            avatar: null,
                            joinedAt: null
                        };
                    }
                } catch (err) {
                    this.logger.warn(`[IPC] Fehler bei User ${userId}:`, err.message);
                    members[userId] = {
                        id: userId,
                        username: `Error (${userId.slice(0, 8)}...)`,
                        displayName: 'Error',
                        nickname: null,
                        tag: 'Error#0000',
                        avatar: null,
                        joinedAt: null
                    };
                }
            }

            this.logger.debug(`[IPC] GET_GUILD_MEMBERS: ${Object.keys(members).length}/${payload.userIds.length} Members aufgelöst`);

            return message.reply({
                success: true,
                members: members
            });
        } catch (error) {
            this.logger.error("[IPC] Fehler beim Abrufen der Guild-Members:", error);
            return message.reply({
                success: false,
                error: error.message
            });
        }
    }

    /**
     * Get All Guild Members Handler
     * Gibt ALLE Mitglieder einer Guild zurück (für Mitglieder-Auswahl)
     * @param {object} message - Veza-Nachrichtenobjekt
     * @param {object} payload - Enthält guildId
     * @returns {Promise<void>}
     * @private
     */
    async #handleGetAllGuildMembers(message, payload) {
        try {
            if (!payload?.guildId) {
                this.logger.warn('[IPC] GET_ALL_GUILD_MEMBERS: Keine guildId im Payload');
                return message.reply({
                    success: false,
                    error: "Guild-ID ist erforderlich"
                });
            }
            
            const guild = this.discordClient.guilds.cache.get(payload.guildId);
            if (!guild) {
                this.logger.warn(`[IPC] GET_ALL_GUILD_MEMBERS: Guild ${payload.guildId} nicht gefunden`);
                return message.reply({
                    success: false,
                    error: "Guild nicht gefunden"
                });
            }

            // Fetch ALLE Members (force = true holt ALLE, auch Offline!)
            try {
                await guild.members.fetch({ force: true });
                this.logger.debug(`[IPC] GET_ALL_GUILD_MEMBERS: ${guild.members.cache.size} Members gefetcht (inkl. Offline)`);
            } catch (err) {
                this.logger.warn('[IPC] Member-Fetch fehlgeschlagen, nutze Cache:', err.message);
            }
            
            // Alle Members formatieren
            const members = guild.members.cache.map(member => ({
                user: {
                    id: member.user.id,
                    username: member.user.username,
                    discriminator: member.user.discriminator,
                    avatar: member.user.avatar,
                    avatarURL: member.user.displayAvatarURL({ dynamic: true, size: 128 }),
                    tag: member.user.tag,
                    bot: member.user.bot || false
                },
                nick: member.nickname || null,
                displayName: member.displayName || member.user.username,
                joinedAt: member.joinedTimestamp ? new Date(member.joinedTimestamp).toISOString() : null,
                roles: member.roles.cache
                    .filter(role => role.id !== guild.id) // Exclude @everyone
                    .map(role => ({
                        id: role.id,
                        name: role.name,
                        color: role.hexColor,
                        position: role.position
                    }))
                    .sort((a, b) => b.position - a.position) // Highest role first
            }));

            // Sortiere nach Display-Name
            members.sort((a, b) => {
                const nameA = a.displayName.toLowerCase();
                const nameB = b.displayName.toLowerCase();
                return nameA.localeCompare(nameB);
            });

            this.logger.info(`[IPC] GET_ALL_GUILD_MEMBERS: ${members.length} Members für Guild ${payload.guildId}`);

            return message.reply({
                success: true,
                members: members
            });
        } catch (error) {
            this.logger.error("[IPC] Fehler beim Abrufen ALLER Guild-Members:", error);
            return message.reply({
                success: false,
                error: error.message
            });
        }
    }

    /**
     * Bot Health Check Handler
     * Gibt Bot-Status und verfügbare Guilds zurück
     * @param {object} message - Veza-Nachrichtenobjekt
     * @returns {Promise<void>}
     * @private
     */
    async #handleBotHealthCheck(message) {
        try {
            // Alle Guild-IDs sammeln
            const guildIds = this.discordClient.guilds.cache.map(g => g.id);
            
            const healthData = {
                status: 'online',
                uptime: Math.floor(process.uptime()),
                guilds: guildIds,
                guildCount: guildIds.length,
                ping: this.discordClient.ws.ping,
                timestamp: Date.now(),
                memoryUsage: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) // MB
            };
            
            this.logger.debug(`[IPC Health-Check] ✓ ${healthData.guildCount} Guilds, ${healthData.ping}ms ping`);
            
            return message.reply({
                success: true,
                ...healthData
            });
            
        } catch (error) {
            this.logger.error('[IPC Health-Check] Error:', error);
            
            return message.reply({ 
                success: false,
                status: 'error',
                guilds: [],
                guildCount: 0,
                error: error.message,
                timestamp: Date.now()
            });
        }
    }

    /**
     * Liefert allgemeine Bot-Statistiken
     * @param {object} message - Veza-Nachrichtenobjekt
     * @returns {Promise<void>}
     * @private
     */
    async #handleGetStats(message) {
        try {
            const client = this.discordClient;
            const stats = {
                serverCount: client.guilds.cache.size,
                userCount: client.guilds.cache.reduce((acc, guild) => acc + (guild.memberCount || 0), 0),
                channelCount: client.channels.cache.size,
                uptimeSeconds: Math.floor(client.uptime / 1000),
                ping: client.ws.ping,
                shardId: this.shardId,
                readySince: client.readyTimestamp,
                systemStats: {
                    memoryUsage: process.memoryUsage(),
                    cpuUsage: process.cpuUsage()
                }
            };
            
            return message.reply({
                success: true,
                data: stats
            });
        } catch (error) {
            this.logger.error("[IPC] Fehler beim Abrufen der Bot-Statistiken:", error);
            return message.reply({
                success: false,
                error: error.message
            });
        }
    }
    
    /**
     * Liefert Statistiken für eine bestimmte Guild
     * @param {object} message - Veza-Nachrichtenobjekt
     * @param {object} payload - Enthält die Guild-ID
     * @returns {Promise<void>}
     * @private
     */
    async #handleGetGuildStats(message, payload) {
        try {
            if (!payload?.guildId) {
                return message.reply({
                    success: false,
                    error: "Guild-ID ist erforderlich"
                });
            }
            
            const guild = this.discordClient.guilds.cache.get(payload.guildId);
            if (!guild) {
                return message.reply({
                    success: false,
                    error: "Guild nicht gefunden"
                });
            }
            
            // Kanäle nach Typ zählen
            const channels = {
                text: 0,
                voice: 0,
                category: 0,
                other: 0
            };
            
            guild.channels.cache.forEach(channel => {
                if (channel.type === ChannelType.GuildText) channels.text++;
                else if (channel.type === ChannelType.GuildVoice) channels.voice++;
                else if (channel.type === ChannelType.GuildCategory) channels.category++;
                else channels.other++;
            });
            
            // Plugins zählen - KORRIGIERT
            const pluginManager = this.discordClient.pluginManager;
            let enabledPlugins = [];
            
            // Korrekte Methode zum Ermitteln der aktivierten Plugins für eine Guild
            if (pluginManager) {
                try {
                    // Über Core-Plugin die Guild-Einstellungen abrufen
                    const corePlugin = pluginManager.getPlugin("core");
                    if (corePlugin && corePlugin.dbService) {
                        const settings = await corePlugin.dbService.getConfigs(guild.id);
                        
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
                                this.logger.warn(`[IPC] Fehler beim Parsen der aktivierten Plugins für Guild ${guild.id}:`, e);
                                enabledPlugins = ['core']; // Fallback
                            }
                        }
                    }
                } catch (error) {
                    this.logger.error(`[IPC] Fehler beim Ermitteln der aktivierten Plugins für Guild ${guild.id}:`, error);
                }
            }
            
            const stats = {
                name: guild.name,
                id: guild.id,
                icon: guild.iconURL({ dynamic: true }),
                memberCount: guild.memberCount,
                owner: guild.ownerId,
                channels,
                roles: guild.roles.cache.size,
                plugins: {
                    enabled: enabledPlugins.length,
                    total: pluginManager?.plugins?.length || 0
                },
                createdAt: guild.createdAt,
                joinedAt: guild.joinedAt
            };
            
            return message.reply({
                success: true,
                data: stats
            });
        } catch (error) {
            this.logger.error("[IPC] Fehler beim Abrufen der Guild-Statistiken:", error);
            return message.reply({
                success: false,
                error: error.message
            });
        }
    }
    
    /**
     * Überprüft, ob der Bot auf einer bestimmten Guild ist
     * @param {object} message - Veza-Nachrichtenobjekt
     * @param {object} payload - Enthält die Guild-ID
     * @returns {Promise<void>}
     * @private
     */
    async #handleValidateGuild(message, payload) {
        try {
            if (!payload?.guildId) {
                return message.reply({
                    success: false,
                    error: "Guild-ID ist erforderlich"
                });
            }
            
            const guild = this.discordClient.guilds.cache.get(payload.guildId);
            const isValid = Boolean(guild);
            
            return message.reply({
                success: true,
                data: {
                    valid: isValid,
                    guild: isValid ? {
                        id: guild.id,
                        name: guild.name,
                        icon: guild.iconURL({ dynamic: true })
                    } : null
                }
            });
        } catch (error) {
            this.logger.error("[IPC] Fehler bei der Guild-Validierung:", error);
            return message.reply({
                success: false,
                error: error.message
            });
        }
    }
    
    /**
     * Liefert alle Guilds, auf denen der Bot ist
     * @param {object} message - Veza-Nachrichtenobjekt
     * @returns {Promise<void>}
     * @private
     */
    async #handleGetBotGuilds(message) {
        try {
            const guilds = this.discordClient.guilds.cache.map(guild => ({
                id: guild.id,
                name: guild.name,
                icon: guild.iconURL({ dynamic: true }),
                memberCount: guild.memberCount
            }));
            
            return message.reply({
                success: true,
                data: guilds
            });
        } catch (error) {
            this.logger.error("[IPC] Fehler beim Abrufen der Bot-Guilds:", error);
            return message.reply({
                success: false,
                error: error.message
            });
        }
    }
    
    /**
     * Sendet eine mehrsprachige Notification an Discord
     * @param {object} message - Veza-Nachrichtenobjekt
     * @param {object} payload - Notification-Daten
     * @returns {Promise<void>}
     * @private
     */
    async #handleSendNotification(message, payload) {
        try {
            const { ServiceManager } = require('dunebot-core');
            const { EmbedBuilder } = require('discord.js');
            const dbService = ServiceManager.get('dbService');
            
            this.logger.debug('[IPC] sendNotification aufgerufen mit Payload:', payload);
            
            const {
                id,
                title_translations,
                message_translations,
                action_text_translations,
                type,
                action_url,
                delivery_method,
                target_guild_ids,
                discord_channel_id
            } = payload;
            
            // Parse JSON-Felder
            const titleTranslations = typeof title_translations === 'string' 
                ? JSON.parse(title_translations) 
                : title_translations;
            const messageTranslations = typeof message_translations === 'string' 
                ? JSON.parse(message_translations) 
                : message_translations;
            const actionTextTranslations = typeof action_text_translations === 'string' 
                ? JSON.parse(action_text_translations) 
                : action_text_translations;
            const targetGuildIds = typeof target_guild_ids === 'string' 
                ? JSON.parse(target_guild_ids) 
                : (target_guild_ids || []);
            
            // Tracking für gesendete Messages
            const sentMessageIds = {};
            
            // Embed-Farben je nach Type
            const embedColors = {
                info: 0x3498db,     // Blau
                warning: 0xf39c12,  // Orange
                error: 0xe74c3c,    // Rot
                success: 0x2ecc71   // Grün
            };
            
            // Über alle Ziel-Guilds iterieren
            for (const guildId of targetGuildIds) {
                const guild = this.discordClient.guilds.cache.get(guildId);
                if (!guild) {
                    this.logger.warn(`[IPC] Guild ${guildId} nicht im Cache, überspringe`);
                    continue;
                }
                
                // Guild-Locale aus Datenbank laden
                const [guildLocaleRow] = await dbService.query(
                    "SELECT config_value FROM configs WHERE plugin_name = 'core' AND config_key = 'LOCALE' AND guild_id = ? AND context = 'shared'",
                    [guildId]
                );
                
                const guildLocale = guildLocaleRow?.config_value || 'de-DE';
                this.logger.debug(`[IPC] Guild ${guild.name} hat Locale: ${guildLocale}`);
                
                // Wähle richtige Übersetzung basierend auf Guild-Locale
                const title = titleTranslations[guildLocale] || titleTranslations['de-DE'] || 'Notification';
                const messageText = messageTranslations[guildLocale] || messageTranslations['de-DE'] || '';
                const actionText = actionTextTranslations[guildLocale] || actionTextTranslations['de-DE'] || 'Mehr erfahren';
                
                // Embed erstellen
                const embed = new EmbedBuilder()
                    .setTitle(title)
                    .setDescription(messageText)
                    .setColor(embedColors[type] || embedColors.info)
                    .setTimestamp()
                    .setFooter({ text: `Notification #${id}` });
                
                // Action URL hinzufügen (falls vorhanden)
                if (action_url) {
                    embed.addFields({
                        name: actionText,
                        value: `[🔗 ${action_url}](${action_url})`,
                        inline: false
                    });
                }
                
                // Je nach Delivery-Methode senden
                if (delivery_method === 'discord_channel' || delivery_method === 'all') {
                    // An Channel senden
                    let targetChannel;
                    
                    // Wenn custom channel_id, nutze diesen
                    if (discord_channel_id) {
                        targetChannel = guild.channels.cache.get(discord_channel_id);
                    } else {
                        // Sonst System-Channel
                        targetChannel = guild.systemChannel;
                    }
                    
                    if (targetChannel && targetChannel.isTextBased()) {
                        try {
                            const sentMessage = await targetChannel.send({ embeds: [embed] });
                            sentMessageIds[guildId] = sentMessageIds[guildId] || {};
                            sentMessageIds[guildId].channel = sentMessage.id;
                            this.logger.debug(`[IPC] Notification an Channel ${targetChannel.name} in ${guild.name} gesendet`);
                        } catch (channelError) {
                            this.logger.error(`[IPC] Fehler beim Senden an Channel in ${guild.name}:`, channelError);
                        }
                    } else {
                        this.logger.warn(`[IPC] Kein gültiger Channel für Guild ${guild.name} gefunden`);
                    }
                }
                
                if (delivery_method === 'discord_dm' || delivery_method === 'all') {
                    // An alle Admins per DM senden
                    try {
                        // Hole alle Members mit ManageGuild-Permission
                        const members = await guild.members.fetch();
                        const admins = members.filter(member => 
                            member.permissions.has('ManageGuild') && !member.user.bot
                        );
                        
                        this.logger.debug(`[IPC] Sende DMs an ${admins.size} Admins in ${guild.name}`);
                        
                        const dmIds = [];
                        for (const [memberId, member] of admins) {
                            try {
                                const dmChannel = await member.createDM();
                                const sentDM = await dmChannel.send({ embeds: [embed] });
                                dmIds.push(sentDM.id);
                                this.logger.debug(`[IPC] DM an ${member.user.tag} gesendet`);
                            } catch (dmError) {
                                this.logger.warn(`[IPC] Konnte keine DM an ${member.user.tag} senden:`, dmError.message);
                            }
                        }
                        
                        if (dmIds.length > 0) {
                            sentMessageIds[guildId] = sentMessageIds[guildId] || {};
                            sentMessageIds[guildId].dms = dmIds;
                        }
                    } catch (membersError) {
                        this.logger.error(`[IPC] Fehler beim Abrufen der Members in ${guild.name}:`, membersError);
                    }
                }
            }
            
            // Tracking in Datenbank speichern
            if (Object.keys(sentMessageIds).length > 0) {
                await dbService.query(`
                    UPDATE notifications 
                    SET sent_to_discord = 1,
                        discord_message_ids = ?
                    WHERE id = ?
                `, [JSON.stringify(sentMessageIds), id]);
                
                this.logger.info(`[IPC] Notification #${id} erfolgreich an ${Object.keys(sentMessageIds).length} Guilds gesendet`);
            }
            
            return message.reply({
                success: true,
                data: {
                    sentToGuilds: Object.keys(sentMessageIds).length,
                    messageIds: sentMessageIds
                }
            });
            
        } catch (error) {
            this.logger.error('[IPC] Fehler in sendNotification:', error);
            return message.reply({
                success: false,
                error: error.message
            });
        }
    }
    
    /**
     * Liefert eine Zusammenfassung der verfügbaren Befehle
     * @param {object} message - Veza-Nachrichtenobjekt
     * @param {object} payload - Enthält optionale Filter
     * @returns {Promise<void>}
     * @private
     */
    async #handleGetCommandsSummary(message, payload) {
        try {
            const guildId = payload?.guildId;
            const pluginManager = this.discordClient.pluginManager;
            
            if (!pluginManager) {
                return message.reply({
                    success: false,
                    error: "PluginManager nicht verfügbar"
                });
            }
            
            const plugins = pluginManager.getPlugins();
            const commandSummary = [];
            
            for (const plugin of plugins) {
                // Prüfen, ob das Plugin für die Guild aktiviert ist
                if (guildId && !pluginManager.isPluginEnabledForGuild(plugin.id, guildId)) {
                    continue;
                }
                
                const pluginCommands = {
                    pluginId: plugin.id,
                    pluginName: plugin.name,
                    slashCommands: plugin.slashCommands?.size || 0,
                    prefixCommands: plugin.prefixCommands?.size || 0
                };
                
                if (pluginCommands.slashCommands > 0 || pluginCommands.prefixCommands > 0) {
                    commandSummary.push(pluginCommands);
                }
            }
            
            return message.reply({
                success: true,
                data: commandSummary
            });
        } catch (error) {
            this.logger.error("[IPC] Fehler beim Abrufen der Befehls-Zusammenfassung:", error);
            return message.reply({
                success: false,
                error: error.message
            });
        }
    }
    
    /**
     * Liefert detaillierte Informationen zu den Befehlen eines Plugins
     * @param {object} message - Veza-Nachrichtenobjekt
     * @param {object} payload - Enthält Plugin-ID und Befehlstyp
     * @returns {Promise<void>}
     * @private
     */
    async #handleGetPluginCommands(message, payload) {
        try {
            const { pluginId, type, guildId } = payload || {};
            
            if (!pluginId) {
                return message.reply({
                    success: false,
                    error: "Plugin-ID ist erforderlich"
                });
            }
            
            const plugin = this.discordClient.pluginManager.getPlugin(pluginId);
            if (!plugin) {
                return message.reply({
                    success: false,
                    error: "Plugin nicht gefunden"
                });
            }
            
            // Prüfen, ob das Plugin für die Guild aktiviert ist
            if (guildId && !this.discordClient.pluginManager.isPluginEnabledForGuild(pluginId, guildId)) {
                return message.reply({
                    success: false,
                    error: "Plugin ist für diese Guild nicht aktiviert"
                });
            }
            
            let commands = [];
            
            if (type === 'slash' || !type) {
                // Slash-Befehle
                if (plugin.slashCommands) {
                    commands = [...commands, ...Array.from(plugin.slashCommands.values()).map(cmd => ({
                        name: cmd.data.name,
                        description: cmd.data.description,
                        type: 'slash',
                        options: cmd.data.options,
                        defaultPermission: cmd.data.default_permission
                    }))];
                }
            }
            
            if (type === 'prefix' || !type) {
                // Prefix-Befehle
                if (plugin.prefixCommands) {
                    commands = [...commands, ...Array.from(plugin.prefixCommands.values()).map(cmd => ({
                        name: cmd.name,
                        description: cmd.description || 'Keine Beschreibung',
                        type: 'prefix',
                        aliases: cmd.aliases || [],
                        usage: cmd.usage || null
                    }))];
                }
            }
            
            return message.reply({
                success: true,
                data: {
                    pluginId,
                    pluginName: plugin.name,
                    commands
                }
            });
        } catch (error) {
            this.logger.error("[IPC] Fehler beim Abrufen der Plugin-Befehle:", error);
            return message.reply({
                success: false,
                error: error.message
            });
        }
    }
    
    /**
     * Liefert erweiterte Statistiken für eine bestimmte Guild
     * @param {object} message - Veza-Nachrichtenobjekt
     * @param {object} payload - Enthält die Guild-ID
     * @returns {Promise<void>}
     * @private
     */
    async #handleGetGuildExtendedStats(message, payload) {
        try {
            if (!payload?.guildId) {
                return message.reply({
                    success: false,
                    error: "Guild-ID ist erforderlich"
                });
            }
            
            const guild = this.discordClient.guilds.cache.get(payload.guildId);
            if (!guild) {
                return message.reply({
                    success: false,
                    error: "Guild nicht gefunden"
                });
            }
            
            // Performance-Metriken - KORRIGIERT
            // Statt guild.shard.ping() verwenden wir den Websocket-Ping des Clients
            const pingStartTime = Date.now();
            // Wir verwenden den Discord Client Websocket Ping statt dem Guild Shard Ping
            const pingTime = this.discordClient.ws.ping;
            
            // Aktivitäts-Analyse
            const last24h = new Date();
            last24h.setHours(last24h.getHours() - 24);
            
            // Cache-Hit-Analyse
            const cacheStats = {
                members: {
                    cached: guild.members.cache.size,
                    total: guild.memberCount,
                    ratio: guild.members.cache.size / guild.memberCount
                },
                channels: guild.channels.cache.size,
                roles: guild.roles.cache.size,
                emojis: guild.emojis.cache.size
            };
            
            // Erweiterte Stats für Channels, Rollen und Benutzer
            let channelsDetail = {};
            guild.channels.cache.forEach(channel => {
                channelsDetail[channel.id] = {
                    name: channel.name,
                    type: channel.type,
                    parentId: channel.parentId,
                    position: channel.position,
                    // Für Textkanäle spezifische Daten
                    ...(channel.type === ChannelType.GuildText && {
                        nsfw: channel.nsfw,
                        rateLimitPerUser: channel.rateLimitPerUser,
                        lastMessageId: channel.lastMessageId
                    }),
                    // Für Sprachkanäle spezifische Daten
                    ...(channel.type === ChannelType.GuildVoice && {
                        bitrate: channel.bitrate,
                        userLimit: channel.userLimit,
                        full: channel.full,
                        joinable: channel.joinable,
                        memberCount: channel.members?.size || 0
                    })
                };
            });
            
           // Rollen-Details mit Berechtigungen
            let rolesDetail = {};
            guild.roles.cache.forEach(role => {
                rolesDetail[role.id] = {
                    name: role.name,
                    color: role.hexColor,
                    position: role.position,
                    hoist: role.hoist,
                    mentionable: role.mentionable,
                    managed: role.managed,
                    memberCount: role.members?.size || 0,
                    permissions: role.permissions.toArray()
                };
            });
            
            // Bot-spezifische Statistiken
            const botMember = await guild.members.fetch(this.discordClient.user.id).catch(() => null);
            const botStats = botMember ? {
                nickname: botMember.nickname,
                joinedAt: botMember.joinedAt,
                permissions: botMember.permissions.toArray(),
                highestRole: botMember.roles.highest?.name || 'None',
                highestRoleColor: botMember.roles.highest?.hexColor || '#000000',
                canSendMessages: botMember.permissionsIn(guild.systemChannel || guild.channels.cache.first())?.has('SendMessages') || false,
                canManageServer: botMember.permissions.has('ManageGuild'),
                canManageRoles: botMember.permissions.has('ManageRoles')
            } : null;
            
            // Shard-Informationen korrekt abrufen
            const shardId = guild.shardId;
            const shardInfo = {
                id: shardId,
                status: this.discordClient.ws.status,
                ping: pingTime
            };
            
            const extendedStats = {
                performance: {
                    pingTime,
                    responseTime: this.discordClient.ws.ping,
                    shardHealth: this.discordClient.ws.status,
                    uptime: this.discordClient.uptime
                },
                cacheStats,
                channelsDetail,
                rolesDetail,
                botStats,
                shardInfo,
                guild: {
                    id: guild.id,
                    name: guild.name,
                    icon: guild.iconURL({ dynamic: true }),
                    banner: guild.bannerURL({ dynamic: true }),
                    splash: guild.splashURL(),
                    description: guild.description,
                    verificationLevel: guild.verificationLevel,
                    premiumTier: guild.premiumTier,
                    premiumSubscriptionCount: guild.premiumSubscriptionCount,
                    preferredLocale: guild.preferredLocale,
                    partnered: guild.partnered,
                    verified: guild.verified,
                    createdAt: guild.createdAt
                }
            };
            
            return message.reply({
                success: true,
                data: extendedStats
            });
        } catch (error) {
            this.logger.error("[IPC] Fehler beim Abrufen der erweiterten Guild-Statistiken:", error);
            return message.reply({
                success: false,
                error: error.message
            });
        }
    }


    /**
     * Liefert ein Lokalisierungs-Bundle
     * @param {object} message - Veza-Nachrichtenobjekt
     * @param {object} payload - Enthält Sprach-Code und Plugin-ID
     * @returns {Promise<void>}
     * @private
     */
    async #handleGetLocaleBundle(message, payload) {
        try {
            const { locale, pluginId } = payload || {};
            
            if (!locale) {
                return message.reply({
                    success: false,
                    error: "Sprach-Code ist erforderlich"
                });
            }
            
            // Prüfen, ob die angeforderte Sprache unterstützt wird
            if (!languagesMeta[locale]) {
                return message.reply({
                    success: false,
                    error: `Sprache '${locale}' wird nicht unterstützt`
                });
            }
            
            let bundle = {};
            
            if (pluginId) {
                // Lokalisierung eines bestimmten Plugins
                const plugin = this.discordClient.pluginManager.getPlugin(pluginId);
                if (!plugin) {
                    return message.reply({
                        success: false,
                        error: "Plugin nicht gefunden"
                    });
                }
                
                // Lokalisierungsdaten des Plugins abrufen
                bundle = plugin.getLocaleBundle ? await plugin.getLocaleBundle(locale) : {};
            } else {
                // Globale Lokalisierung (alle Plugins)
                const plugins = this.discordClient.pluginManager.getPlugins();
                for (const plugin of plugins) {
                    if (plugin.getLocaleBundle) {
                        const pluginBundle = await plugin.getLocaleBundle(locale);
                        bundle[plugin.id] = pluginBundle;
                    }
                }
            }
            
            return message.reply({
                success: true,
                data: {
                    locale,
                    bundle
                }
            });
        } catch (error) {
            this.logger.error("[IPC] Fehler beim Abrufen des Lokalisierungs-Bundles:", error);
            return message.reply({
                success: false,
                error: error.message
            });
        }
    }
    
    /**
     * Setzt ein Lokalisierungs-Bundle
     * @param {object} message - Veza-Nachrichtenobjekt
     * @param {object} payload - Enthält Sprach-Code, Plugin-ID und Bundle-Daten
     * @returns {Promise<void>}
     * @private
     */
    async #handleSetLocaleBundle(message, payload) {
        try {
            const { locale, pluginId, bundle } = payload || {};
            
            if (!locale || !pluginId || !bundle) {
                return message.reply({
                    success: false,
                    error: "Sprach-Code, Plugin-ID und Bundle-Daten sind erforderlich"
                });
            }
            
            // Prüfen, ob die angeforderte Sprache unterstützt wird
            if (!languagesMeta[locale]) {
                return message.reply({
                    success: false,
                    error: `Sprache '${locale}' wird nicht unterstützt`
                });
            }
            
            // Plugin abrufen
            const plugin = this.discordClient.pluginManager.getPlugin(pluginId);
            if (!plugin) {
                return message.reply({
                    success: false,
                    error: "Plugin nicht gefunden"
                });
            }
            
            // Lokalisierungsdaten setzen
            if (plugin.setLocaleBundle) {
                await plugin.setLocaleBundle(locale, bundle);
                
                return message.reply({
                    success: true,
                    message: `Lokalisierungs-Bundle für '${locale}' erfolgreich gesetzt`
                });
            } else {
                return message.reply({
                    success: false,
                    error: "Plugin unterstützt keine setLocaleBundle-Methode"
                });
            }
        } catch (error) {
            this.logger.error("[IPC] Fehler beim Setzen des Lokalisierungs-Bundles:", error);
            return message.reply({
                success: false,
                error: error.message
            });
        }
    }
    
    /**
     * Führt Plugin-Aktionen aus (aktivieren, deaktivieren, installieren, deinstallieren)
     * @param {object} message - Veza-Nachrichtenobjekt
     * @param {object} payload - Enthält Aktion, Plugin-ID und ggf. Guild-ID
     * @returns {Promise<void>}
     * @private
     */
    /*
    async #handleUpdatePlugin(message, payload) {
        try {
            const { action, pluginId, guildId } = payload || {};
            console.log(payload);

            if (!action || !pluginId) {
                return message.reply({
                    success: false,
                    error: "Aktion und Plugin-ID sind erforderlich"
                });
            }
            
            const pluginManager = this.discordClient.pluginManager;
            if (!pluginManager) {
                return message.reply({
                    success: false,
                    error: "PluginManager nicht verfügbar"
                });
            }
            
            let result = false;
            let errorMessage = null;
            
            switch (action) {
                case 'enable':
                    result = await pluginManager.enablePlugin(pluginId);
                    // NEU: Plugin auch für die Guild aktivieren, wenn guildId vorhanden
                    if (guildId) {
                        const guildResult = await pluginManager.enablePluginForGuild(pluginId, guildId);
                        result = result && guildResult;
                    }
                    break;
                    
                case 'disable':
                    result = await pluginManager.disablePlugin(pluginId);
                    // NEU: Plugin auch für die Guild deaktivieren, wenn guildId vorhanden
                    if (guildId) {
                        const guildResult = await pluginManager.disablePluginForGuild(pluginId, guildId);
                        result = result && guildResult;
                    }
                    break;
                    
                case 'install':
                    result = await pluginManager.installPlugin(pluginId);
                    break;
                    
                case 'uninstall':
                    result = await pluginManager.uninstallPlugin(pluginId);
                    break;
                    
                case 'guildEnable':
                    if (!guildId) {
                        errorMessage = "Guild-ID ist für guildEnable erforderlich";
                        break;
                    }
                    result = await pluginManager.enablePluginForGuild(pluginId, guildId);
                    break;
                    
                case 'guildDisable':
                    if (!guildId) {
                        errorMessage = "Guild-ID ist für guildDisable erforderlich";
                        break;
                    }
                    result = await pluginManager.disablePluginForGuild(pluginId, guildId);
                    break;
                    
                default:
                    errorMessage = `Unbekannte Aktion: ${action}`;
            }
            
            if (errorMessage) {
                return message.reply({
                    success: false,
                    error: errorMessage
                });
            }
            
            return message.reply({
                success: result,
                message: result 
                    ? `Plugin-Aktion '${action}' für '${pluginId}' erfolgreich ausgeführt` 
                    : `Plugin-Aktion '${action}' für '${pluginId}' fehlgeschlagen`
            });
        } catch (error) {
            Logger.error(`[IPC] Fehler bei Plugin-Aktion:`, error);
            return message.reply({
                success: false,
                error: error.message
            });
        }
    }
    */
    
    async #handleUpdatePlugin(message, payload) {
        console.log("[IPC] handle Update Plugin with payload:", JSON.stringify(payload, null, 2));
        try {
            let { action, pluginId, guildId, plugins } = payload || {};
            
            // Kompatibilität: plugins-Array zu pluginId konvertieren
            if (!pluginId && plugins && Array.isArray(plugins) && plugins.length > 0) {
                pluginId = plugins[0]; // Nimm das erste Plugin aus dem Array
                this.logger.warn(`[IPC] 'plugins' Array erkannt, verwende erstes Plugin: ${pluginId}`);
            }
            
            const pluginName = pluginId; // Alias für Kompatibilität

            if (!action || !pluginName) {
                this.logger.error(`[IPC] Fehlende Parameter: action=${action}, pluginName=${pluginName}`);
                return message.reply({
                    success: false,
                    error: "Aktion und Plugin-ID sind erforderlich"
                });
            }
            
            const pluginManager = this.discordClient.pluginManager;
            if (!pluginManager) {
                return message.reply({
                    success: false,
                    error: "PluginManager nicht verfügbar"
                });
            }
            
            let result = false;
            let errorMessage = null;
            
            // Action-Mapping: 'enable' mit guildId → 'guildEnable'
            if (action === 'enable' && guildId) {
                this.logger.info(`[IPC] Konvertiere 'enable' → 'guildEnable' für Guild ${guildId}`);
                action = 'guildEnable';
            }
            if (action === 'disable' && guildId) {
                this.logger.info(`[IPC] Konvertiere 'disable' → 'guildDisable' für Guild ${guildId}`);
                action = 'guildDisable';
            }
            
            this.logger.info(`[IPC] Führe Plugin-Aktion aus: ${action} für Plugin '${pluginName}'${guildId ? ` in Guild ${guildId}` : ''}`);
            
            switch (action) {
                case "enable":
                    result = await pluginManager.enablePlugin(pluginName);
                    this.logger.info(`[IPC] Plugin ${pluginName} global aktiviert: ${result}`);
                    break;

                case "disable":
                    result = await pluginManager.disablePlugin(pluginName);
                    this.logger.info(`[IPC] Plugin ${pluginName} global deaktiviert: ${result}`);
                    break;

                case "install":
                    result = await pluginManager.installPlugin(pluginName);
                    this.logger.info(`[IPC] Plugin ${pluginName} installiert: ${result}`);
                    break;

                case "uninstall":
                    result = await pluginManager.uninstallPlugin(pluginName);
                    this.logger.info(`[IPC] Plugin ${pluginName} deinstalliert: ${result}`);
                    break;

                case "guildEnable": {
                    if (!guildId) {
                        errorMessage = "Guild-ID ist für guildEnable erforderlich";
                        break;
                    }
                    const guild = this.discordClient.guilds.cache.get(guildId);
                    if (!guild) {
                        errorMessage = `Guild ${guildId} nicht gefunden`;
                        this.logger.error(`[IPC] Guild ${guildId} nicht im Cache gefunden`);
                        break;
                    }
                    this.logger.info(`[IPC] Aktiviere Plugin ${pluginName} für Guild ${guild.name} (${guildId})`);
                    result = await pluginManager.enableInGuild(pluginName, guildId);
                    this.logger.success(`[IPC] Plugin ${pluginName} für Guild ${guildId} aktiviert: ${result}`);
                    break;
                }

                case "guildDisable": {
                    if (!guildId) {
                        errorMessage = "Guild-ID ist für guildDisable erforderlich";
                        break;
                    }
                    const guild = this.discordClient.guilds.cache.get(guildId);
                    if (!guild) {
                        errorMessage = `Guild ${guildId} nicht gefunden`;
                        this.logger.error(`[IPC] Guild ${guildId} nicht im Cache gefunden`);
                        break;
                    }
                    this.logger.info(`[IPC] Deaktiviere Plugin ${pluginName} für Guild ${guild.name} (${guildId})`);
                    result = await pluginManager.disableInGuild(pluginName, guildId);
                    this.logger.success(`[IPC] Plugin ${pluginName} für Guild ${guildId} deaktiviert: ${result}`);
                    break;
                }
                
                default:
                    errorMessage = `Unbekannte Aktion: ${action}`;
                    this.logger.error(`[IPC] ${errorMessage}`);
                    break;
            }
            
            if (errorMessage) {
                return message.reply({
                    success: false,
                    error: errorMessage
                });
            }
            
            return message.reply({
                success: result,
                message: result 
                    ? `Plugin-Aktion '${action}' für '${pluginName}' erfolgreich ausgeführt` 
                    : `Plugin-Aktion '${action}' für '${pluginName}' fehlgeschlagen`
            });
        } catch (error) {
            this.logger.error(`[IPC] Fehler bei Plugin-Aktion:`, error);
            return message.reply({
                success: false,
                error: error.message
            });
        }
    }

    /**
     * Handler für Plugin-Reload ohne Deaktivierung (guild-spezifisch)
     * Leert den require-Cache und lädt das Bot-Modul neu
     * 
     * @param {Object} message - Veza-Message-Objekt
     * @param {Object} payload - { pluginName, guildId }
     * @returns {Promise<void>}
     * @private
     */
    async #handleReloadPlugin(message, payload) {
        const path = require('path');
        
        try {
            const { pluginName, guildId } = payload || {};
            
            this.logger.info(`[IPC] Plugin-Reload angefordert: ${pluginName} für Guild ${guildId}`);
            
            // Validierung
            if (!pluginName) {
                return message.reply({
                    success: false,
                    error: 'Plugin-Name fehlt'
                });
            }
            
            if (!guildId) {
                return message.reply({
                    success: false,
                    error: 'Guild-ID fehlt'
                });
            }
            
            // Core-Plugin Schutz
            if (pluginName === 'core') {
                return message.reply({
                    success: false,
                    error: 'Core-Plugin kann nicht neu geladen werden (Sicherheitsgrund)'
                });
            }
            
            // Prüfen ob Plugin für diese Guild aktiviert ist
            const pluginManager = this.discordClient.pluginManager;
            if (!pluginManager) {
                return message.reply({
                    success: false,
                    error: 'PluginManager nicht verfügbar'
                });
            }
            
            const plugin = pluginManager.getPlugin(pluginName);
            if (!plugin) {
                return message.reply({
                    success: false,
                    error: `Plugin "${pluginName}" nicht gefunden oder nicht geladen`
                });
            }
            
            // Plugin-Pfad ermitteln
            const pluginsDir = path.join(__dirname, '../../..', 'plugins');
            const pluginPath = path.join(pluginsDir, pluginName);
            
            // Require-Cache für das gesamte Plugin leeren
            const cacheKeys = Object.keys(require.cache).filter(key => 
                key.startsWith(pluginPath) && !key.includes('node_modules')
            );
            
            this.logger.debug(`[IPC] Lösche ${cacheKeys.length} Bot-Cache-Einträge für ${pluginName}`);
            
            cacheKeys.forEach(key => {
                try {
                    delete require.cache[key];
                } catch (err) {
                    this.logger.warn(`[IPC] Cache-Eintrag konnte nicht gelöscht werden: ${key}`, err.message);
                }
            });
            
            // Bot-Modul neu laden (ohne onGuildDisable/onGuildEnable zu triggern)
            const botModulePath = path.join(pluginPath, 'bot', 'index.js');
            const fs = require('fs');
            
            if (!fs.existsSync(botModulePath)) {
                this.logger.debug(`[IPC] Plugin ${pluginName} hat kein Bot-Modul (nur Dashboard)`);
                return message.reply({
                    success: true,
                    message: `Plugin ${pluginName} hat kein Bot-Modul - nur Dashboard-Cache geleert`,
                    cacheCleared: cacheKeys.length
                });
            }
            
            try {
                // Modul neu laden
                const freshModule = require(botModulePath);
                this.logger.success(`[IPC] Bot-Modul für ${pluginName} erfolgreich neu geladen (${cacheKeys.length} Cache-Einträge geleert)`);
                
                return message.reply({
                    success: true,
                    message: `Plugin ${pluginName} für Guild ${guildId} erfolgreich neu geladen`,
                    cacheCleared: cacheKeys.length
                });
                
            } catch (loadErr) {
                this.logger.error(`[IPC] Fehler beim Neu-Laden des Bot-Moduls für ${pluginName}:`, loadErr);
                return message.reply({
                    success: false,
                    error: `Bot-Modul konnte nicht geladen werden: ${loadErr.message}`,
                    cacheCleared: cacheKeys.length
                });
            }
            
        } catch (error) {
            this.logger.error(`[IPC] Kritischer Fehler beim Plugin-Reload:`, error);
            return message.reply({
                success: false,
                error: error.message
            });
        }
    }
  
}

module.exports = IPCClient;