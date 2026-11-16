'use strict';

const T = require('../threads');

/**
 * Logging: Mitglieder eines Threads dazu/weg (3.9). Zwei Sammlungen, der Thread kommt als drittes Argument.
 * (LG-1b Teil 2, K382, 2026-11-16)
 */
module.exports = (dazu, weg, t) => T.melde(t?.guildId, T.mitglieder(dazu, weg, t), t);
