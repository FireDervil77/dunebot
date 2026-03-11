const { handlePrefixCommand } = require("../handler.js");
const { parseJsonArray } = require("dunebot-sdk/utils");
const { ServiceManager } = require("dunebot-core");

/**
 * Event-Handler für messageCreate-Event
 * @param {import('discord.js').Message} message - Die empfangene Nachricht
 * @param {import('dunebot-sdk').BotPlugin} plugin - Das Core-Plugin
 */
module.exports = async (message, plugin) => {
    const dbService = ServiceManager.get("dbService");
    const Logger = ServiceManager.get("Logger");
    
    message.received_at = Date.now();
    message.isCommand = false;
    if (!message.guild || message.author.bot) return;
    const guild = message.guild;
    
    // =====================================================
    // SICHERHEITSCHECK: Nur bekannte Guilds erlauben
    // =====================================================
    
    // 1. Guild muss im Discord-Cache sein
    const isInCache = message.client.guilds.cache.has(guild.id);
    if (!isInCache) {
        Logger.error(`❌ MESSAGE von unbekannter Guild: ${guild.id} (${guild.name})`);
        Logger.error(`Bot kennt nur: ${Array.from(message.client.guilds.cache.keys()).join(', ')}`);
        return; // Keine Antwort bei Nachrichten
    }
    
    // 2. Guild muss in Datenbank sein
    const [guildInDB] = await dbService.query(
        "SELECT 1 FROM guilds WHERE _id = ? LIMIT 1",
        [guild.id]
    );
    
    if (!guildInDB) {
        Logger.error(`❌ MESSAGE von nicht-registrierter Guild: ${guild.id} (${guild.name})`);
        return; // Keine Antwort bei Nachrichten
    }
    
    Logger.debug(`✅ Message von valider Guild: ${guild.name} (${guild.id})`);

    try {
        // Konfiguration über das neue Config-System laden
        const configs = await dbService.getConfigs(guild.id, "core", "shared");
        
        // Wenn keine Configs gefunden wurden, Standard-Konfiguration verwenden
        if (!configs) {
            Logger.warn(`Keine Konfiguration für Guild ${guild.id} gefunden, verwende Standards`);
        }

        // Prefix-Commands-Status prüfen
        const prefixCommandsEnabled = configs?.PREFIX_COMMANDS_ENABLED ?? true;
        if (!prefixCommandsEnabled) return;

        // NEU: Aktivierte Plugins aus guild_plugins laden
        const enabledPlugins = await dbService.getEnabledPlugins(guild.id);
        
        // Deaktivierte Befehle aus der Config laden
        const disabledPrefix = configs?.DISABLED_PREFIX || [];

        // Prefix aus der Config laden
        const prefix = configs?.PREFIX_COMMANDS_PREFIX || "!";

        // Überprüfen auf Bot-Erwähnung
        if (message.content?.includes(`<@${guild.client.user.id}>`)) {
            message.channel.send(`> Mein Prefix ist \`${prefix}\``);
            return;
        }

        // Prefix-Befehl verarbeiten
        if (message.content && message.content.startsWith(prefix)) {
            const invoke = message.content.replace(`${prefix}`, "").trim().split(/\s+/)[0];
            const cmd = guild.client.commandManager.findPrefixCommand(invoke);
            
            if (cmd) {
                // Prüfen, ob das Plugin aktiviert ist (kern-Commands sind immer aktiv)
                if (cmd.plugin.name !== 'kern' && !enabledPlugins.includes(cmd.plugin.name)) {
                    Logger.debug(`Command ${cmd.name} ignoriert - Plugin ${cmd.plugin.name} nicht aktiviert`);
                    return;
                }

                // Prüfen, ob der Befehl deaktiviert ist
                if (disabledPrefix.includes(cmd.name)) {
                    Logger.debug(`Command ${cmd.name} ignoriert - In Guild deaktiviert`);
                    return;
                }

                message.isCommand = true;
                await handlePrefixCommand(message, cmd, prefix);
            }
        }
    } catch (error) {
        Logger.error("Fehler bei der Verarbeitung der Nachricht:", error);
    }
};
