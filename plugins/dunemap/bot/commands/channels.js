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
    name: 'dunemap-setup',
    description: 'dunemap:DESCRIPTION',
    validations: [],
    userPermissions: ["ManageGuild"],
    
    // Message Command
    command: {
        enabled: true,
        aliases: ['dmap-setup'],
        usage: 'channel <#channel>'
    },

    // Slash Command
    slashCommand: {
        enabled: true,
        ephemeral: true,
        options: [
            {
                name: 'channel',
                description: 'dunemap:CHANNELS.CHANNEL_DESCRIPTION',
                type: ApplicationCommandOptionType.Subcommand,
                options: [
                    {
                        name: 'target',
                        description: 'dunemap:CHANNELS.TARGET_DESCRIPTION',
                        type: ApplicationCommandOptionType.Channel,
                        required: true,
                        channelTypes: [0]
                    }
                ]
            }
        ]
    },

    async messageRun(context) {
        const { ServiceManager } = require('dunebot-core');
        const dbService = ServiceManager.get('dbService');
        const Logger = ServiceManager.get('Logger');
        
        const { message, args } = context;
        
        // Debug-Logging für die Message-Struktur
        Logger.debug('[DuneMap] Message Debug:', {
            hasContext: !!context,
            hasMessage: !!message,
            messageType: typeof message,
            hasGuild: !!message?.guild,
            hasMentions: !!message?.mentions,
            args: args
        });
        
        // Erweiterte Prüfung der Message-Struktur
        if (!message?.guild) {
            Logger.warn('[DuneMap] Keine gültige Guild in der Message gefunden');
            return;
        }

        // Dann prüfen ob ein Channel erwähnt wurde
        if (!message.mentions?.channels?.size) {
            return message.replyT('dunemap:CHANNELS.CHANNEL_SET_DSCR');
        }

        const channel = message.mentions.channels.first();
        if (!channel) {
            Logger.warn('[DuneMap] Erwähnter Channel nicht gefunden');
            return message.replyT('dunemap:CHANNELS.CHANNEL_SET_DSCR');
        }
        
        try {
            // Channel in shared Config speichern
            await dbService.setConfig(
                'dunemap',
                'MAP_CHANNEL_ID',
                channel.id,
                'shared',
                message.guild.id,
                false  // Nicht global, da guild-spezifisch
            );

            Logger.success('[DuneMap] Channel erfolgreich gespeichert:', {
                channelId: channel.id,
                channelName: channel.name,
                guildId: message.guild.id
            });

            return message.replyT('dunemap:CHANNELS.CHANNEL_SET_SUCCESS', { channel: channel.toString() });
        } catch (err) {
            Logger.error('[DuneMap] Fehler beim Speichern des Channels:', err);
            return message.replyT('dunemap:CHANNEL.CHANNEL_SET_ERROR');
        }
    },

    async interactionRun({ interaction, client }) {
        const { ServiceManager } = require('dunebot-core');
        const dbService = ServiceManager.get('dbService');
        const Logger = ServiceManager.get('Logger');

        // Permission-Check
        if (!interaction.memberPermissions.has('ManageGuild')) {
            return interaction.editReply({
                content: `❌ ${interaction.guild.getT('dunemap:PERMISSIONS.MANAGE_GUILD_REQUIRED')}`,
                ephemeral: true
            });
        }

        Logger.debug('[DuneMap] Interaction Details:', {
            type: interaction.type,
            commandName: interaction.commandName,
            options: interaction.options?._subcommand,
            rawData: interaction.options?._hoistedOptions
        });

        try {
            // Hole den Channel aus dem Subcommand
            const targetChannel = interaction.options.getChannel('target', true);
            
            Logger.debug('[DuneMap] Interaction Debug:', {
                commandName: interaction.commandName,
                subcommand: interaction.options.getSubcommand(),
                targetChannel: targetChannel?.id,
                guildId: interaction.guildId
            });
            
            // Zuerst prüfen ob der Channel gültig ist
            if (!targetChannel) {
                Logger.warn('[DuneMap] Kein gültiger Channel in den Optionen gefunden');
                return interaction.editReply({
                    content: 'Bitte einen gültigen Kanal auswählen.',
                    ephemeral: true
                });
            }
            
            // Channel in shared Config speichern
            await dbService.setConfig(
                'dunemap',
                'MAP_CHANNEL_ID',
                targetChannel.id,
                'shared',
                interaction.guild.id,
                false  // Nicht global, da guild-spezifisch
            );            Logger.success('[DuneMap] Channel erfolgreich gespeichert:', {
                channelId: targetChannel.id,
                channelName: targetChannel.name,
                guildId: interaction.guild.id
            });

            return interaction.editReply({
                content: `Map Channel auf ${targetChannel.toString()} gesetzt!`,
                ephemeral: true
            });
        } catch (err) {
            Logger.error('[DuneMap] Fehler beim Speichern des Channels:', err);
            return interaction.editReply({ 
                content: 'Fehler beim Setzen des Channels!',
                ephemeral: true
            });
        }
    }
};