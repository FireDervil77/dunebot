'use strict';

const A = require('../ausdruck');

/**
 * Logging: Emoji geändert (3.8).
 * (LG-1b Teil 2, K382, 2026-11-16)
 */
module.exports = (alt, neu) => A.melde(neu.guild?.id, A.emojiGeaendert(alt, neu));
