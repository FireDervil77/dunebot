'use strict';

const Te = require('../termine');

/**
 * Logging: Mitglied interessiert sich für ein Discord-Ereignis (3.11).
 * (LG-1b Teil 2, K382, 2026-11-16)
 */
module.exports = (e, user) => Te.melde(e.guildId, Te.interesse(e, user, true), user);
