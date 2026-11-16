'use strict';

const { ServiceManager } = require('dunebot-core');
const Einladungen = require('dunebot-sdk/lib/Einladungen');

/**
 * Kern-Event: guildMemberAdd — Einladung erkennen, `mitglied_beitritte`
 * schreiben, `kern.mitglied.beigetreten` melden (G-16). In jeder Guild,
 * unabhängig von Plugins.
 *
 * greeting fragt dasselbe über `Einladungen.beitritt(member)` und bekommt
 * dasselbe Versprechen; die Reihenfolge der Handler spielt keine Rolle.
 *
 * @param {import('discord.js').GuildMember} member
 */
module.exports = async (member) => {
    if (!member?.guild?.id || !member.id) return;
    try {
        await Einladungen.beitritt(member);
    } catch (error) {
        ServiceManager.get('Logger').error(`[Einladungen] Beitritt von ${member.id} in ${member.guild.id} nicht verarbeitet:`, error);
    }
};
