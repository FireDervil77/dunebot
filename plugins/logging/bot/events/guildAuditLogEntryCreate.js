'use strict';

const { zuordner } = require('../zuordner');

/**
 * Logging: Audit-Eintrag geschoben → Täter für wartende Ereignisse (LG-1c).
 * Schreibt selbst keine Zeile; der Eintrag ist nur die Antwort auf „wer war's“.
 * (LG-1c, K382, 2026-11-16)
 */
module.exports = (eintrag, guild) => {
    if (guild?.id) zuordner.eintrag(guild.id, eintrag);
};
