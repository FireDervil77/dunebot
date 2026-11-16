'use strict';

const T = require('../threads');

/**
 * Logging: Thread oder Forenbeitrag gelöscht (3.9, 3.10).
 * (LG-1b Teil 2, K382, 2026-11-16)
 */
module.exports = (t) => T.melde(t.guildId, T.geloescht(t), t);
