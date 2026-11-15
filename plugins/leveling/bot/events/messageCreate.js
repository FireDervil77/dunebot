'use strict';

const { beiNachricht } = require('../chatxp');

/**
 * Leveling: Chat-XP (LV-1c). Der PluginManager ruft das nur in Guilds, in
 * denen Leveling an ist.
 *
 * @param {import('discord.js').Message} message
 */
module.exports = (message) => beiNachricht(message);
