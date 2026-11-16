'use strict';

const S = require('../struktur');

/**
 * Logging: Einladung angelegt (3.6), mit Einlader.
 * (LG-1b, K382, 2026-11-16)
 */
module.exports = (inv) => S.melde(inv.guild?.id, S.einladungAngelegt(inv), { kanaele: [inv.channelId].filter(Boolean) });
