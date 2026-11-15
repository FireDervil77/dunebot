'use strict';

const { beiLoeschung } = require('../chatxp');

/**
 * Leveling: gelöschte Nachricht → XP zurück, wenn sie jung genug war (LV-1c).
 * Gesammelte Löschungen (`messageDeleteBulk`) kommen hier nicht an: Der
 * PluginManager findet in einer Sammlung keine Guild und reicht sie nur an
 * den Kern weiter.
 *
 * @param {import('discord.js').Message|import('discord.js').PartialMessage} message
 */
module.exports = (message) => beiLoeschung(message);
