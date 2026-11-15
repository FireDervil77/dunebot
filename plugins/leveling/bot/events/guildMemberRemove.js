'use strict';

const { beimVerlassen } = require('../verlassen');

/**
 * Leveling: Mitglied geht → vermerken, wenn die Guild „XP beim Verlassen
 * löschen“ gewählt hat (LV-1i Teil 2). Auch als Partial (G-13).
 *
 * @param {import('discord.js').GuildMember|import('discord.js').PartialGuildMember} member
 */
module.exports = (member) => beimVerlassen(member);
