'use strict';

const A = require('../ausdruck');

/**
 * Logging: Emoji angelegt (3.8).
 * (LG-1b Teil 2, K382, 2026-11-16)
 */
module.exports = (e) => A.melde(e.guild?.id, A.emojiAngelegt(e));
