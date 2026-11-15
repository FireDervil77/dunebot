'use strict';

const { beiLoeschung } = require('../chatxp');

/**
 * Leveling: gelöschte Nachricht → XP zurück, wenn sie jung genug war (LV-1c).
 * Gesammelte Löschungen kommen über `messageDeleteBulk.js` (K394).
 *
 * @param {import('discord.js').Message|import('discord.js').PartialMessage} message
 */
module.exports = (message) => beiLoeschung(message);
