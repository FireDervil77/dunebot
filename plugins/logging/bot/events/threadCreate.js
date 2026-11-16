'use strict';

const T = require('../threads');

/**
 * Logging: Thread oder Forenbeitrag angelegt (3.9, 3.10). Nur neu angelegte, nicht beim ersten Sehen.
 * (LG-1b Teil 2, K382, 2026-11-16)
 */
module.exports = (t, neuAngelegt) => T.melde(t.guildId, T.angelegt(t, neuAngelegt), t);
