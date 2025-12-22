const { EmbedUtils, Logger } = require("dunebot-sdk/utils");
const { AutoModSettings, AutoModRaidEvents } = require("../../shared/models");

/**
 * Raid-Join-Tracking Cache
 * guild_id → [{ userId, timestamp, accountAge, inviteCode }]
 */
const raidJoinCache = new Map();

/**
 * Cleanup Cache alle 60 Sekunden (entfernt alte Einträge)
 */
setInterval(() => {
    const now = Date.now();
    raidJoinCache.forEach((joins, guildId) => {
        // Entferne Joins älter als 60 Sekunden
        const filtered = joins.filter(j => now - j.timestamp < 60000);
        if (filtered.length === 0) {
            raidJoinCache.delete(guildId);
        } else {
            raidJoinCache.set(guildId, filtered);
        }
    });
}, 60000);

/**
 * GuildMemberAdd Event Handler - Raid Protection
 * Erkennt Raids, kickt verdächtige User, aktiviert Lockdown
 * 
 * @param {import("discord.js").GuildMember} member - Der User der gejoined ist
 */
module.exports = async (member) => {
    const { guild, user } = member;
    
    try {
        // Settings laden
        const settings = await AutoModSettings.getSettings(guild.id);
        
        // Raid-Protection deaktiviert?
        if (!settings.raid_protection_enabled) return;
        
        // Bot-Permissions prüfen
        if (!guild.members.me.permissions.has("KickMembers")) {
            Logger.warn(`[AutoMod Raid] Keine Kick-Permission in Guild ${guild.name}`);
            return;
        }
        
        // Account-Age berechnen
        const accountAge = Date.now() - user.createdTimestamp;
        const accountAgeDays = Math.floor(accountAge / (1000 * 60 * 60 * 24));
        
        // Invite-Code ermitteln (wenn möglich)
        let inviteCode = null;
        let isTrustedInvite = false;
        
        try {
            const invites = await guild.invites.fetch();
            const cachedInvites = guild.invitesCache || new Map();
            
            // Vergleiche Invite-Uses
            invites.forEach(invite => {
                const cachedUses = cachedInvites.get(invite.code) || 0;
                if (invite.uses > cachedUses) {
                    inviteCode = invite.code;
                    cachedInvites.set(invite.code, invite.uses);
                }
            });
            
            guild.invitesCache = cachedInvites;
            
            // Ist es ein Trusted Invite?
            if (inviteCode && settings.raid_trusted_invites.includes(inviteCode)) {
                isTrustedInvite = true;
                Logger.debug(`[AutoMod Raid] User ${user.tag} joined via trusted invite: ${inviteCode}`);
                
                // Event loggen
                await AutoModRaidEvents.logEvent(guild.id, 'JOIN_SPIKE', {
                    userId: user.id,
                    userTag: user.tag,
                    accountCreatedAt: user.createdAt,
                    inviteCode,
                    actionTaken: 'WHITELISTED',
                    metadata: { accountAgeDays, trusted: true }
                });
                
                return; // Trusted Invite → Kein Raid-Check
            }
        } catch (err) {
            Logger.warn(`[AutoMod Raid] Konnte Invite-Code nicht ermitteln:`, err.message);
        }
        
        // Join-Event zum Cache hinzufügen
        if (!raidJoinCache.has(guild.id)) {
            raidJoinCache.set(guild.id, []);
        }
        
        const joins = raidJoinCache.get(guild.id);
        joins.push({
            userId: user.id,
            timestamp: Date.now(),
            accountAge: accountAgeDays,
            inviteCode
        });
        
        // ========================================
        // CHECK 1: Account-Age zu jung?
        // ========================================
        if (accountAgeDays < settings.raid_min_account_age_days) {
            Logger.info(`[AutoMod Raid] Junger Account detected: ${user.tag} (${accountAgeDays} Tage alt)`);
            
            // Event loggen
            await AutoModRaidEvents.logEvent(guild.id, 'YOUNG_ACCOUNT', {
                userId: user.id,
                userTag: user.tag,
                accountCreatedAt: user.createdAt,
                inviteCode,
                actionTaken: settings.raid_action,
                metadata: { accountAgeDays, minRequired: settings.raid_min_account_age_days }
            });
            
            // Aktion durchführen
            if (settings.raid_action === 'KICK') {
                await member.kick(`[AutoMod Raid] Account zu jung (${accountAgeDays}/${settings.raid_min_account_age_days} Tage)`);
                Logger.info(`[AutoMod Raid] Kicked ${user.tag} (zu junger Account)`);
            }
            // BAN wird manuell gemacht (laut User-Wunsch)
            
            // Alert senden
            await sendRaidAlert(guild, settings, 'YOUNG_ACCOUNT', {
                user,
                accountAgeDays,
                action: settings.raid_action
            });
        }
        
        // ========================================
        // CHECK 2: Join-Spike Detection
        // ========================================
        const now = Date.now();
        const recentJoins = joins.filter(j => now - j.timestamp < settings.raid_join_timespan * 1000);
        
        if (recentJoins.length >= settings.raid_join_threshold) {
            Logger.warn(`[AutoMod Raid] 🚨 RAID DETECTED in ${guild.name}! ${recentJoins.length} joins in ${settings.raid_join_timespan}s`);
            
            // Event loggen
            await AutoModRaidEvents.logEvent(guild.id, 'RAID_DETECTED', {
                metadata: {
                    joinsCount: recentJoins.length,
                    timespan: settings.raid_join_timespan,
                    threshold: settings.raid_join_threshold,
                    users: recentJoins.map(j => j.userId)
                }
            });
            
            // Alert senden (mit @Mods wenn aktiviert)
            await sendRaidAlert(guild, settings, 'RAID_DETECTED', {
                joinsCount: recentJoins.length,
                timespan: settings.raid_join_timespan
            });
            
            // Lockdown aktivieren?
            if (settings.raid_lockdown_enabled && !settings.raid_lockdown_active) {
                await activateLockdown(guild, settings);
            }
            
            // Alle Recent Joins kicken (außer Trusted Invites)
            for (const join of recentJoins) {
                try {
                    const memberToKick = await guild.members.fetch(join.userId);
                    if (memberToKick && settings.raid_action === 'KICK') {
                        await memberToKick.kick('[AutoMod Raid] Raid-Detection - Auto-Kick');
                        Logger.info(`[AutoMod Raid] Kicked ${memberToKick.user.tag} (Raid-Detection)`);
                    }
                } catch (err) {
                    Logger.warn(`[AutoMod Raid] Konnte User ${join.userId} nicht kicken:`, err.message);
                }
            }
            
            // Cache leeren nach Raid-Handling
            raidJoinCache.set(guild.id, []);
        }
        
    } catch (error) {
        Logger.error('[AutoMod Raid] Fehler im guildMemberAdd Handler:', error);
    }
};

/**
 * Sendet Raid-Alert in konfigurierten Channel
 * 
 * @param {import("discord.js").Guild} guild
 * @param {Object} settings
 * @param {string} alertType - 'YOUNG_ACCOUNT' | 'RAID_DETECTED'
 * @param {Object} data
 */
async function sendRaidAlert(guild, settings, alertType, data) {
    if (!settings.raid_alert_channel) return;
    
    try {
        const alertChannel = guild.channels.cache.get(settings.raid_alert_channel);
        if (!alertChannel) return;
        
        let embed, content = '';
        
        if (alertType === 'YOUNG_ACCOUNT') {
            embed = EmbedUtils.embed()
                .setColor('#FFA500')
                .setTitle('⚠️ Junger Account Detected')
                .setDescription(`Ein sehr junger Discord-Account ist dem Server beigetreten.`)
                .addFields([
                    { name: 'User', value: `${data.user.tag} (${data.user.id})`, inline: true },
                    { name: 'Account-Alter', value: `${data.accountAgeDays} Tage`, inline: true },
                    { name: 'Mindest-Alter', value: `${settings.raid_min_account_age_days} Tage`, inline: true },
                    { name: 'Aktion', value: data.action === 'KICK' ? '👢 Gekickt' : '⏳ Keine', inline: false }
                ])
                .setTimestamp();
        } else if (alertType === 'RAID_DETECTED') {
            embed = EmbedUtils.embed()
                .setColor('#FF0000')
                .setTitle('🚨 RAID DETECTED!')
                .setDescription(`**Massiver Join-Spike erkannt!**\n\n${data.joinsCount} User sind innerhalb von ${data.timespan} Sekunden beigetreten.`)
                .addFields([
                    { name: 'Joins', value: data.joinsCount.toString(), inline: true },
                    { name: 'Zeitfenster', value: `${data.timespan}s`, inline: true },
                    { name: 'Aktion', value: settings.raid_action === 'KICK' ? '👢 Auto-Kick' : '📋 Log only', inline: true }
                ])
                .setTimestamp();
            
            // @Mods erwähnen?
            if (settings.raid_alert_mention_mods) {
                // Finde Mod-Rollen (Rollen mit KICK_MEMBERS oder BAN_MEMBERS)
                const modRoles = guild.roles.cache.filter(role => 
                    role.permissions.has(['KickMembers']) || role.permissions.has(['BanMembers'])
                );
                
                if (modRoles.size > 0) {
                    content = modRoles.map(r => r.toString()).join(' ') + ' **RAID ALERT!**';
                } else {
                    content = '@here **RAID ALERT!**';
                }
            }
        }
        
        await alertChannel.send({ content, embeds: [embed] });
        Logger.info(`[AutoMod Raid] Alert gesendet in ${alertChannel.name}`);
        
    } catch (error) {
        Logger.error('[AutoMod Raid] Fehler beim Senden des Alerts:', error);
    }
}

/**
 * Aktiviert Lockdown-Modus
 * Setzt Verification auf HIGH und entfernt @everyone Permissions
 * 
 * @param {import("discord.js").Guild} guild
 * @param {Object} settings
 */
async function activateLockdown(guild, settings) {
    try {
        Logger.warn(`[AutoMod Raid] 🔒 LOCKDOWN aktiviert für ${guild.name}`);
        
        // Verification Level auf HIGHEST setzen
        await guild.setVerificationLevel(4, '[AutoMod Raid] Lockdown aktiviert');
        
        // @everyone Permissions backupen und entfernen
        const everyoneRole = guild.roles.everyone;
        const originalPerms = everyoneRole.permissions.toArray();
        
        // Permissions entfernen: Schreiben, Reagieren, Sprechen
        await everyoneRole.setPermissions(
            everyoneRole.permissions.remove([
                'SendMessages',
                'SendMessagesInThreads',
                'AddReactions',
                'Speak',
                'Stream'
            ]),
            '[AutoMod Raid] Lockdown - Permissions temporär entfernt'
        );
        
        // Lockdown-State in DB setzen
        await AutoModSettings.updateSettings(guild.id, { 
            raid_lockdown_active: true 
        });
        
        // Event loggen
        await AutoModRaidEvents.logEvent(guild.id, 'LOCKDOWN_ACTIVATED', {
            metadata: { originalPerms }
        });
        
        // Alert senden
        if (settings.raid_alert_channel) {
            const alertChannel = guild.channels.cache.get(settings.raid_alert_channel);
            if (alertChannel) {
                const embed = EmbedUtils.embed()
                    .setColor('#8B0000')
                    .setTitle('🔒 LOCKDOWN AKTIVIERT')
                    .setDescription('Der Server wurde aufgrund eines Raids gesperrt.\n\n**Maßnahmen:**\n✅ Verification Level: HIGHEST\n✅ @everyone Permissions entfernt\n\n**Entsperren:** Nutze `/automod unlock` oder das Dashboard.')
                    .setTimestamp();
                
                await alertChannel.send({ embeds: [embed] });
            }
        }
        
        Logger.success(`[AutoMod Raid] Lockdown erfolgreich aktiviert`);
        
    } catch (error) {
        Logger.error('[AutoMod Raid] Fehler beim Aktivieren des Lockdowns:', error);
    }
}

/**
 * Deaktiviert Lockdown-Modus (wird von Command/Dashboard aufgerufen)
 * NICHT automatisch - nur manuell!
 * 
 * @param {import("discord.js").Guild} guild
 */
async function deactivateLockdown(guild) {
    try {
        Logger.info(`[AutoMod Raid] 🔓 LOCKDOWN deaktiviert für ${guild.name}`);
        
        // Verification Level zurücksetzen (auf LOW)
        await guild.setVerificationLevel(1, '[AutoMod Raid] Lockdown deaktiviert');
        
        // @everyone Permissions wiederherstellen
        // Hole letzte Lockdown-Event für Original-Perms
        const events = await AutoModRaidEvents.getRecentEvents(guild.id, 100);
        const lockdownEvent = events.find(e => e.event_type === 'LOCKDOWN_ACTIVATED' && e.metadata?.originalPerms);
        
        if (lockdownEvent) {
            const everyoneRole = guild.roles.everyone;
            await everyoneRole.setPermissions(
                lockdownEvent.metadata.originalPerms,
                '[AutoMod Raid] Lockdown aufgehoben - Permissions wiederhergestellt'
            );
        }
        
        // Lockdown-State in DB löschen
        await AutoModSettings.updateSettings(guild.id, { 
            raid_lockdown_active: false 
        });
        
        // Event loggen
        await AutoModRaidEvents.logEvent(guild.id, 'LOCKDOWN_DEACTIVATED');
        
        Logger.success(`[AutoMod Raid] Lockdown erfolgreich deaktiviert`);
        
    } catch (error) {
        Logger.error('[AutoMod Raid] Fehler beim Deaktivieren des Lockdowns:', error);
        throw error;
    }
}

// Export der Helper-Funktionen für Commands
module.exports.deactivateLockdown = deactivateLockdown;
