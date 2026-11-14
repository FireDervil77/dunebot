'use strict';

const { ServiceManager } = require('dunebot-core');
const Rollen = require('dunebot-sdk/lib/Rollen');

/**
 * Kern-Event: guildMemberRemove — wer geht, verliert in Discord alle Rollen,
 * also gehen auch seine Einträge in `rollen_vergaben` (G-07, F-G12).
 *
 * Kommt seit G-13 auch für ungecachte Mitglieder (als Partial); die ID reicht.
 *
 * @param {import('discord.js').GuildMember} mitglied
 */
module.exports = async (mitglied) => {
    if (!mitglied?.guild?.id || !mitglied.id) return;
    try {
        await Rollen.vergiss(mitglied.guild.id, { mitgliedId: mitglied.id });
    } catch (error) {
        ServiceManager.get('Logger').error(`[Rollen] Einträge von ${mitglied.id} in ${mitglied.guild.id} nach dem Verlassen nicht gelöscht:`, error);
    }
};
