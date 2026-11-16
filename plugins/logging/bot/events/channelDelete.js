'use strict';

const S = require('../struktur');

/**
 * Logging: Kanal gelöscht (3.4).
 * (LG-1b, K382, 2026-11-16)
 */
module.exports = (kanal) => S.melde(kanal.guild?.id, S.kanalGeloescht(kanal), { kanaele: S.kette(kanal) });
