const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ApplicationCommandOptionType } = require('discord.js');

/**
 * Tutorial Command - Zeigt eine Anleitung für das DuneMap Plugin
 * 
 * @author FireDervil
 * @version 1.0.0
 */
module.exports = {
    name: 'tutorial',
    description: 'dunemap:TUTORIAL.DESCRIPTION',
    
    command: {
        enabled: true,
        aliases: ['hilfe', 'anleitung', 'dune-help'],
        usage: ''
    },

    slashCommand: {
        enabled: true,
        ephemeral: false,
        options: []
    },

    /**
     * Prefix Command Ausführung
     * @param {Object} context - Command Context mit message
     */
    async messageRun({ message, prefix }) {
        const guild = message.guild;
        const getT = guild.getT.bind(guild);

        // Prefix für Tutorial-Text verwenden
        const cmdPrefix = prefix || '!';

        // Tutorial Embed erstellen mit Prefix-Commands
        const tutorialEmbed = new EmbedBuilder()
            .setColor('#E67E22') // Dune Orange
            .setTitle('🏜️ DuneMap Tutorial')
            .setDescription(getT('dunemap:TUTORIAL.INTRO'))
            .addFields(
                {
                    name: '1️⃣ ' + getT('dunemap:TUTORIAL.STEP1_TITLE'),
                    value: getT('dunemap:TUTORIAL.STEP1_DESC').replace(/\//g, cmdPrefix),
                    inline: false
                },
                {
                    name: '2️⃣ ' + getT('dunemap:TUTORIAL.STEP2_TITLE'),
                    value: getT('dunemap:TUTORIAL.STEP2_DESC').replace(/\//g, cmdPrefix),
                    inline: false
                },
                {
                    name: '3️⃣ ' + getT('dunemap:TUTORIAL.STEP3_TITLE'),
                    value: getT('dunemap:TUTORIAL.STEP3_DESC'),
                    inline: false
                },
                {
                    name: '4️⃣ ' + getT('dunemap:TUTORIAL.STEP4_TITLE'),
                    value: getT('dunemap:TUTORIAL.STEP4_DESC').replace(/\//g, cmdPrefix),
                    inline: false
                },
                {
                    name: '⚙️ ' + getT('dunemap:TUTORIAL.ADMIN_TITLE'),
                    value: getT('dunemap:TUTORIAL.ADMIN_DESC').replace(/\//g, cmdPrefix),
                    inline: false
                },
                {
                    name: '📋 ' + getT('dunemap:TUTORIAL.COMMANDS_TITLE'),
                    value: getT('dunemap:TUTORIAL.COMMANDS_LIST').replace(/\//g, cmdPrefix),
                    inline: false
                }
            )
            .setFooter({ text: getT('dunemap:TUTORIAL.FOOTER') })
            .setTimestamp();

        await message.reply({ 
            embeds: [tutorialEmbed]
        });
    },

    /**
     * Slash Command Ausführung
     * @param {Object} context - Command Context mit interaction
     */
    async interactionRun(context) {
        const interaction = context.interaction;
        const guild = interaction.guild;
        const getT = guild.getT.bind(guild);

        // Tutorial Embed erstellen
        const tutorialEmbed = new EmbedBuilder()
            .setColor('#E67E22') // Dune Orange
            .setTitle('🏜️ DuneMap Tutorial')
            .setDescription(getT('dunemap:TUTORIAL.INTRO'))
            .addFields(
                {
                    name: '1️⃣ ' + getT('dunemap:TUTORIAL.STEP1_TITLE'),
                    value: getT('dunemap:TUTORIAL.STEP1_DESC'),
                    inline: false
                },
                {
                    name: '2️⃣ ' + getT('dunemap:TUTORIAL.STEP2_TITLE'),
                    value: getT('dunemap:TUTORIAL.STEP2_DESC'),
                    inline: false
                },
                {
                    name: '3️⃣ ' + getT('dunemap:TUTORIAL.STEP3_TITLE'),
                    value: getT('dunemap:TUTORIAL.STEP3_DESC'),
                    inline: false
                },
                {
                    name: '4️⃣ ' + getT('dunemap:TUTORIAL.STEP4_TITLE'),
                    value: getT('dunemap:TUTORIAL.STEP4_DESC'),
                    inline: false
                },
                {
                    name: '⚙️ ' + getT('dunemap:TUTORIAL.ADMIN_TITLE'),
                    value: getT('dunemap:TUTORIAL.ADMIN_DESC'),
                    inline: false
                },
                {
                    name: '📋 ' + getT('dunemap:TUTORIAL.COMMANDS_TITLE'),
                    value: getT('dunemap:TUTORIAL.COMMANDS_LIST'),
                    inline: false
                }
            )
            .setFooter({ text: getT('dunemap:TUTORIAL.FOOTER') })
            .setTimestamp();

        await interaction.editReply({ 
            embeds: [tutorialEmbed],
            ephemeral: false
        });
    }
};
