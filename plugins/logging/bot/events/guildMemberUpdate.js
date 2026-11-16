'use strict';

const M = require('../mitglieder');

/**
 * Logging: Spitzname, Server-Avatar, Rollen, Timeout, Boost (3.3, 3.7). Altes Mitglied als Partial → nichts, weil der Vorher-Stand unbekannt ist.
 * (LG-1b, K382, 2026-11-16)
 */
module.exports = (alt, neu) => M.melde(neu.guild?.id, M.geaendert(alt, neu), neu);
