const { baueNachricht, ANLAESSE } = require("../utils");
const Willkommensbild = require("../../shared/willkommensbild");
const { ServiceManager } = require('dunebot-core');
const { Rollen, Einladungen } = require('dunebot-sdk');
const { autorollen } = require('../../shared/rollen');

/** Was `Rollen.vergib` nicht setzen konnte, mit Grund ins Log. */
function meldeRollen(logger, member, was, e) {
    for (const b of e.blockiert) logger.warn(`[Greeting] ${was} ${b.name || b.rolle} für ${member.user.tag} nicht vergeben (${b.grund}${b.fehler ? `: ${b.fehler}` : ''})`);
    if (e.vergeben.length) logger.info(`[Greeting] ${was}: ${e.vergeben.length} Rolle(n) an ${member.user.tag}`);
}

/**
 * @param {import('discord.js').GuildMember} member
 */
module.exports = async (member) => {
    const dbService = ServiceManager.get('dbService');
    const logger = ServiceManager.get('Logger');

    try {
        // Die Einladung erkennt der Kern (G-16); dasselbe Versprechen wie im
        // Kern-Ereignis, erkannt wird einmal.
        const [rows, beitritt] = await Promise.all([
            dbService.query('SELECT * FROM greeting_settings WHERE guild_id = ?', [member.guild.id]),
            Einladungen.beitritt(member)
        ]);

        const settings = rows?.[0];
        if (!settings) return;

        // Eigener Text je Einladung nur, wenn sie sicher erkannt ist.
        const usedInviteCode = beitritt.sicherheit === Einladungen.SICHERHEIT.EINDEUTIG && beitritt.art === Einladungen.ART.EINLADUNG
            ? beitritt.einladung : null;
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

        // ===== Rollen beim Beitritt: über den Kern (G-07, `Rollen`) =====
        // Prüfung (Recht, Rangfolge, verwaltete Rolle) und Buch macht `Rollen`;
        // was nicht ging, steht mit Grund im Log statt still zu fehlen.
        if (settings.verification_enabled && settings.verification_remove_role_id) {
            meldeRollen(logger, member, 'unverifiziert',
                await Rollen.vergib({ mitglied: member, rollen: settings.verification_remove_role_id, besitzer: 'greeting:unverifiziert', grund: 'Beitritt, noch nicht verifiziert' }));
        }
        const autoroleIds = autorollen(settings);
        if (autoroleIds.length) {
            meldeRollen(logger, member, 'Autorolle',
                await Rollen.vergib({ mitglied: member, rollen: autoroleIds, besitzer: 'greeting:autorolle', grund: 'Autorolle beim Beitritt' }));
        }

        // ===== WELCOME MESSAGE (Channel) =====
        if (settings.welcome_enabled) {
            const channel = member.guild.channels.cache.get(settings.welcome_channel);
            if (channel) {
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
                    beitritt,
                    textStatt: inviteMapping?.welcome_content || null,
                    anhaenge
                });

                await channel.send(response);
                logger.info(`[Greeting] Sent welcome message for ${member.user.tag} in ${member.guild.name}`);
            }
        }

        // ===== DM WELCOME =====
        if (settings.dm_welcome_enabled) {
            const dmResponse = await baueNachricht(member, ANLAESSE.dm_welcome, { beitritt });

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
