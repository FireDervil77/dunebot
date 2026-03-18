const { ServiceManager } = require('dunebot-core');

/**
 * Invite Tracker - Caches guild invites and detects which invite was used
 * Used by guildMemberAdd to provide conditional greetings
 */

// Cache: Map<guildId, Map<inviteCode, { uses: number }>>
const inviteCache = new Map();

/**
 * Initialize invite cache for a guild
 * @param {import('discord.js').Guild} guild
 */
async function cacheGuildInvites(guild) {
    try {
        const invites = await guild.invites.fetch();
        const guildCache = new Map();
        invites.forEach(invite => {
            guildCache.set(invite.code, { uses: invite.uses || 0 });
        });
        inviteCache.set(guild.id, guildCache);
    } catch {
        // Bot may lack MANAGE_GUILD permission
    }
}

/**
 * Detect which invite was used by comparing cached vs current invites
 * @param {import('discord.js').Guild} guild
 * @returns {Promise<string|null>} The invite code used, or null
 */
async function detectUsedInvite(guild) {
    const Logger = ServiceManager.get('Logger');
    try {
        const oldCache = inviteCache.get(guild.id);
        if (!oldCache) return null;

        const currentInvites = await guild.invites.fetch();
        const newCache = new Map();

        let usedCode = null;
        currentInvites.forEach(invite => {
            newCache.set(invite.code, { uses: invite.uses || 0 });
            const oldInvite = oldCache.get(invite.code);
            if (oldInvite && invite.uses > oldInvite.uses) {
                usedCode = invite.code;
            }
        });

        // Update cache
        inviteCache.set(guild.id, newCache);

        if (usedCode) {
            Logger.debug(`[Greeting] Detected invite code: ${usedCode} in ${guild.name}`);
        }
        return usedCode;
    } catch (err) {
        Logger.warn(`[Greeting] Could not detect invite for ${guild.name}:`, err.message);
        return null;
    }
}

/**
 * Remove guild from cache (on guild delete/leave)
 * @param {string} guildId
 */
function removeGuildCache(guildId) {
    inviteCache.delete(guildId);
}

module.exports = {
    inviteCache,
    cacheGuildInvites,
    detectUsedInvite,
    removeGuildCache
};
