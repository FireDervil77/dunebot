'use strict';

/**
 * Leveling: Rangkarte im Bot zeichnen (LV-1g, LV-1f, 2026-11-15).
 *
 * Eine Stelle für `/rank` und die Level-up-Nachricht. Gezeichnet wird über den
 * Kern (`Bildkarte.zeichneNutzung`, G-10/G-22), nie mit eigenem Canvas.
 *
 * @module leveling/bot/karte
 */

const { ServiceManager } = require('dunebot-core');
const { Bildkarte, Fortschritt } = require('dunebot-sdk');
const Rangkarte = require('../shared/rangkarte');

/**
 * Stand und Platz eines Mitglieds, für Karte und Text.
 *
 * @param {string} guildId
 * @param {string} mitglied
 * @returns {Promise<{stand: object, platz: number|null, von: number}>}
 */
async function standUndPlatz(guildId, mitglied) {
    const [stand, pos] = await Promise.all([
        Fortschritt.stand({ guildId, kennung: 'leveling:community', mitglied }),
        Fortschritt.position({ guildId, kennung: 'leveling:community', mitglied }),
    ]);
    return { stand, platz: pos.platz, von: pos.von };
}

/**
 * Die Karte als Anhang, oder null (Grund im Log).
 *
 * @param {import('discord.js').GuildMember} member
 * @param {{stand: object, platz: number|null}} s
 * @returns {Promise<{name: string, attachment: Buffer}|null>}
 */
async function zeichne(member, s) {
    const guild = member.guild;
    try {
        const karte = await Bildkarte.zeichneNutzung('leveling', Rangkarte.KARTE, {
            member, guild, werte: Rangkarte.werte(s.stand, { platz: s.platz, system: guild.getT('leveling:RANG.SYSTEM') }),
        }, { guildId: guild.id });
        if (karte.hinweise.length) ServiceManager.get('Logger').warn(`[Leveling] Rangkarte für ${member.id} in ${guild.id}: ${karte.hinweise.join('; ')}`);
        return { name: karte.dateiname('rank'), attachment: karte.puffer };
    } catch (error) {
        ServiceManager.get('Logger').error(`[Leveling] Rangkarte für ${member.id} in ${guild.id} nicht gezeichnet:`, error);
        return null;
    }
}

module.exports = { standUndPlatz, zeichne };
