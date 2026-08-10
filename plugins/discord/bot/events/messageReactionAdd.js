'use strict';

const { AKTION } = require('../rollenmenue/entscheidung');
const { behandleReaktion } = require('../rollenmenue/reaktion');

/**
 * Reaktion gesetzt — die Bedienung eines Rollenmenüs vom Typ `reaktion`.
 *
 * @param {import('discord.js').MessageReaction} reaction
 * @param {import('discord.js').User} user
 */
module.exports = (reaction, user) => behandleReaktion(reaction, user, AKTION.SETZEN);
