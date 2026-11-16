'use strict';

const S = require('../struktur');

/**
 * Logging: Rolle geändert und Rechte (3.4).
 * (LG-1b, K382, 2026-11-16)
 */
module.exports = (alt, neu) => S.melde(neu.guild?.id, S.rolleGeaendert(alt, neu));
