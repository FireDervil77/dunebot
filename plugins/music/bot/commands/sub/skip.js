const { antwort, pruefen, titelZeile } = require('../../utils');

/**
 * @param {Object} mitglied Discord-GuildMember
 * @param {number} anzahl Wie viele Titel
 * @returns {Promise<Object>} Antwort
 */
module.exports = async (mitglied, anzahl = 1) => {
    const p = await pruefen(mitglied, { brauchtSteuerrecht: true, brauchtAbspieler: true });
    if (!p.ok) return antwort(p.fehler, 'warnung');

    const uebersprungen = p.abspieler.aktuell;
    p.abspieler.ueberspringen(Math.max(1, anzahl));

    return antwort(anzahl > 1
        ? `**${anzahl} Titel** uebersprungen.`
        : `Uebersprungen: ${uebersprungen ? titelZeile(uebersprungen) : '—'}`);
};
