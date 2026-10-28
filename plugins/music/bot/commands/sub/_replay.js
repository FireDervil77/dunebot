const { antwort, pruefen, titelZeile } = require('../../utils');

/**
 * Den laufenden Titel von vorn.
 *
 * @param {Object} mitglied Discord-GuildMember
 * @returns {Promise<Object>} Antwort
 */
module.exports = async (mitglied) => {
    const p = await pruefen(mitglied, { brauchtSteuerrecht: true, brauchtAbspieler: true });
    if (!p.ok) return antwort(p.fehler, 'warnung');

    const titel = p.abspieler.aktuell;
    if (!titel) return antwort('Gerade läuft nichts, was sich wiederholen ließe.', 'warnung');

    if (!(await p.abspieler.wiederholen())) {
        return antwort('Der Titel ließ sich nicht neu starten.', 'fehler');
    }

    return antwort(`Von vorn: ${titelZeile(titel)}`);
};
