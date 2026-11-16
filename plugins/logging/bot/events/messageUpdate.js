'use strict';

const N = require('../nachrichten');

/**
 * Logging: Nachricht bearbeitet, angeheftet, losgeheftet (3.1), nur Metadaten. Link-Vorschauen ohne neue Bearbeitungszeit zählen nicht.
 * (LG-1b Teil 2, K382, 2026-11-16)
 */
module.exports = (alt, neu) => N.melde(neu?.guildId, N.bearbeitet(alt, neu), neu);
