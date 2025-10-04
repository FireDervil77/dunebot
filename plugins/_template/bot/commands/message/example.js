/**
 * Beispiel Message/Prefix-Command
 * 
 * Dieses Command demonstriert:
 * - Message-Command-Struktur
 * - Argument-Verarbeitung
 * - Übersetzungen
 * - Error-Handling
 * 
 * ⚠️ WICHTIG: slashCommand.enabled MUSS false sein!
 * 
 * @author DuneBot Team
 * @version 1.0.0
 */
module.exports = {
    name: 'example',
    description: 'template:EXAMPLE.DESCRIPTION',
    
    // Prefix-Command aktivieren
    command: {
        enabled: true,
        usage: '<text> [number]',
        aliases: ['ex', 'beispiel'],
        minArgsCount: 1 // Mindestens 1 Argument erforderlich
    },

    // ⚠️ WICHTIG: Slash-Command EXPLIZIT deaktivieren!
    slashCommand: {
        enabled: false
    },

    /**
     * Message Command Ausführung
     * 
     * WICHTIG:
     * - Parameter: context-Objekt mit { message, args }
     * - message: Discord Message-Objekt
     * - args: Array von Command-Argumenten
     * - Nutze message.guild.getT() für Übersetzungen
     * - Nutze message.reply() für Antworten
     * 
     * @param {Object} context - Command Context
     * @param {import('discord.js').Message} context.message - Discord Message
     * @param {string[]} context.args - Command-Argumente
     */
    async messageRun(context) {
        const { message, args } = context;
        const getT = message.guild.getT.bind(message.guild);

        try {
            // Argumente verarbeiten
            const text = args[0]; // Erstes Argument (erforderlich)
            const number = parseInt(args[1]) || 42; // Zweites Argument (optional)

            // Validierung
            if (text.length > 200) {
                return message.reply(getT('template:EXAMPLE.TEXT_TOO_LONG'));
            }

            if (number < 1 || number > 100) {
                return message.reply(getT('template:EXAMPLE.NUMBER_OUT_OF_RANGE'));
            }

            // Beispiel: Plugin-Instanz abrufen
            // const plugin = message.client.pluginManager.getPlugin('template');
            // const guildSettings = plugin.getGuildSettings(message.guild.id);

            // Antwort erstellen
            const response = getT('template:EXAMPLE.MESSAGE_SUCCESS', {
                text,
                number,
                user: message.author.tag
            });

            // Antwort senden
            await message.reply({
                content: response,
                allowedMentions: { repliedUser: false } // User nicht pingen
            });

        } catch (error) {
            // Fehlerbehandlung
            const Logger = require('dunebot-sdk/utils').Logger;
            Logger.error('Fehler im example Message-Command:', error);

            // Fehler-Antwort
            await message.reply(
                getT('template:EXAMPLE.ERROR', { error: error.message })
            ).catch(() => {
                // Fallback, falls reply fehlschlägt
                Logger.error('Konnte Fehler-Antwort nicht senden');
            });
        }
    }
};
