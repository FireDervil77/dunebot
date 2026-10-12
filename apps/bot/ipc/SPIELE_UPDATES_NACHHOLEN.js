'use strict';

const SpieleUpdates = require('../helpers/SpieleUpdates');

/**
 * Kern-IPC-Handler: SPIELE_UPDATES_NACHHOLEN
 *
 * Das Dashboard ruft ihn, nachdem der Betreiber den Kanal mit den
 * Spiele-Updates eingestellt hat: Der Bot liest den Kanal neu aus der
 * Datenbank und liest ihn ab dem Stichtag noch einmal durch — Neues kommt
 * dazu, Geändertes und fehlende Bilder werden nachgezogen, nichts doppelt.
 *
 * @param {Object} payload leer
 * @param {import('discord.js').Client} client
 * @returns {Promise<{success: boolean, aktiv?: boolean, kanal?: string, gelesen?: number, neu?: number, geaendert?: number, error?: string}>}
 */
module.exports = async (payload, client) => {
    SpieleUpdates.vergiss();
    try {
        // Vom Dashboard aus immer ab dem Stichtag: zieht Geändertes und fehlende Bilder nach.
        const ergebnis = await SpieleUpdates.nachholen(client, { vonVorn: true });
        return ergebnis.fehler ? { success: false, error: ergebnis.fehler, ...ergebnis } : { success: true, ...ergebnis };
    } catch (fehler) {
        return { success: false, error: fehler.message };
    }
};
