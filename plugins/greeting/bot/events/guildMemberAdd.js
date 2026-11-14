const { baueNachricht, ANLAESSE } = require("../utils");
const Willkommensbild = require("../../shared/willkommensbild");
const { detectUsedInvite } = require("../inviteTracker");
const { ServiceManager } = require('dunebot-core');

/**
 * @param {import('discord.js').GuildMember} member
 */
module.exports = async (member) => {
    const dbService = ServiceManager.get('dbService');
    const logger = ServiceManager.get('Logger');

    try {
        // Invite-Detection parallel mit Settings laden
        const [rows, usedInviteCode] = await Promise.all([
            dbService.query('SELECT * FROM greeting_settings WHERE guild_id = ?', [member.guild.id]),
            detectUsedInvite(member.guild)
        ]);

        const settings = rows?.[0];
        if (!settings) return;

        // Invite-Mapping laden falls ein Invite-Code erkannt wurde
        let inviteMapping = null;
        if (usedInviteCode) {
            const mappingRows = await dbService.query(
                'SELECT * FROM greeting_invite_mappings WHERE guild_id = ? AND invite_code = ?',
                [member.guild.id, usedInviteCode]
            );
            inviteMapping = mappingRows?.[0] || null;
            if (inviteMapping) {
                logger.info(`[Greeting] Found invite mapping for code ${usedInviteCode} in ${member.guild.name}`);
            }
        }

        // ===== VERIFICATION: Assign unverified role if enabled =====
        if (settings.verification_enabled && settings.verification_remove_role_id) {
            const unverifiedRole = member.guild.roles.cache.get(settings.verification_remove_role_id);
            if (unverifiedRole && member.guild.members.me.roles.highest.position > unverifiedRole.position && !unverifiedRole.managed) {
                await member.roles.add(unverifiedRole).catch((err) => {
                    logger.error(`[Greeting] Failed to assign unverified role to ${member.user.tag}:`, err);
                });
                logger.info(`[Greeting] Assigned unverified role to ${member.user.tag}`);
            }
        }

        // ===== MULTI-AUTOROLE =====
        let autoroleIds = [];
        if (settings.autorole_ids) {
            try {
                autoroleIds = typeof settings.autorole_ids === 'string'
                    ? JSON.parse(settings.autorole_ids)
                    : settings.autorole_ids;
            } catch { /* ignore */ }
        }
        // Fallback: altes autorole_id Feld
        if (autoroleIds.length === 0 && settings.autorole_id) {
            autoroleIds = [settings.autorole_id];
        }

        for (const roleId of autoroleIds) {
            const role = member.guild.roles.cache.get(roleId);
            if (role && member.guild.members.me.roles.highest.position > role.position && !role.managed) {
                await member.roles.add(role).catch((err) => {
                    logger.error(`[Greeting] Failed to assign autorole ${role.name} to ${member.user.tag}:`, err);
                });
            }
        }

        // ===== WELCOME MESSAGE (Channel) =====
        if (settings.welcome_enabled) {
            const channel = member.guild.channels.cache.get(settings.welcome_channel);
            if (channel) {
                const inviterData = member.inviterData || {};

                // Das Willkommensbild hängt als Datei an (Kern-Renderer, G-10; Aussehen
                // stellt die Guild unter Bildkarten ein, G-22).
                // In Components V2 steht es in der Galerie (`attachment://…`).
                const anhaenge = [];
                if (settings.welcome_image_enabled) {
                    const bild = await Willkommensbild.anhang(member, logger);
                    if (bild) anhaenge.push(bild);
                }

                // Eine Einladung mit eigenem Text ersetzt nur den Nachrichtentext
                // der Willkommensvorlage, der Rest bleibt (so war es vor G-08).
                const response = await baueNachricht(member, ANLAESSE.welcome, {
                    inviterData,
                    textStatt: inviteMapping?.welcome_content || null,
                    anhaenge
                });

                await channel.send(response);
                logger.info(`[Greeting] Sent welcome message for ${member.user.tag} in ${member.guild.name}`);
            }
        }

        // ===== DM WELCOME =====
        if (settings.dm_welcome_enabled) {
            const dmResponse = await baueNachricht(member, ANLAESSE.dm_welcome, { inviterData: member.inviterData || {} });

            try {
                await member.send(dmResponse);
                logger.info(`[Greeting] Sent DM welcome to ${member.user.tag}`);
            } catch (err) {
                logger.warn(`[Greeting] Could not send DM to ${member.user.tag} (DMs disabled?)`);
            }
        }

    } catch (error) {
        logger.error(`[Greeting] Error in guildMemberAdd event for guild ${member.guild.id}:`, error);
    }
};
