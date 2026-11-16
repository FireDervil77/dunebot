'use strict';

const Sp = require('../sprache');

/**
 * Logging: Sprache (3.2): Beitritt, Verlassen, Wechsel, stumm/taub, Kamera, Bildschirm, Bühne.
 * (LG-1b Teil 2, K382, 2026-11-16)
 */
module.exports = (alt, neu) => Sp.melde(neu?.guild?.id || alt?.guild?.id, Sp.aenderungen(alt, neu), alt, neu);
