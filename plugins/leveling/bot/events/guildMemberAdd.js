'use strict';

const { beimBeitritt } = require('../verlassen');

/**
 * Leveling: Mitglied kommt (wieder) → Vermerk vom Verlassen streichen, seine
 * XP bleiben (LV-1i Teil 2).
 *
 * @param {import('discord.js').GuildMember} member
 */
module.exports = (member) => beimBeitritt(member);
