'use strict';

const A = require('../ausdruck');

/**
 * Logging: Sticker geändert (3.8).
 * (LG-1b Teil 2, K382, 2026-11-16)
 */
module.exports = (alt, neu) => A.melde(neu.guildId, A.stickerGeaendert(alt, neu));
