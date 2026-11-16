'use strict';

const S = require('../struktur');
const T = require('../threads');

/**
 * Logging: Kanal geändert und Rechte-Überschreibungen (3.4); bei Foren die
 * angebotenen Tags (3.10).
 * (LG-1b, K382, 2026-11-16; Tags LG-1b Teil 2)
 */
module.exports = async (alt, neu) => {
    await S.melde(neu.guild?.id, S.kanalGeaendert(alt, neu), { kanaele: S.kette(neu) });
    await T.melde(neu.guild?.id, T.forumTags(alt, neu), neu);
};
