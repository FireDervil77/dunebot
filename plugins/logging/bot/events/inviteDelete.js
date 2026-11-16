'use strict';

const S = require('../struktur');

/**
 * Logging: Einladung gelöscht (3.6).
 * (LG-1b, K382, 2026-11-16)
 */
module.exports = (inv) => S.melde(inv.guild?.id, S.einladungGeloescht(inv), { kanaele: [inv.channelId].filter(Boolean) });
