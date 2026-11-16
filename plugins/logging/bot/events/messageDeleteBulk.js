'use strict';

const N = require('../nachrichten');

/**
 * Logging: Massenlöschung (3.1): Anzahl, Autoren, Zeitraum; keine Texte. Erstes Argument ist die Sammlung, der Kanal kommt als zweites (K394).
 * (LG-1b Teil 2, K382, 2026-11-16)
 */
module.exports = (nachrichten, kanal) => N.melde(kanal?.guildId, N.massenloeschung(nachrichten?.values?.(), kanal), null, kanal);
