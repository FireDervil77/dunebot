'use strict';

const Te = require('../termine');

/**
 * Logging: Discord-Ereignis gelöscht (3.11).
 * (LG-1b Teil 2, K382, 2026-11-16)
 */
module.exports = (e) => Te.melde(e.guildId, Te.geloescht(e));
