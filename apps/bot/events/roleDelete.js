'use strict';

const { ServiceManager } = require('dunebot-core');
const Rollen = require('dunebot-sdk/lib/Rollen');

/**
 * Kern-Event: roleDelete — eine gelöschte Rolle trägt niemand mehr, ihre
 * Einträge in `rollen_vergaben` gehen (G-07, F-G12).
 *
 * @param {import('discord.js').Role} rolle
 */
module.exports = async (rolle) => {
    if (!rolle?.guild?.id || !rolle.id) return;
    try {
        await Rollen.vergiss(rolle.guild.id, { rollen: [rolle.id] });
    } catch (error) {
        ServiceManager.get('Logger').error(`[Rollen] Einträge der gelöschten Rolle ${rolle.id} in ${rolle.guild.id} nicht gelöscht:`, error);
    }
};
