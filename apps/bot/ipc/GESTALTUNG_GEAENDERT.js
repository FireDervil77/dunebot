'use strict';

const { Gestaltung } = require('dunebot-sdk');

/**
 * Kern-IPC-Handler: GESTALTUNG_GEAENDERT (G-09, 2026-11-14)
 *
 * Das Dashboard hat Palette, Logo, Banner oder die Farben eines Plugins einer
 * Guild gespeichert. Der Bot verwirft, was er sich von dieser Guild gemerkt
 * hat; die nächste Nachricht liest neu. Ohne diese Nachricht gälte die neue
 * Gestaltung erst nach einer Minute (`Gestaltung.js`, Zwischenspeicher).
 *
 * @param {{guildId: string}} payload
 * @returns {{success: boolean}}
 */
module.exports = (payload) => {
    const guildId = String(payload?.guildId || '');
    if (!guildId) return { success: false, error: 'guildId fehlt' };
    Gestaltung.vergiss(guildId);
    return { success: true };
};
