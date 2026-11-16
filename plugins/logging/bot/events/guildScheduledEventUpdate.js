'use strict';

const Te = require('../termine');

/**
 * Logging: Discord-Ereignis geändert, gestartet, beendet, abgesagt (3.11).
 * (LG-1b Teil 2, K382, 2026-11-16)
 */
module.exports = (alt, neu) => Te.melde(neu.guildId, Te.geaendert(alt, neu));
