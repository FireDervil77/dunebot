const { ServiceManager } = require("dunebot-core");

/**
 * Ready-Event für den Bot
 * Wird ausgeführt, wenn der Bot sich bei Discord angemeldet hat
 * Initialisiert Guilds, lädt Einstellungen und registriert Befehle
 * 
 * @author firedervil
 * @param {import('discord.js').Client} client
 */
module.exports = async (client) => {
    const dbService = ServiceManager.get("dbService");
    const Logger = ServiceManager.get('Logger');
    
    Logger.success(`Logged in as ${client.user.tag}! (${client.user.id})`);
    Logger.info(`Serving ${client.guilds.cache.size} servers`);

    // Core-Plugin-Instanz abrufen
    const corePlugin = client.pluginManager.getPlugin("core");
    if (!corePlugin) {
        throw new Error("Core plugin not found in ready.js");
    }

    // Bot-Sprache aus der Konfiguration laden
    const config = await client.coreConfig();
    client.defaultLanguage = config?.LOCALE?.DEFAULT || "de-DE";

    // Guild-Einstellungen laden und Sprache setzen
    for (const guild of client.guilds.cache.values()) {
        const settings = await dbService.getSettings(guild.id);
        guild.locale = settings?.locale || client.defaultLanguage;
    }

    // Guilds in der Datenbank initialisieren/aktualisieren
    for (const guild of client.guilds.cache.values()) {
        try {
            // Guild-Besitzer abrufen, wenn nicht im Cache
            const owner = guild.members.cache.get(guild.ownerId) || 
                        await guild.members.fetch(guild.ownerId).catch(() => null);
            
            // Mit MySQL-kompatiblem DBService - an die tatsächliche DB-Struktur angepasst
            await dbService.upsertGuild({
                _id: guild.id,
                name: guild.name,  // wird in upsertGuild zu guild_name gemapped
                owner_id: guild.ownerId,
                owner_name: owner?.user.username || null,
                joined_at: guild.joinedAt ? new Date(guild.joinedAt) : new Date(),
                left_at: null
            });
            
            Logger.debug(`Guild "${guild.name}" (${guild.id}) in Datenbank initialisiert`);
        } catch (error) {
            Logger.error(`Fehler beim Initialisieren der Guild ${guild.name}:`, error);
        }
    }

    // Interaktionen registrieren mit Verzögerung
    client.wait(5000).then(() => {
        client.guilds.cache.forEach(async (guild) => {
            await client.commandManager.registerInteractions(guild.id);
        });
        Logger.success("Interaktionen erfolgreich registriert");
    });
};