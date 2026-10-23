const { ServiceManager } = require('dunebot-core');

/**
 * Invite Tracker - Caches guild invites and detects which invite was used
 * Used by guildMemberAdd to provide conditional greetings
 */

// Cache: Map<guildId, Map<inviteCode, { uses: number }>>
const inviteCache = new Map();

/**
 * Initialize invite cache for a guild
 *
 * Gefüllt wird je Guild aus `onGuildEnable` (index.js) — beim Start für jede
 * Guild mit aktivem Greeting und beim späteren Einschalten. Bis 2026-10-23
 * tat das ein `events/ready.js`, den der PluginManager nie erreichte (das
 * Plugin-"ready" trägt keine Guild, also läuft dort nur `core`). Der Speicher
 * blieb leer, `detectUsedInvite` lieferte immer null, und keine
 * Einladungs-Zuordnung hat je gegriffen.
 *
 * @param {import('discord.js').Guild} guild
 * @returns {Promise<boolean>} ob der Speicher gefüllt wurde
 */
async function cacheGuildInvites(guild) {
    try {
        const invites = await guild.invites.fetch();
        const guildCache = new Map();
        invites.forEach(invite => {
            guildCache.set(invite.code, { uses: invite.uses || 0 });
        });
        inviteCache.set(guild.id, guildCache);
        return true;
    } catch (err) {
        // Meist fehlt dem Bot „Server verwalten" — ohne das sieht er keine Einladungen.
        const Logger = ServiceManager.get('Logger');
        Logger.warn(`[Greeting] Einladungen von ${guild.name} (${guild.id}) nicht lesbar, Einladungs-Zuordnung greift dort nicht: ${err.message}`);
        return false;
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
        if (!oldCache) {
            // Ohne Vergleichsstand lässt sich dieser Beitritt nicht zuordnen —
            // aber der nächste, wenn der Stand jetzt angelegt wird.
            await cacheGuildInvites(guild);
            return null;
        }

        const currentInvites = await guild.invites.fetch();
        const newCache = new Map();

        let usedCode = null;
        currentInvites.forEach(invite => {
            newCache.set(invite.code, { uses: invite.uses || 0 });
            const oldInvite = oldCache.get(invite.code);
            // Eine nach dem letzten Stand angelegte Einladung fehlt im alten
            // Speicher; trägt sie schon Nutzungen, war es diese.
            const vorher = oldInvite ? oldInvite.uses : 0;
            if ((invite.uses || 0) > vorher) {
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
