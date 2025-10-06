const { ServiceManager } = require('dunebot-core');

/**
 * Beispiel für eine geteilte Helper-Funktion
 * Diese Datei kann sowohl von Message- als auch von Slash-Commands verwendet werden
 * 
 * @author DuneBot Team
 */

/**
 * Formatiert einen Text mit zusätzlichen Informationen
 * 
 * @param {string} text - Der zu formatierende Text
 * @param {import('discord.js').User} user - Discord User
 * @param {import('discord.js').Guild} guild - Discord Guild
 * @returns {string} Formatierter Text
 */
function formatExampleText(text, user, guild) {
    const Logger = ServiceManager.get('Logger');
    Logger.debug(`[Template] Formatiere Text für User ${user.tag}`);
    
    return `**${text}**\nVon: ${user.tag}\nServer: ${guild.name}`;
}

/**
 * Generiert eine Zufallszahl zwischen min und max
 * 
 * @param {number} min - Minimaler Wert
 * @param {number} max - Maximaler Wert
 * @returns {number} Zufallszahl
 */
function getRandomNumber(min = 1, max = 100) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Validiert ob ein User bestimmte Berechtigungen hat
 * 
 * @param {import('discord.js').GuildMember} member - Guild Member
 * @param {string[]} permissions - Array von Permission-Strings
 * @returns {boolean} True wenn User alle Berechtigungen hat
 */
function hasPermissions(member, permissions) {
    const Logger = ServiceManager.get('Logger');
    
    for (const permission of permissions) {
        if (!member.permissions.has(permission)) {
            Logger.debug(`[Template] User ${member.user.tag} fehlt Permission: ${permission}`);
            return false;
        }
    }
    
    return true;
}

/**
 * Lädt Konfiguration für eine Guild aus der Datenbank
 * 
 * @param {string} guildId - Guild ID
 * @param {string} configKey - Konfigurations-Key
 * @param {*} defaultValue - Standard-Wert falls nicht gesetzt
 * @returns {Promise<*>} Konfigurationswert
 */
async function getGuildConfig(guildId, configKey, defaultValue = null) {
    const dbService = ServiceManager.get('dbService');
    
    try {
        const value = await dbService.getConfig('template', configKey, 'bot', guildId);
        return value !== null ? value : defaultValue;
    } catch (error) {
        const Logger = ServiceManager.get('Logger');
        Logger.error(`[Template] Fehler beim Laden der Config ${configKey}:`, error);
        return defaultValue;
    }
}

module.exports = {
    formatExampleText,
    getRandomNumber,
    hasPermissions,
    getGuildConfig
};
