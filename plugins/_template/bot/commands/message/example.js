const { EmbedUtils } = require("dunebot-sdk/utils");

/**
 * Beispiel Message-Command für das Template-Plugin
 * 
 * Dieser Command ist nur als Prefix-Command verfügbar (kein Slash-Command)
 * und demonstriert die grundlegende Message-Command Struktur.
 * 
 * @type {import('dunebot-sdk').CommandType}
 * @author DuneBot Team
 */
module.exports = {
    name: "template-info",
    description: "template:INFO.DESCRIPTION",
    
    // Nur Message-Command, kein Slash-Command
    command: {
        enabled: true,
        usage: "template-info",
        aliases: ["tinfo", "template"],
        category: "Template"
    },
    
    slashCommand: {
        enabled: false    // Dieser Command ist NICHT als Slash-Command verfügbar
    },

    /**
     * Wird ausgeführt wenn der Command über Prefix aufgerufen wird
     * 
     * @param {Object} context - Command Context
     * @param {import('discord.js').Message} context.message - Discord Message
     * @returns {Promise<void>}
     */
    async messageRun({ message }) {
        const guild = message.guild;
        
        const embed = EmbedUtils.embed()
            .setTitle(guild.getT('template:INFO.TITLE'))
            .setDescription(guild.getT('template:INFO.DESCRIPTION_LONG'))
            .addFields(
                {
                    name: guild.getT('template:INFO.VERSION'),
                    value: '`1.0.0`',
                    inline: true
                },
                {
                    name: guild.getT('template:INFO.AUTHOR'),
                    value: 'DuneBot Team',
                    inline: true
                },
                {
                    name: guild.getT('template:INFO.COMMANDS'),
                    value: guild.getT('template:INFO.COMMANDS_LIST'),
                    inline: false
                }
            )
            .setFooter({ text: guild.getT('template:INFO.FOOTER') })
            .setTimestamp();

        await message.reply({ embeds: [embed] });
    },
};
