'use strict';

const S = require('../struktur');

/**
 * Logging: Rolle angelegt (3.4).
 * (LG-1b, K382, 2026-11-16)
 */
module.exports = (rolle) => S.melde(rolle.guild?.id, S.rolleAngelegt(rolle));
