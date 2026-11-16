'use strict';

const M = require('../mitglieder');

/**
 * Logging: Bann aufgehoben (3.3).
 * (LG-1b, K382, 2026-11-16)
 */
module.exports = (ban) => M.melde(ban.guild?.id, M.entbannt(ban), ban.user);
