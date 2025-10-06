const { ApplicationCommandOptionType } = require('discord.js');
const { EmbedUtils } = require("dunebot-sdk/utils");

/**
 * Beispiel Slash-Command für das Template-Plugin
 * 
 * Dieser Command zeigt die grundlegende Struktur eines Slash-Commands
 * und wie man mit Optionen, Embeds und i18n arbeitet.
 * 
 * @type {import('dunebot-sdk').CommandType}
 * @author DuneBot Team
 */
module.exports = {
    name: "example",
    description: "template:EXAMPLE.DESCRIPTION",
    
    // Befehlskonfiguration für Message-basierte Commands
    command: {
        enabled: true,          // Command über Prefix aktivieren
        usage: "example [text]",
        aliases: ["beispiel"],
        category: "Template"
    },
    
    // Slash-Command Konfiguration
    slashCommand: {
        enabled: true,          // Slash-Command aktivieren
        ephemeral: false,       // Antwort nur für User sichtbar?
        options: [
            {
                name: "text",
                description: "template:EXAMPLE.TEXT_OPTION",
                type: ApplicationCommandOptionType.String,
                required: false
            },
            {
                name: "number",
                description: "template:EXAMPLE.NUMBER_OPTION",
                type: ApplicationCommandOptionType.Integer,
                required: false,
                minValue: 1,
                maxValue: 100
            }
        ],
    },

    /**
     * Wird ausgeführt wenn der Command über Prefix aufgerufen wird
     * 
     * @param {Object} context - Command Context
     * @param {import('discord.js').Message} context.message - Discord Message
     * @param {string[]} context.args - Command Argumente
     * @returns {Promise<void>}
     */
    async messageRun({ message, args }) {
        const guild = message.guild;
        const text = args.join(' ') || guild.getT('template:EXAMPLE.DEFAULT_TEXT');
        
        const embed = EmbedUtils.embed()
            .setTitle(guild.getT('template:EXAMPLE.TITLE'))
            .setDescription(guild.getT('template:EXAMPLE.MESSAGE', { text }))
            .addFields(
                {
                    name: guild.getT('template:EXAMPLE.USER_FIELD'),
                    value: `${message.author.tag}`,
                    inline: true
                },
                {
                    name: guild.getT('template:EXAMPLE.CHANNEL_FIELD'),
                    value: `${message.channel.name}`,
                    inline: true
                }
            )
            .setFooter({ text: guild.getT('template:EXAMPLE.FOOTER') })
            .setTimestamp();

        await message.reply({ embeds: [embed] });
    },

    /**
     * Wird ausgeführt wenn der Command als Slash-Command aufgerufen wird
     * 
     * @param {Object} context - Command Context
     * @param {import('discord.js').ChatInputCommandInteraction} context.interaction - Discord Interaction
     * @returns {Promise<void>}
     */
    async interactionRun({ interaction }) {
        const text = interaction.options.getString('text') || 
                     interaction.guild.getT('template:EXAMPLE.DEFAULT_TEXT');
        const number = interaction.options.getInteger('number');
        
        const embed = EmbedUtils.embed()
            .setTitle(interaction.guild.getT('template:EXAMPLE.TITLE'))
            .setDescription(interaction.guild.getT('template:EXAMPLE.MESSAGE', { text }))
            .addFields(
                {
                    name: interaction.guild.getT('template:EXAMPLE.USER_FIELD'),
                    value: `${interaction.user.tag}`,
                    inline: true
                },
                {
                    name: interaction.guild.getT('template:EXAMPLE.CHANNEL_FIELD'),
                    value: `${interaction.channel.name}`,
                    inline: true
                }
            );
        
        // Optionales Number-Feld hinzufügen
        if (number) {
            embed.addFields({
                name: interaction.guild.getT('template:EXAMPLE.NUMBER_FIELD'),
                value: `${number}`,
                inline: true
            });
        }
        
        embed.setFooter({ text: interaction.guild.getT('template:EXAMPLE.FOOTER') })
             .setTimestamp();

        await interaction.followUp({ embeds: [embed] });
    },
};
