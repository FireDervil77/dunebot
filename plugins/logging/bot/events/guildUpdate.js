'use strict';

const S = require('../struktur');

/**
 * Logging: Servereinstellungen (3.4).
 * (LG-1b, K382, 2026-11-16)
 */
module.exports = (alt, neu) => S.melde(neu.id, S.serverGeaendert(alt, neu));
