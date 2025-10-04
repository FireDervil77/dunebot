/**
 * Beispiel Context-Menü
 * 
 * Context-Menüs erscheinen beim Rechtsklick auf Nachrichten oder User.
 * 
 * TYPEN:
 * - ApplicationCommandType.Message: Nachricht-Context-Menü
 * - ApplicationCommandType.User: User-Context-Menü
 * 
 * @author DuneBot Team
 * @version 1.0.0
 */

const { ApplicationCommandType, EmbedBuilder } = require('discord.js');

module.exports = {
    name: 'Analyze Message',
    type: ApplicationCommandType.Message, // Context-Menü-Typ

    /**
     * Context-Menü-Handler
     * 
     * @param {Object} context - Context-Objekt
     * @param {import('discord.js').MessageContextMenuCommandInteraction} context.interaction
     */
    async execute(context) {
        const interaction = context.interaction;
        const targetMessage = interaction.targetMessage;
        const guild = interaction.guild;
        const getT = guild.getT.bind(guild);

        try {
            // Nachricht analysieren
            const analysis = {
                author: targetMessage.author.tag,
                content: targetMessage.content || '*Keine Text-Nachricht*',
                length: targetMessage.content.length,
                attachments: targetMessage.attachments.size,
                embeds: targetMessage.embeds.length,
                mentions: targetMessage.mentions.users.size,
                createdAt: targetMessage.createdAt
            };

            // Embed erstellen
            const embed = new EmbedBuilder()
                .setColor('#5865F2')
                .setTitle('📊 Nachrichten-Analyse')
                .setDescription(`Analyse der Nachricht von ${analysis.author}`)
                .addFields(
                    {
                        name: 'Länge',
                        value: `${analysis.length} Zeichen`,
                        inline: true
                    },
                    {
                        name: 'Anhänge',
                        value: analysis.attachments.toString(),
                        inline: true
                    },
                    {
                        name: 'Embeds',
                        value: analysis.embeds.toString(),
                        inline: true
                    },
                    {
                        name: 'Erwähnungen',
                        value: analysis.mentions.toString(),
                        inline: true
                    },
                    {
                        name: 'Erstellt',
                        value: `<t:${Math.floor(analysis.createdAt.getTime() / 1000)}:R>`,
                        inline: true
                    }
                )
                .setFooter({ text: 'Template Plugin Context-Menü' })
                .setTimestamp();

            // Antwort senden (ephemeral = nur für User sichtbar)
            await interaction.reply({
                embeds: [embed],
                ephemeral: true
            });

        } catch (error) {
            const Logger = require('dunebot-sdk/utils').Logger;
            Logger.error('Fehler im Context-Menü:', error);

            await interaction.reply({
                content: `❌ Fehler: ${error.message}`,
                ephemeral: true
            });
        }
    }
};
