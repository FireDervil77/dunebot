const { ServiceManager } = require('dunebot-core');
const { getNextStormTiming, STORM_TIMINGS } = require('../../dashboard/assets/js/coriolisStormConfig');

const {
    ActionRowBuilder,
    StringSelectMenuBuilder,
    Message,
    ButtonBuilder,
    CommandInteraction,
    ApplicationCommandOptionType,
    ButtonStyle,
    ComponentType,
    EmbedBuilder
} = require("discord.js");

module.exports = {
    name: 'storm',
    description: 'dunemap:STORM.DESCRIPTION',

    command: {
        enabled: true,
        aliases: ['sturm'],
        usage: '' // Keine Parameter mehr - automatisch basierend auf Region
    },

    slashCommand: {
        enabled: true,
        options: [] // Keine Subcommands mehr - zeigt nur Timer an
    },

    userPermissions: [], // Jeder kann den Timer sehen

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

    /**
     * Zeigt den automatischen Coriolis Storm Timer basierend auf Guild-Region
     * @param {Message|CommandInteraction} source - Message oder Interaction
     * @param {Guild} guild - Discord Guild
     */
    async showStormTimer(source, guild) {
        const dbService = ServiceManager.get('dbService');
        const Logger = ServiceManager.get('Logger');
        const getT = guild.getT.bind(guild);

        try {
            // Lade Region aus DB (Default: EU)
            const region = await dbService.getConfig('dunemap', 'COREOLIS_REGION', 'shared', guild.id) || 'EU';
            Logger.debug(`[DuneMap] Storm-Region für Guild ${guild.id}: ${region}`);

            // Berechne nächsten Storm
            const stormData = getNextStormTiming(region);
            const regionConfig = STORM_TIMINGS[region];

            // Embed erstellen
            const embed = new EmbedBuilder()
                .setColor('#FF6B35')
                .setTitle(`${regionConfig.flag} Coriolis Storm Timer - ${regionConfig.displayName}`)
                .setDescription(`⏰ **Zeit bis zum Storm-Reset:**`)
                .addFields(
                    {
                        name: '⏱️ Countdown',
                        value: `\`${stormData.daysUntil}d ${stormData.hoursUntil}h ${stormData.minutesUntil}m\``,
                        inline: true
                    },
                    {
                        name: '📅 Nächster Storm',
                        value: `**Start:** ${regionConfig.localStartTime}\n**Ende:** ${regionConfig.localEndTime}`,
                        inline: true
                    },
                    {
                        name: '🌍 Region',
                        value: `${regionConfig.flag} ${regionConfig.displayName}`,
                        inline: true
                    }
                )
                .setFooter({ text: 'Automatisch berechnet basierend auf offiziellen Zeiten | Storm-Dauer: 10 Stunden' })
                .setTimestamp();

            // Status-Badge wenn aktiv
            if (stormData.isActive) {
                embed.addFields({
                    name: '⚡ Status',
                    value: '🌪️ **STORM AKTIV**',
                    inline: false
                });
            }

            // Sende Embed
            if (source instanceof Message) {
                await source.reply({ embeds: [embed] });
            } else {
                await source.editReply({ embeds: [embed] });
            }
        } catch (error) {
            Logger.error('[DuneMap] Fehler beim Anzeigen des Storm-Timers:', error);
            const errorMsg = '❌ Fehler beim Laden des Storm-Timers.';
            
            if (source instanceof Message) {
                await source.reply(errorMsg);
            } else {
                await source.editReply({ content: errorMsg, ephemeral: true });
            }
        }
    },

    // Command Handler (Prefix-Command)
    async messageRun({ message, args }) {
        await this.showStormTimer(message, message.guild);
    },

    // Slash Command Handler
    async interactionRun(context) {
        const interaction = context.interaction;
        await this.showStormTimer(interaction, interaction.guild);
    }
};