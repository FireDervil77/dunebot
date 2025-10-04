const { EmbedBuilder, ApplicationCommandOptionType } = require('discord.js');

/**
 * Beispiel Slash-Command
 * 
 * Dieses Command demonstriert:
 * - Slash-Command-Struktur
 * - Parameter-Verarbeitung
 * - Übersetzungen
 * - Embed-Erstellung
 * - Error-Handling
 * 
 * @author DuneBot Team
 * @version 1.0.0
 */
module.exports = {
    name: 'example',
    description: 'template:EXAMPLE.DESCRIPTION',
    
    // Prefix-Command deaktivieren
    command: {
        enabled: false
    },

    // Slash-Command aktivieren
    slashCommand: {
        enabled: true,
        ephemeral: false, // false = Antwort für alle sichtbar, true = nur für User
        options: [
            {
                name: 'text',
                description: 'template:EXAMPLE.OPTION_TEXT_DESC',
                type: ApplicationCommandOptionType.String,
                required: true
            },
            {
                name: 'number',
                description: 'template:EXAMPLE.OPTION_NUMBER_DESC',
                type: ApplicationCommandOptionType.Integer,
                required: false,
                minValue: 1,
                maxValue: 100
            },
            {
                name: 'user',
                description: 'template:EXAMPLE.OPTION_USER_DESC',
                type: ApplicationCommandOptionType.User,
                required: false
            }
        ]
    },

    /**
     * Slash Command Ausführung
     * 
     * WICHTIG:
     * - Parameter: context-Objekt mit { interaction }
     * - Interaktion ist bereits deferred (await interaction.deferReply())
     * - Nutze interaction.editReply() für Antworten
     * - Nutze guild.getT() für Übersetzungen
     * 
     * @param {Object} context - Command Context
     * @param {import('discord.js').CommandInteraction} context.interaction - Discord Interaction
     */
    async interactionRun(context) {
        const interaction = context.interaction;
        const guild = interaction.guild;
        const getT = guild.getT.bind(guild);

        try {
            // Parameter auslesen
            const text = interaction.options.getString('text');
            const number = interaction.options.getInteger('number') || 42;
            const user = interaction.options.getUser('user') || interaction.user;

            // Beispiel: Plugin-Instanz abrufen (falls benötigt)
            // const plugin = interaction.client.pluginManager.getPlugin('template');
            // const guildSettings = plugin.getGuildSettings(guild.id);

            // Embed erstellen
            const embed = new EmbedBuilder()
                .setColor('#5865F2') // Discord Blurple
                .setTitle(getT('template:EXAMPLE.EMBED_TITLE'))
                .setDescription(getT('template:EXAMPLE.EMBED_DESCRIPTION', { text }))
                .addFields(
                    {
                        name: getT('template:EXAMPLE.FIELD_NUMBER'),
                        value: number.toString(),
                        inline: true
                    },
                    {
                        name: getT('template:EXAMPLE.FIELD_USER'),
                        value: user.tag,
                        inline: true
                    }
                )
                .setFooter({ 
                    text: getT('template:EXAMPLE.FOOTER', { user: interaction.user.tag }),
                    iconURL: interaction.user.displayAvatarURL()
                })
                .setTimestamp();

            // Antwort senden
            await interaction.editReply({ 
                embeds: [embed]
            });

        } catch (error) {
            // Fehlerbehandlung
            const Logger = require('dunebot-sdk/utils').Logger;
            Logger.error('Fehler im example-Command:', error);

            // Fehler-Antwort
            await interaction.editReply({
                content: getT('template:EXAMPLE.ERROR', { error: error.message }),
                embeds: []
            }).catch(() => {
                // Fallback, falls editReply fehlschlägt
                interaction.followUp({
                    content: getT('template:EXAMPLE.ERROR', { error: error.message }),
                    ephemeral: true
                });
            });
        }
    }
};
