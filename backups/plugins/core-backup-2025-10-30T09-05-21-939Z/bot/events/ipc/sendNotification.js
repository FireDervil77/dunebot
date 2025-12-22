/**
 * IPC Event: SEND_NOTIFICATION
 * Sendet eine mehrsprachige Notification an Discord (Channel oder DM)
 * 
 * @param {Object} payload - Notification-Daten vom Dashboard
 * @param {Discord.Client} client - Discord.js Client
 * @returns {Promise<Object>} Erfolgs-Status mit Message-IDs
 * 
 * @author FireBot Team
 */

const { ServiceManager } = require('dunebot-core');
const { EmbedBuilder } = require('discord.js');

module.exports = async (payload, client) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    
    try {
        Logger.debug('[IPC] sendNotification aufgerufen mit Payload:', payload);
        
        const {
            id,
            title_translations,
            message_translations,
            action_text_translations,
            type,
            action_url,
            delivery_method,
            target_guild_ids,
            discord_channel_id
        } = payload;
        
        // Parse JSON-Felder
        const titleTranslations = typeof title_translations === 'string' 
            ? JSON.parse(title_translations) 
            : title_translations;
        const messageTranslations = typeof message_translations === 'string' 
            ? JSON.parse(message_translations) 
            : message_translations;
        const actionTextTranslations = typeof action_text_translations === 'string' 
            ? JSON.parse(action_text_translations) 
            : action_text_translations;
        const targetGuildIds = typeof target_guild_ids === 'string' 
            ? JSON.parse(target_guild_ids) 
            : (target_guild_ids || []);
        
        // Tracking für gesendete Messages
        const sentMessageIds = {};
        
        // Embed-Farben je nach Type
        const embedColors = {
            info: 0x3498db,     // Blau
            warning: 0xf39c12,  // Orange
            error: 0xe74c3c,    // Rot
            success: 0x2ecc71   // Grün
        };
        
        // Über alle Ziel-Guilds iterieren
        for (const guildId of targetGuildIds) {
            const guild = client.guilds.cache.get(guildId);
            if (!guild) {
                Logger.warn(`[IPC] Guild ${guildId} nicht im Cache, überspringe`);
                continue;
            }
            
            // Guild-Locale aus Datenbank laden
            const [guildLocaleRow] = await dbService.query(
                "SELECT config_value FROM configs WHERE plugin_name = 'core' AND config_key = 'LOCALE' AND guild_id = ? AND context = 'shared'",
                [guildId]
            );
            
            const guildLocale = guildLocaleRow?.config_value || 'de-DE';
            Logger.debug(`[IPC] Guild ${guild.name} hat Locale: ${guildLocale}`);
            
            // Wähle richtige Übersetzung basierend auf Guild-Locale
            const title = titleTranslations[guildLocale] || titleTranslations['de-DE'] || 'Notification';
            const message = messageTranslations[guildLocale] || messageTranslations['de-DE'] || '';
            const actionText = actionTextTranslations[guildLocale] || actionTextTranslations['de-DE'] || 'Mehr erfahren';
            
            // Embed erstellen
            const embed = new EmbedBuilder()
                .setTitle(title)
                .setDescription(message)
                .setColor(embedColors[type] || embedColors.info)
                .setTimestamp()
                .setFooter({ text: `Notification #${id}` });
            
            // Action URL hinzufügen (falls vorhanden)
            if (action_url) {
                embed.addFields({
                    name: actionText,
                    value: `[🔗 ${action_url}](${action_url})`,
                    inline: false
                });
            }
            
            // Je nach Delivery-Methode senden
            if (delivery_method === 'discord_channel' || delivery_method === 'all') {
                // An Channel senden
                let targetChannel;
                
                // Wenn custom channel_id, nutze diesen
                if (discord_channel_id) {
                    targetChannel = guild.channels.cache.get(discord_channel_id);
                } else {
                    // Sonst System-Channel
                    targetChannel = guild.systemChannel;
                }
                
                if (targetChannel && targetChannel.isTextBased()) {
                    try {
                        const sentMessage = await targetChannel.send({ embeds: [embed] });
                        sentMessageIds[guildId] = sentMessageIds[guildId] || {};
                        sentMessageIds[guildId].channel = sentMessage.id;
                        Logger.debug(`[IPC] Notification an Channel ${targetChannel.name} in ${guild.name} gesendet`);
                    } catch (channelError) {
                        Logger.error(`[IPC] Fehler beim Senden an Channel in ${guild.name}:`, channelError);
                    }
                } else {
                    Logger.warn(`[IPC] Kein gültiger Channel für Guild ${guild.name} gefunden`);
                }
            }
            
            if (delivery_method === 'discord_dm' || delivery_method === 'all') {
                // An alle Admins per DM senden
                try {
                    // Hole alle Members mit ManageGuild-Permission
                    const members = await guild.members.fetch();
                    const admins = members.filter(member => 
                        member.permissions.has('ManageGuild') && !member.user.bot
                    );
                    
                    Logger.debug(`[IPC] Sende DMs an ${admins.size} Admins in ${guild.name}`);
                    
                    const dmIds = [];
                    for (const [memberId, member] of admins) {
                        try {
                            const dmChannel = await member.createDM();
                            const sentDM = await dmChannel.send({ embeds: [embed] });
                            dmIds.push(sentDM.id);
                            Logger.debug(`[IPC] DM an ${member.user.tag} gesendet`);
                        } catch (dmError) {
                            Logger.warn(`[IPC] Konnte keine DM an ${member.user.tag} senden:`, dmError.message);
                        }
                    }
                    
                    if (dmIds.length > 0) {
                        sentMessageIds[guildId] = sentMessageIds[guildId] || {};
                        sentMessageIds[guildId].dms = dmIds;
                    }
                } catch (membersError) {
                    Logger.error(`[IPC] Fehler beim Abrufen der Members in ${guild.name}:`, membersError);
                }
            }
        }
        
        // Tracking in Datenbank speichern
        if (Object.keys(sentMessageIds).length > 0) {
            await dbService.query(`
                UPDATE notifications 
                SET sent_to_discord = 1,
                    discord_message_ids = ?
                WHERE id = ?
            `, [JSON.stringify(sentMessageIds), id]);
            
            Logger.info(`[IPC] Notification #${id} erfolgreich an ${Object.keys(sentMessageIds).length} Guilds gesendet`);
        }
        
        return {
            success: true,
            sentToGuilds: Object.keys(sentMessageIds).length,
            messageIds: sentMessageIds
        };
        
    } catch (error) {
        Logger.error('[IPC] Fehler in sendNotification:', error);
        return {
            success: false,
            error: error.message
        };
    }
};
