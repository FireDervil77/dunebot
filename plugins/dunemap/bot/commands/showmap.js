const { ServiceManager } = require('dunebot-core');
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
        const MapGenerator = require('../../shared/MapGenerator');
        const mapGen = new MapGenerator();
        const dbService = ServiceManager.get('dbService');
        const Logger = ServiceManager.get('Logger');

        try {
            // Marker laden
            const markers = await dbService.query(
                'SELECT * FROM dunemap_markers WHERE guild_id = ?',
                [channel.guild.id]
            );

            // Karte generieren
            const mapBuffer = await mapGen.generateMap(markers);
            
            // Map senden
            await channel.send({
                content: '🌍 **DuneBot Map Update**',
                files: [{ attachment: mapBuffer, name: 'map.png' }]
            });

            // Timer aus der Datenbank laden
            const [timer] = await dbService.query(
                'SELECT * FROM dunemap_storm_timer WHERE guild_id = ?',
                [channel.guild.id]
            );

            let timerText = null;
            if (timer) {
                const remaining = (timer.start_time + timer.duration) - Math.floor(Date.now() / 1000);
                if (remaining > 0) {
                    const days = Math.floor(remaining / 86400);
                    const hours = Math.floor((remaining % 86400) / 3600);
                    const minutes = Math.floor((remaining % 3600) / 60);
                    timerText = `${days}d ${hours}h ${minutes}m`;
                } else {
                    timerText = 'Timer abgelaufen!';
                }
            }
            
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
            Logger.error('Fehler beim Map Update:', error);
            throw error;
        }
    },

    // Command Handler
    async messageRun(message, args) {
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

                    if (!coord || !type) {
                        return message.replyT('dunemap:MAP.USAGE_SET');
                    }

                    if (!this.validateCoords(coord)) {
                        return message.replyT('dunemap:MAP.INVALID_COORD');
                    }

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
                    return message.replyT(`dunemap:MAP.SET_SUCCESS`);
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
                    return message.replyT(`dunemap:MAP.REMOVE_SUCCESS`);
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
                    await this.updateMap(mapChannel);
                    return interaction.editReply({
                        content: getT('dunemap:MAP.UPDATED')
                    });

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

                    await this.updateMap(mapChannel);
                    return interaction.editReply({
                        content: getT('dunemap:MAP.SET_SUCCESS', { coord })
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

                    await this.updateMap(mapChannel);
                    return interaction.editReply({
                        content: getT('dunemap:MAP.REMOVE_SUCCESS', { coord })
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