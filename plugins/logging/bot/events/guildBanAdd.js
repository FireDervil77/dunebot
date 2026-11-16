'use strict';

const M = require('../mitglieder');

/**
 * Logging: Mitglied gebannt (3.3). Täter und Grund mit LG-1c.
 * (LG-1b, K382, 2026-11-16)
 */
module.exports = (ban) => M.melde(ban.guild?.id, M.gebannt(ban), ban.user);
