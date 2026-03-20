/**
 * IPC Event: dashboard:SET_SUPPORTER_ROLE
 * Weist kosmetische Discord Supporter-Roles (Farbe + Hoist) auf allen Servern zu.
 * Kern-IPC-Signatur: async (payload, discordClient) => result
 * 
 * @author FireBot Team
 */

const { ServiceManager } = require('dunebot-core');
const { PermissionFlagsBits } = require('discord.js');

/**
 * Badge-Level → kosmetische Discord-Rolle (nur Farbe, keine Permissions)
 */
const BADGE_ROLE_NAMES = {
    platinum: '🏆 Platinum Supporter',
    gold: '🥇 Gold Supporter',
    silver: '🥈 Silver Supporter',
    bronze: '🥉 Bronze Supporter'
};

const BADGE_COLORS = {
    platinum: 0xE5E4E2,
    gold: 0xFFD700,
    silver: 0xC0C0C0,
    bronze: 0xCD7F32
};

module.exports = async function(payload, discordClient) {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const { userId, amount } = payload;
    
    // Badge-Level aus payload oder aus DB holen
    let badgeLevel = payload.badgeLevel || null;
    if (!badgeLevel) {
        const badges = await dbService.query(
            'SELECT badge_level FROM supporter_badges WHERE user_id = ? AND is_active = 1',
            [userId]
        );
        badgeLevel = badges?.[0]?.badge_level || null;
    }

    Logger.info(`[IPC:SetSupporterRole] Processing for user ${userId}, badge: ${badgeLevel || 'none'}`);
    
    // Alle Guilds durchgehen wo der User Mitglied ist
    const guilds = discordClient.guilds.cache.filter(guild => guild.members.cache.has(userId));
    
    if (guilds.size === 0) {
        Logger.warn(`[IPC:SetSupporterRole] User ${userId} is not in any cached guilds`);
        return { success: true, updated: 0, message: 'User not in any guilds' };
    }
    
    let updated = 0;
    let errors = 0;
    
    for (const [guildId, guild] of guilds) {
        try {
            await assignRoleInGuild(guild, userId, badgeLevel);
            updated++;
        } catch (error) {
            errors++;
            Logger.error(`[IPC:SetSupporterRole] Error in guild ${guildId}:`, error.message);
        }
    }
    
    // Badge in DB als synced markieren
    if (badgeLevel) {
        await dbService.query(
            'UPDATE supporter_badges SET discord_role_synced = 1, last_role_sync = NOW() WHERE user_id = ?',
            [userId]
        );
    }
    
    Logger.info(`[IPC:SetSupporterRole] Completed: ${updated} guilds updated, ${errors} errors`);
    return { success: true, updated, errors, guilds: guilds.size };
};

/**
 * Kosmetische Supporter-Role in einer Guild zuweisen/entfernen
 * Rollen haben NUR Farbe + Hoist, keine Permissions
 */
async function assignRoleInGuild(guild, userId, badgeLevel) {
    const Logger = ServiceManager.get('Logger');
    const member = await guild.members.fetch(userId);
    
    if (!member) {
        throw new Error(`Member ${userId} not found in guild ${guild.id}`);
    }
    
    const botMember = guild.members.me;
    if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
        Logger.warn(`[SetSupporterRole] Bot has no ManageRoles permission in guild ${guild.name}`);
        return;
    }
    
    // Alle Supporter-Roles in der Guild finden
    const allBadgeNames = Object.values(BADGE_ROLE_NAMES);
    const supporterRoles = guild.roles.cache.filter(role => allBadgeNames.includes(role.name));
    
    // Alte Supporter-Roles entfernen
    for (const [roleId, role] of supporterRoles) {
        if (member.roles.cache.has(roleId)) {
            await member.roles.remove(role, 'Supporter badge updated');
        }
    }
    
    if (!badgeLevel) return;
    
    const roleName = BADGE_ROLE_NAMES[badgeLevel];
    const roleColor = BADGE_COLORS[badgeLevel];
    if (!roleName) return;
    
    // Role finden oder erstellen (kosmetisch: nur Farbe, kein Permission)
    let supporterRole = guild.roles.cache.find(r => r.name === roleName);
    
    if (!supporterRole) {
        supporterRole = await guild.roles.create({
            name: roleName,
            color: roleColor,
            hoist: true,
            mentionable: false,
            permissions: [],  // Keine Permissions — rein kosmetisch
            reason: 'Supporter badge system (cosmetic)'
        });
        Logger.info(`[SetSupporterRole] Created cosmetic role ${roleName} in guild ${guild.name}`);
    }
    
    if (!member.roles.cache.has(supporterRole.id)) {
        await member.roles.add(supporterRole, `Supporter badge: ${badgeLevel}`);
    }
}
