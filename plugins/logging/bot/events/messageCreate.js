'use strict';

const N = require('../nachrichten');

/**
 * Logging: Neue Nachricht mit @everyone oder @here (3.1). Jede andere neue Nachricht kehrt ohne Arbeit zurück.
 * (LG-1b Teil 2, K382, 2026-11-16)
 */
module.exports = (m) => (m?.mentions?.everyone ? N.melde(m.guildId, N.everyone(m), m) : undefined);
