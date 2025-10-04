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
    name: 'storm',
    description: 'dunemap:STORM.DESCRIPTION',

    command: {
        enabled: true,
        aliases: ['sturm'],
        usage: '<set|reset> [days] [hours] [minutes]'
    },

    slashCommand: {
        enabled: true,
        options: [
            {
                name: 'set',
                description: 'dunemap:STORM.SET_DESCRIPTION',
                type: ApplicationCommandOptionType.Subcommand,
                options: [
                    {
                        name: 'days',
                        description: 'dunemap:STORM.DAYS_DESCRIPTION',
                        type: ApplicationCommandOptionType.Integer,
                        required: false
                    },
                    {
                        name: 'hours',
                        description: 'dunemap:STORM.HOURS_DESCRIPTION',
                        type: ApplicationCommandOptionType.Integer,
                        required: false
                    },
                    {
                        name: 'minutes',
                        description: 'dunemap:STORM.MINUTES_DESCRIPTION',
                        type: ApplicationCommandOptionType.Integer,
                        required: false
                    }
                ]
            },
            {
                name: 'reset',
                description: 'dunemap:STORM.RESET_DESCRIPTION',
                type: ApplicationCommandOptionType.Subcommand,
            }
        ]
    },

    userPermissions: ['Administrator'],

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

    // Command Handler
   async messageRun(message, args) {
        const subCommand = args[0]?.toLowerCase();
        const dbService = ServiceManager.get('dbService');
        
        if (!message.member.permissions.has('ADMINISTRATOR')) {
            return message.replyT('dunemap:ADMIN_RIGHTS');
        }

        switch(subCommand) {
            case 'set': {
                const days = parseInt(args[1]) || 0;
                const hours = parseInt(args[2]) || 0;
                const minutes = parseInt(args[3]) || 0;
                
                const duration = (days * 86400) + (hours * 3600) + (minutes * 60);
                const startTime = Math.floor(Date.now() / 1000);

                await dbService.query(`
                    INSERT INTO dunemap_storm_timer 
                    (guild_id, start_time, duration, created_by) 
                    VALUES (?, ?, ?, ?)
                    ON DUPLICATE KEY UPDATE 
                    start_time = VALUES(start_time),
                    duration = VALUES(duration),
                    created_by = VALUES(created_by)
                `, [message.guild.id, startTime, duration, message.author.id]);

                return message.reply(`Timer auf ${days}d ${hours}h ${minutes}m gesetzt!`);
            }
            case 'reset': {
                await dbService.query(
                    'DELETE FROM dunemap_storm_timer WHERE guild_id = ?',
                    [message.guild.id]
                );
                return message.replyT('dunemap:STORM.TIMER_RESET_MSG');
            }
            default:
                return message.replyT('dunemap:STORM.COMMANDS_USAGE');
        }
    },

    async interactionRun(context) {
        const interaction = context.interaction;
        const guild = interaction.guild;
        const getT = guild.getT.bind(guild);
        const subCommand = interaction.options.getSubcommand();
        const dbService = ServiceManager.get('dbService');

        // Permission-Check für Admin-Commands
        if (!interaction.memberPermissions.has('ManageGuild')) {
            return interaction.editReply({
                content: `❌ ${getT('dunemap:PERMISSIONS.MANAGE_GUILD_REQUIRED')}`,
                ephemeral: true
            });
        }

        // Channel-Prüfung für alle Subcommands
        const mapChannel = await this.checkMapChannel(context);
        if (!mapChannel) return; // Fehlermeldung wurde bereits gesendet

        switch(subCommand) {
            case 'set': {
                const days = interaction.options.getInteger('days') || 0;
                const hours = interaction.options.getInteger('hours') || 0;
                const minutes = interaction.options.getInteger('minutes') || 0;
                
                const duration = (days * 86400) + (hours * 3600) + (minutes * 60);
                const startTime = Math.floor(Date.now() / 1000);

                await dbService.query(`
                    INSERT INTO dunemap_storm_timer 
                    (guild_id, start_time, duration, created_by) 
                    VALUES (?, ?, ?, ?)
                    ON DUPLICATE KEY UPDATE 
                    start_time = VALUES(start_time),
                    duration = VALUES(duration),
                    created_by = VALUES(created_by)
                `, [guild.id, startTime, duration, interaction.user.id]);

                // Map neu zeichnen und senden
                await this.updateMap(mapChannel);

                return interaction.editReply({
                    content: `✅ Timer auf ${days}d ${hours}h ${minutes}m gesetzt!`
                });
            }
            case 'reset': {
                await dbService.query(
                    'DELETE FROM dunemap_storm_timer WHERE guild_id = ?',
                    [guild.id]
                );

                // Map neu zeichnen und senden
                await this.updateMap(mapChannel);
                // Map neu zeichnen und senden
                await this.updateMap(mapChannel);

                return interaction.editReply({
                    content: getT('dunemap:STORM.TIMER_RESET_MSG')
                });
            }
        }
    },

    // Helper Methoden
    async getMapChannel(guildId, client) {
        const dbService = ServiceManager.get('dbService');
        const channelId = await dbService.getConfig('dunemap', 'MAP_CHANNEL_ID', 'shared', guildId);
        return channelId ? client.channels.cache.get(channelId) : null;
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

            // Timer laden und generieren
            const stormTimerDuration = await dbService.getConfig('dunemap', 'STORM_TIMER_DURATION', 'shared', channel.guild.id);
            const stormTimerFormat = await dbService.getConfig('dunemap', 'STORM_TIMER_FORMAT', 'shared', channel.guild.id);
            
            // Hole den Timer aus der DB
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
    }
};