'use strict';

const T = require('../threads');

/**
 * Logging: Thread oder Forenbeitrag geändert, Tags, archiviert (3.9, 3.10).
 * (LG-1b Teil 2, K382, 2026-11-16)
 */
module.exports = (alt, neu) => T.melde(neu.guildId, T.geaendert(alt, neu), neu);
