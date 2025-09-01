import { handlePrefixCommand } from "../handler";
import { ServiceManager } from "dunebot-core";
import { parseJsonArray } from "dunebot-sdk/utils";

/**
 * Event-Handler für messageCreate-Event
 * @param {import('discord.js').Message} message - Die empfangene Nachricht
 * @param {import('dunebot-sdk').BotPlugin} plugin - Das Core-Plugin
 */
export default async (message, plugin) => {
    const dbService = ServiceManager.get("dbService");
    const Logger = ServiceManager.get("Logger");
    
    message.received_at = Date.now();
    message.isCommand = false;
    if (!message.guild || message.author.bot) return;
    const guild = message.guild;

    try {
        // Sicheren Zugriff auf die Konfiguration implementieren
        let config, settings;
        
        try {
            // Versuchen, Konfiguration und Settings parallel zu laden
            if (plugin && typeof plugin.getConfig === 'function') {
                [config, settings] = await Promise.all([
                    plugin.getConfig(),
                    dbService.getSettings(guild.id) // Verwende guild.id statt guild-Objekt
                ]);
            } else {
                // Fallback, wenn plugin nicht verfügbar ist
                Logger.warn("Plugin nicht verfügbar in messageCreate, verwende Fallback-Methode");
                
                // Versuchen, über den PluginManager auf das Core-Plugin zuzugreifen
                const corePlugin = message.client.pluginManager.getPlugin("core");
                if (corePlugin && typeof corePlugin.getConfig === 'function') {
                    [config, settings] = await Promise.all([
                        corePlugin.getConfig(),
                        dbService.getSettings(guild.id)
                    ]);
                } else {
                    // Letzter Fallback: Standard-Konfiguration verwenden
                    config = {
                        "PREFIX_COMMANDS": {
                            "ENABLED": true,
                            "DEFAULT_PREFIX": "!"
                        },
                        "ENABLED_PLUGINS": ["core"]
                    };
                    settings = await dbService.getSettings(guild.id);
                }
            }
        } catch (configError) {
            Logger.error("Fehler beim Laden der Konfiguration:", configError);
            // Minimale Konfiguration als Fallback
            config = {
                "PREFIX_COMMANDS": {
                    "ENABLED": true,
                    "DEFAULT_PREFIX": "!"
                }
            };
            settings = settings || {};
        }

        // Wenn Prefix-Befehle deaktiviert sind, früh abbrechen
        if (!config["PREFIX_COMMANDS"]?.["ENABLED"]) return;

        // Parse enabled_plugins aus den Settings (robust)
        const enabledPlugins = parseJsonArray(settings?.enabled_plugins, ['core']);
        const disabledSlash = parseJsonArray(settings?.disabled_slash, []);

        // Standard-Prefix verwenden, wenn kein Prefix definiert ist
        const prefix = settings?.prefix || config.PREFIX_COMMANDS?.DEFAULT_PREFIX || "!";

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
                // Prüfen, ob das Plugin aktiviert ist
                if (!enabledPlugins.includes(cmd.plugin.name)) return;

                // Prüfen, ob der Befehl deaktiviert ist
                const disabledPrefix = parseJsonArray(settings?.disabled_prefix, []);
                if (disabledPrefix.includes(cmd.name)) return;

                message.isCommand = true;
                handlePrefixCommand(message, cmd, prefix);
            }
        }
    } catch (error) {
        Logger.error("Fehler bei der Verarbeitung der Nachricht:", error);
    }
};