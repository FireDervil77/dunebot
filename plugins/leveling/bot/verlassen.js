'use strict';

/**
 * Leveling: Wer geht, wird vermerkt; wer wiederkommt, gestrichen
 * (LV-1i Teil 2, K382, 2026-11-15).
 *
 * Nur wenn die Guild „XP beim Verlassen löschen“ gewählt hat (Seite
 * Datenverwaltung). Gelöscht wird erst nach der Frist, nachts im Dashboard
 * (`dashboard/verlassen.js`, Zeitplan `leveling:verlassen`). Eine Abfrage je
 * Ereignis, ohne Zwischenspeicher: Ist die Einstellung „behalten“, schreibt
 * das INSERT … SELECT nichts.
 *
 * Kommt `guildMemberRemove` für ein ungecachtes Mitglied, ist es ein Partial
 * (G-13): Gebraucht werden nur `id` und `guild.id`, die stehen immer drin.
 * Ist der Bot beim Verlassen offline, fehlt der Vermerk, und die XP bleiben.
 *
 * @module leveling/bot/verlassen
 */

const { ServiceManager } = require('dunebot-core');

/** @param {import('discord.js').GuildMember|import('discord.js').PartialGuildMember} member */
async function beimVerlassen(member) {
    const guildId = member?.guild?.id;
    if (!guildId || !member.id || member.user?.bot) return;
    try {
        await ServiceManager.get('dbService').query(
            `INSERT INTO level_verlassen (guild_id, mitglied_id, am)
             SELECT guild_id, ?, NOW(3) FROM level_einstellungen WHERE guild_id = ? AND verlassen = 'loeschen'
             ON DUPLICATE KEY UPDATE am = VALUES(am)`,
            [String(member.id), String(guildId)]);
    } catch (error) {
        ServiceManager.get('Logger').error(`[Leveling] Verlassen von ${member.id} in ${guildId} nicht vermerkt:`, error);
    }
}

/** @param {import('discord.js').GuildMember} member */
async function beimBeitritt(member) {
    const guildId = member?.guild?.id;
    if (!guildId || !member.id || member.user?.bot) return;
    try {
        await ServiceManager.get('dbService').query(
            'DELETE FROM level_verlassen WHERE guild_id = ? AND mitglied_id = ?', [String(guildId), String(member.id)]);
    } catch (error) {
        ServiceManager.get('Logger').error(`[Leveling] Rückkehr von ${member.id} in ${guildId} nicht gestrichen:`, error);
    }
}

module.exports = { beimVerlassen, beimBeitritt };
