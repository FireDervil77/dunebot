/**
 * IPC Event: dashboard:SET_SUPPORTER_ROLE
 * Weist Discord Supporter-Roles auf allen Servern zu
 * 
 * @author DuneBot Development Team
 */

const { ServiceManager } = require('dunebot-core');
const { PermissionFlagsBits } = require('discord.js');

/**
 * Badge-Level zu Discord-Role-Namen Mapping
 */
const BADGE_ROLE_NAMES = {
    platinum: '🏆 Platinum Supporter',
    gold: '🥇 Gold Supporter',
    silver: '🥈 Silver Supporter',
    bronze: '🥉 Bronze Supporter'
};

/**
 * Badge-Level zu Farbe Mapping (Dezimal für Discord)
 */
const BADGE_COLORS = {
    platinum: 0xE5E4E2, // Helles Grau/Silber
    gold: 0xFFD700,     // Gold
    silver: 0xC0C0C0,   // Silber
    bronze: 0xCD7F32    // Bronze
};

module.exports = {
    name: 'dashboard:SET_SUPPORTER_ROLE',
    
    /**
     * IPC Handler für Supporter-Role-Zuweisung
     * @param {Client} client - Discord.js Client
     * @param {object} message - IPC Message mit data: { userId, badgeLevel, amount }
     * @returns {object} Result mit updated/errors
     */
    async execute(client, message) {
        const Logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');
        const { userId, badgeLevel, amount } = message.data;
        
        Logger.info(`[IPC:SetSupporterRole] Processing for user ${userId}, badge: ${badgeLevel || 'none'}`);
        
        try {
        
        // User-Objekt abrufen
        let user;
        try {
            user = await client.users.fetch(userId);
        } catch (error) {
            Logger.error(`[IPC:SetSupporterRole] User ${userId} not found:`, error);
            return reply({ success: false, error: 'User not found' });
        }
        
        // Alle Guilds durchgehen wo der User Mitglied ist
        const guilds = client.guilds.cache.filter(guild => guild.members.cache.has(userId));
        
        if (guilds.size === 0) {
            Logger.warn(`[IPC:SetSupporterRole] User ${userId} is not in any guilds`);
            return reply({ success: true, updated: 0, message: 'User not in any guilds' });
        }
        
        let updated = 0;
        let errors = 0;
        
        for (const [guildId, guild] of guilds) {
            try {
                await assignRoleInGuild(guild, userId, badgeLevel);
                updated++;
                Logger.debug(`[IPC:SetSupporterRole] Updated role in guild ${guild.name} (${guildId})`);
            } catch (error) {
                errors++;
                Logger.error(`[IPC:SetSupporterRole] Error in guild ${guildId}:`, error.message);
            }
        }
        
        // Badge in DB als synced markieren
        if (badgeLevel) {
            await dbService.query(
                'UPDATE supporter_badges SET discord_role_synced = 1, synced_at = NOW() WHERE user_id = ?',
                [userId]
            );
        }
        
        Logger.info(`[IPC:SetSupporterRole] Completed: ${updated} guilds updated, ${errors} errors`);
        
        reply({ 
            success: true, 
            updated, 
            errors,
            guilds: guilds.size 
        });
        
    } catch (error) {
        Logger.error('[IPC:SetSupporterRole] Fatal error:', error);
        reply({ success: false, error: error.message });
    }
};

/**
 * Supporter-Role in einer Guild zuweisen/entfernen
 * @param {Guild} guild - Discord Guild
 * @param {string} userId - Discord User ID
 * @param {string|null} badgeLevel - Badge-Level oder null
 */
async function assignRoleInGuild(guild, userId, badgeLevel) {
    // Member abrufen
    const member = await guild.members.fetch(userId);
    
    if (!member) {
        throw new Error(`Member ${userId} not found in guild ${guild.id}`);
    }
    
    // Bot-Permissions prüfen
    const botMember = guild.members.me;
    if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
        Logger.warn(`[SetSupporterRole] Bot has no ManageRoles permission in guild ${guild.name}`);
        return;
    }
    
    // Alle Supporter-Roles in der Guild finden
    const supporterRoles = guild.roles.cache.filter(role => 
        Object.values(BADGE_ROLE_NAMES).includes(role.name)
    );
    
    // Alte Supporter-Roles entfernen
    for (const [roleId, role] of supporterRoles) {
        if (member.roles.cache.has(roleId)) {
            await member.roles.remove(role, 'Supporter badge updated');
            Logger.debug(`[SetSupporterRole] Removed old role ${role.name} from ${userId}`);
        }
    }
    
    // Kein Badge mehr? Dann fertig
    if (!badgeLevel) {
        Logger.debug(`[SetSupporterRole] No badge level, roles removed for ${userId}`);
        return;
    }
    
    // Neue Role finden oder erstellen
    const roleName = BADGE_ROLE_NAMES[badgeLevel];
    const roleColor = BADGE_COLORS[badgeLevel];
    
    let supporterRole = guild.roles.cache.find(r => r.name === roleName);
    
    if (!supporterRole) {
        // Role erstellen
        try {
            supporterRole = await guild.roles.create({
                name: roleName,
                color: roleColor,
                hoist: true, // In Mitgliederliste separat anzeigen
                mentionable: false,
                reason: 'Supporter badge system'
            });
            
            Logger.info(`[SetSupporterRole] Created role ${roleName} in guild ${guild.name}`);
        } catch (error) {
            Logger.error(`[SetSupporterRole] Error creating role in guild ${guild.id}:`, error);
            throw error;
        }
    }
    
    // Role zuweisen
    if (!member.roles.cache.has(supporterRole.id)) {
        await member.roles.add(supporterRole, `Supporter badge: ${badgeLevel}`);
        Logger.debug(`[SetSupporterRole] Added role ${roleName} to ${userId}`);
    }
    
    // Position der Role anpassen (unter Bot-Role, aber über @everyone)
    try {
        const botRole = botMember.roles.highest;
        const desiredPosition = Math.max(1, botRole.position - 1);
        
        if (supporterRole.position !== desiredPosition) {
            await supporterRole.setPosition(desiredPosition);
        }
    } catch (error) {
        // Nicht kritisch, Role funktioniert trotzdem
        Logger.debug(`[SetSupporterRole] Could not adjust role position:`, error.message);
    }
}
