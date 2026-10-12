'use strict';

const SpieleUpdates = require('../helpers/SpieleUpdates');

/**
 * Kern-IPC-Handler: SPIELE_UPDATES_NACHHOLEN
 *
 * Das Dashboard ruft ihn, nachdem der Betreiber den Kanal mit den
 * Spiele-Updates eingestellt hat: Der Bot liest den Kanal neu aus der
 * Datenbank und holt gleich nach, was dort seit dem Stichtag steht.
 *
 * @param {Object} payload leer
 * @param {import('discord.js').Client} client
 * @returns {Promise<{success: boolean, aktiv?: boolean, kanal?: string, gelesen?: number, neu?: number, geaendert?: number, error?: string}>}
 */
module.exports = async (payload, client) => {
    SpieleUpdates.vergiss();
    try {
        const ergebnis = await SpieleUpdates.nachholen(client);
        return ergebnis.fehler ? { success: false, error: ergebnis.fehler, ...ergebnis } : { success: true, ...ergebnis };
    } catch (fehler) {
        return { success: false, error: fehler.message };
    }
};
