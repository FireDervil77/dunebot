'use strict';

const N = require('../nachrichten');

/**
 * Logging: Nachricht gelöscht (3.1), nur Metadaten. Partial → Autor und Merkmale unbekannt.
 * (LG-1b Teil 2, K382, 2026-11-16)
 */
module.exports = (m) => N.melde(m?.guildId, N.geloescht(m), m);
