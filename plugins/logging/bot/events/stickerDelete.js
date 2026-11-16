'use strict';

const A = require('../ausdruck');

/**
 * Logging: Sticker gelöscht (3.8).
 * (LG-1b Teil 2, K382, 2026-11-16)
 */
module.exports = (s) => A.melde(s.guildId, A.stickerGeloescht(s));
