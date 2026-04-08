const { ServiceManager } = require('dunebot-core');
const { getNextStormTiming } = require('../../dashboard/assets/js/coriolisStormConfig');
const {
    ActionRowBuilder,
    StringSelectMenuBuilder,
    Message,
    ButtonBuilder,
    CommandInteraction,
    ApplicationCommandOptionType,
    ButtonStyle,
    ComponentType,
} = require("discord.js");

module.exports = {
    name: 'map',
    description: 'dunemap:MAP.DESCRIPTION',
    
    command: {
        enabled: true,
        aliases: ['dmap'],
        usage: '<show|set|remove> [coords] [type]'
    },

    slashCommand: {
        enabled: true,
        ephemeral: true,
        options: [
            {
                name: 'show',
                description: 'dunemap:MAP.SHOW_DESCRIPTION',
                type: ApplicationCommandOptionType.Subcommand
            },
            {
                name: 'set',
                description: 'dunemap:MAP.SET_DESCRIPTION',
                type: ApplicationCommandOptionType.Subcommand,
                options: [
                    {
                        name: 'coord',
                        description: 'dunemap:MAP.COORD_DESCRIPTION',
                        type: ApplicationCommandOptionType.String,
                        required: true
                    },
                    {
                        name: 'type',
                        description: 'dunemap:MAP.TYPE_DESCRIPTION',
                        type: ApplicationCommandOptionType.String,
                        required: true,
                        choices: [
                            { name: 'Titan', value: 'titan' },
                            { name: 'Spice', value: 'spice' },
                            { name: 'Stravidium', value: 'stravidium' },
                            { name: 'Basis', value: 'base' },
                            { name: 'Wrack', value: 'wrack' },
                            { name: 'Aluminium', value: 'aluminium' },
                            { name: 'Basalt', value: 'basalt' },
                            { name: 'Eisen', value: 'eisen' },
                            { name: 'Karbon', value: 'karbon' },
                            { name: 'Höhle', value: 'hoele' },
                            { name: 'Loch', value: 'hole' },
                            { name: 'Kontrollpunkt', value: 'kontrollpunkt' },
                            { name: 'Taxi', value: 'taxi' },
                            { name: 'Test', value: 'test' }
                        ]
                    }
                ]
            },
            {
                name: 'remove',
                description: 'dunemap:MAP.REMOVE_DESCRIPTION',
                type: ApplicationCommandOptionType.Subcommand,
                options: [
                    {
                        name: 'coord',
                        description: 'dunemap:MAP.COORD_DESCRIPTION',
                        type: ApplicationCommandOptionType.String,
                        required: true
                    }
                ]
            }
        ]
    },

    // Utility Funktionen
    validateCoords(coord) {
        return /^[A-I][1-9]$/i.test(coord);
    },

    /**
     * Prüft ob ein Map-Channel konfiguriert ist
     * @param {Object} context - Command Context mit interaction, guild
     * @returns {Promise<Channel|null>} Channel-Objekt oder null
     */
    async checkMapChannel(context) {
        const interaction = context.interaction;
        const guild = interaction.guild;
        const getT = guild.getT.bind(guild);
        const dbService = ServiceManager.get('dbService');
        const Logger = ServiceManager.get('Logger');

        Logger.debug(`[DuneMap] Prüfe MAP_CHANNEL_ID für Guild ${guild.id}`);

        const channelId = await dbService.getConfig('dunemap', 'MAP_CHANNEL_ID', 'shared', guild.id);

        if (!channelId) {
            Logger.warn(`[DuneMap] Kein Map-Channel konfiguriert für Guild ${guild.id}`);
            await interaction.editReply({
                content: `❌ ${getT('dunemap:MAP.NO_CHANNEL')}`,
                ephemeral: true
            });
            return null;
        }

        const channel = await guild.channels.fetch(channelId).catch(() => null);
        
        if (!channel) {
            Logger.error(`[DuneMap] Channel ${channelId} nicht gefunden in Guild ${guild.id}`);
            await interaction.editReply({
                content: `❌ ${getT('dunemap:MAP.CHANNEL_NOT_FOUND')}`,
                ephemeral: true
            });
            return null;
        }

        return channel;
    },

    async getMapChannel(guildId, client) {
        const dbService = ServiceManager.get('dbService');
        const Logger = ServiceManager.get('Logger');
        
        Logger.debug(`[DuneMap] Suche MAP_CHANNEL_ID für Guild ${guildId}`);
        
        // Context ist 'shared', nicht 'guild'!
        const channelId = await dbService.getConfig('dunemap', 'MAP_CHANNEL_ID', 'shared', guildId);
        
        Logger.debug(`[DuneMap] Gefundene Channel-ID: ${channelId}`);
        
        if (!channelId) {
            Logger.warn(`[DuneMap] Keine MAP_CHANNEL_ID in DB für Guild ${guildId}`);
            return null;
        }
        
        const channel = client.channels.cache.get(channelId);
        
        if (!channel) {
            Logger.warn(`[DuneMap] Channel ${channelId} nicht im Cache gefunden!`);
        } else {
            Logger.debug(`[DuneMap] Channel gefunden: #${channel.name} (${channel.id})`);
        }
        
        return channel;
    },

    async updateMap(channel) {
        const MapGenerator = require('../../dashboard/assets/js/MapGenerator');
        const mapGen = new MapGenerator();
        const dbService = ServiceManager.get('dbService');
        const Logger = ServiceManager.get('Logger');

        try {
            // Berechtigungen prüfen BEVOR wir die Karte generieren
            const permissions = channel.permissionsFor(channel.guild.members.me);
            if (!permissions) {
                throw new Error('❌ Kann Bot-Berechtigungen nicht abrufen. Bitte stelle sicher, dass der Bot Mitglied des Servers ist.');
            }
            
            if (!permissions.has('ViewChannel')) {
                throw new Error(`❌ Fehlende Berechtigung: Der Bot kann den Channel <#${channel.id}> nicht sehen. Bitte aktiviere die Berechtigung **"Kanal anzeigen"** für die Bot-Rolle.`);
            }
            
            if (!permissions.has('SendMessages')) {
                throw new Error(`❌ Fehlende Berechtigung: Der Bot kann keine Nachrichten in <#${channel.id}> senden. Bitte aktiviere die Berechtigung **"Nachrichten senden"** für die Bot-Rolle.`);
            }
            
            if (!permissions.has('AttachFiles')) {
                throw new Error(`❌ Fehlende Berechtigung: Der Bot kann keine Dateien in <#${channel.id}> anhängen. Bitte aktiviere die Berechtigung **"Dateien anhängen"** für die Bot-Rolle.`);
            }
            
            // Marker laden
            const markers = await dbService.query(
                'SELECT * FROM dunemap_markers WHERE guild_id = ?',
                [channel.guild.id]
            );

            // Karte generieren
            const mapBuffer = await mapGen.generateMap(markers);
            
            // Map senden
            await channel.send({
                content: '🌍 **FireBot Map Update**',
                files: [{ attachment: mapBuffer, name: 'map.png' }]
            });

            // NEUES SYSTEM: Automatischer Storm-Timer basierend auf Region
            const region = await dbService.getConfig('dunemap', 'COREOLIS_REGION', 'shared', channel.guild.id) || 'EU';
            const stormData = getNextStormTiming(region);
            
            // Timer-Text formatieren
            const timerText = `${stormData.daysUntil}d ${stormData.hoursUntil}h ${stormData.minutesUntil}m`;
            
            Logger.debug(`[DuneMap] Storm-Timer für Region ${region}: ${timerText}`);
            
            // Sturm-Timer generieren und senden
            const timerBuffer = await mapGen.generateStormTimer(timerText);
            await channel.send({
                files: [{ attachment: timerBuffer, name: 'storm-timer.png' }]
            });

            // Legende senden
            const legendBuffer = await mapGen.generateLegend();
            await channel.send({
                content: '**Legende:**',
                files: [{ attachment: legendBuffer, name: 'legend.png' }]
            });
        } catch (error) {
            // Bessere Fehlerbehandlung für Discord API Fehler
            if (error.code === 50001) {
                Logger.error(`[DuneMap] Missing Access in Channel ${channel.id} (${channel.name}) - Guild: ${channel.guild.name}`);
                throw new Error(`❌ **Fehlende Berechtigung**: Der Bot kann nicht in <#${channel.id}> schreiben.\n\n**Benötigte Berechtigungen:**\n✅ Kanal anzeigen\n✅ Nachrichten senden\n✅ Dateien anhängen\n\nBitte gib dem Bot diese Rechte im Channel oder wähle einen anderen Channel im Dashboard.`);
            }
            
            Logger.error('Fehler beim Map Update:', error);
            throw error;
        }
    },

    // Command Handler
    async messageRun({ message, args }) {
        const dbService = ServiceManager.get('dbService');
        const Logger = ServiceManager.get('Logger');
        
        const subCommand = args[0]?.toLowerCase();
        const mapChannel = await this.getMapChannel(message.guild.id, message.client);

        if (!mapChannel) {
            return message.replyT('dunemap:MAP.NO_CHANNEL');
        }

        try {
            switch(subCommand) {
                case 'show':
                    await this.updateMap(mapChannel);
                    return message.replyT('dunemap:MAP.UPDATED');

                case 'set': {
                    const coord = args[1]?.toUpperCase();
                    const type = args[2]?.toLowerCase();

                    // Wenn Koordinate fehlt
                    if (!coord) {
                        return message.replyT('dunemap:MAP.USAGE_SET');
                    }

                    if (!this.validateCoords(coord)) {
                        return message.replyT('dunemap:MAP.INVALID_COORD');
                    }

                    // Wenn Typ fehlt: Zeige Auswahl-Menu
                    if (!type) {
                        const markerTypes = [
                            { label: '� Titan', value: 'titan' },
                            { label: '⭐ Spice', value: 'spice' },
                            { label: '🟣 Stravidium', value: 'stravidium' },
                            { label: '🔵 Basis', value: 'base' },
                            { label: '🚢 Wrack', value: 'wrack' },
                            { label: '⚪ Aluminium', value: 'aluminium' },
                            { label: '⚫ Basalt', value: 'basalt' },
                            { label: '🔩 Eisen', value: 'eisen' },
                            { label: '⬛ Karbon', value: 'karbon' },
                            { label: '🟤 Höhle', value: 'hoele' },
                            { label: '🕳️ Loch', value: 'hole' },
                            { label: '🟢 Kontrollpunkt', value: 'kontrollpunkt' },
                            { label: '🚕 Taxi', value: 'taxi' },
                            { label: '🧪 Test', value: 'test' }
                        ];

                        const row = new ActionRowBuilder()
                            .addComponents(
                                new StringSelectMenuBuilder()
                                    .setCustomId(`dunemap_marker_${coord}`)
                                    .setPlaceholder('Wähle einen Marker-Typ')
                                    .addOptions(markerTypes)
                            );

                        const reply = await message.reply({
                            content: `📍 Wähle den Marker-Typ für **${coord}**:`,
                            components: [row]
                        });

                        // Collector für Select-Menu
                        const collector = reply.createMessageComponentCollector({
                            componentType: ComponentType.StringSelect,
                            time: 60000
                        });

                        collector.on('collect', async interaction => {
                            if (interaction.user.id !== message.author.id) {
                                return interaction.reply({
                                    content: '❌ Nur der Befehlsausführer kann auswählen!',
                                    ephemeral: true
                                });
                            }

                            // Interaction sofort bestätigen (Discord 3s Limit!)
                            await interaction.deferUpdate();

                            const selectedType = interaction.values[0];

                            await dbService.query(`
                                INSERT INTO dunemap_markers 
                                (guild_id, sector_x, sector_y, marker_type, placed_by)
                                VALUES (?, ?, ?, ?, ?)
                            `, [
                                message.guild.id,
                                coord.charAt(0),
                                parseInt(coord.slice(1)),
                                selectedType,
                                message.author.id
                            ]);

                            await this.updateMap(mapChannel);
                            const successMsg = message.guild.getT('dunemap:MAP.SET_SUCCESS').replace('{coord}', coord);
                            
                            await interaction.editReply({
                                content: successMsg,
                                components: []
                            });
                        });

                        collector.on('end', collected => {
                            if (collected.size === 0) {
                                reply.edit({
                                    content: '⏱️ Auswahl-Zeit abgelaufen.',
                                    components: []
                                }).catch(() => {});
                            }
                        });

                        return;
                    }

                    // Direkter Typ angegeben
                    await dbService.query(`
                        INSERT INTO dunemap_markers 
                        (guild_id, sector_x, sector_y, marker_type, placed_by)
                        VALUES (?, ?, ?, ?, ?)
                    `, [
                        message.guild.id,
                        coord.charAt(0),
                        parseInt(coord.slice(1)),
                        type,
                        message.author.id
                    ]);

                    await this.updateMap(mapChannel);
                    Logger.debug('[DuneMap] Set marker success, coord:', coord);
                    const successMsg = message.guild.getT('dunemap:MAP.SET_SUCCESS').replace('{coord}', coord);
                    Logger.debug('[DuneMap] Translated message:', successMsg);
                    return message.reply(successMsg);
                }

                case 'remove': {
                    const coord = args[1]?.toUpperCase();
                    
                    if (!coord) {
                        return message.replyT('dunemap:MAP.USAGE_REMOVE');
                    }

                    if (!this.validateCoords(coord)) {
                        return message.replyT('dunemap:MAP.INVALID_COORD');
                    }

                    await dbService.query(`
                        DELETE FROM dunemap_markers
                        WHERE guild_id = ?
                        AND sector_x = ?
                        AND sector_y = ?
                        AND placed_by = ?
                    `, [
                        message.guild.id,
                        coord.charAt(0),
                        parseInt(coord.slice(1)),
                        message.author.id
                    ]);

                    await this.updateMap(mapChannel);
                    const removeMsg = message.guild.getT('dunemap:MAP.REMOVE_SUCCESS').replace('{coord}', coord);
                    return message.reply(removeMsg);
                }

                default:
                    return message.replyT('dunemap:MAP.INVALID_COORD');
            }
        } catch (error) {
            Logger.error('Fehler beim Ausführen des Map-Commands:', error);
            return message.replyT('dunemap:MAP.ERROR');
        }
    },

    async interactionRun(context) {
        const dbService = ServiceManager.get('dbService');
        const Logger = ServiceManager.get('Logger');
        const interaction = context.interaction;
        const guild = interaction.guild;
        const getT = guild.getT.bind(guild);

        // Channel-Prüfung für alle Subcommands
        const mapChannel = await this.checkMapChannel(context);
        if (!mapChannel) return; // Fehlermeldung wurde bereits gesendet

        try {
            const subCommand = interaction.options.getSubcommand();

            switch(subCommand) {
                case 'show':
                    try {
                        await this.updateMap(mapChannel);
                        return interaction.editReply({
                            content: getT('dunemap:MAP.UPDATED')
                        });
                    } catch (error) {
                        // Fehlermeldung an User zurückgeben
                        if (error.message && error.message.startsWith('❌')) {
                            return interaction.editReply({
                                content: error.message
                            });
                        }
                        throw error; // Andere Fehler weitergeben
                    }

                case 'set': {
                    const coord = interaction.options.getString('coord').toUpperCase();
                    const type = interaction.options.getString('type');

                    if (!this.validateCoords(coord)) {
                        return interaction.editReply({
                            content: getT('dunemap:MAP.INVALID_COORD')
                        });
                    }

                    await dbService.query(`
                        INSERT INTO dunemap_markers 
                        (guild_id, sector_x, sector_y, marker_type, placed_by)
                        VALUES (?, ?, ?, ?, ?)
                    `, [
                        guild.id,
                        coord.charAt(0),
                        parseInt(coord.slice(1)),
                        type,
                        interaction.user.id
                    ]);

                    try {
                        await this.updateMap(mapChannel);
                    } catch (error) {
                        // Fehlermeldung an User zurückgeben
                        if (error.message && error.message.startsWith('❌')) {
                            return interaction.editReply({
                                content: error.message
                            });
                        }
                        throw error; // Andere Fehler weitergeben
                    }
                    
                    return interaction.editReply({
                        content: getT('dunemap:MAP.SET_SUCCESS').replace('{coord}', coord)
                    });
                }

                case 'remove': {
                    const coord = interaction.options.getString('coord').toUpperCase();

                    if (!this.validateCoords(coord)) {
                        return interaction.editReply({
                            content: getT('dunemap:MAP.INVALID_COORD')
                        });
                    }

                    await dbService.query(`
                        DELETE FROM dunemap_markers
                        WHERE guild_id = ?
                        AND sector_x = ?
                        AND sector_y = ?
                        AND placed_by = ?
                    `, [
                        guild.id,
                        coord.charAt(0),
                        parseInt(coord.slice(1)),
                        interaction.user.id
                    ]);

                    try {
                        await this.updateMap(mapChannel);
                    } catch (error) {
                        // Fehlermeldung an User zurückgeben
                        if (error.message && error.message.startsWith('❌')) {
                            return interaction.editReply({
                                content: error.message
                            });
                        }
                        throw error; // Andere Fehler weitergeben
                    }
                    
                    return interaction.editReply({
                        content: getT('dunemap:MAP.REMOVE_SUCCESS').replace('{coord}', coord)
                    });
                }
            }
        } catch (error) {
            Logger.error('Fehler beim Ausführen des Map-Commands:', error);
            return interaction.editReply({
                content: getT('dunemap:MAP.ERROR')
            });
        }
    }
};