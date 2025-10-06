const { ServiceManager } = require('dunebot-core');

/**
 * Beispiel Context-Menu Command für das Template-Plugin
 * 
 * Context-Menus erscheinen beim Rechtsklick auf User oder Messages
 * und bieten schnellen Zugriff auf Plugin-Funktionen.
 * 
 * @author DuneBot Team
 */
module.exports = {
    /**
     * Name des Context-Commands (wird im Menu angezeigt)
     */
    name: 'Template Action',
    
    /**
     * Typ des Context-Menus
     * 2 = USER (Rechtsklick auf User)
     * 3 = MESSAGE (Rechtsklick auf Message)
     */
    type: 2, // USER Context Menu
    
    /**
     * Wird ausgeführt wenn das Context-Menu verwendet wird
     * 
     * @param {import('discord.js').ContextMenuCommandInteraction} interaction - Discord Context Menu Interaction
     * @returns {Promise<void>}
     */
    async run(interaction) {
        const Logger = ServiceManager.get('Logger');
        const targetUser = interaction.targetUser;
        const guild = interaction.guild;
        
        Logger.debug(`[Template] Context Menu auf User ${targetUser.tag} verwendet`);
        
        // Beispiel: Benutzer-Information anzeigen
        await interaction.reply({
            content: guild.getT('template:CONTEXT.USER_INFO', {
                user: targetUser.tag,
                id: targetUser.id,
                created: `<t:${Math.floor(targetUser.createdTimestamp / 1000)}:R>`
            }),
            ephemeral: true
        });
    }
};
