const { antwort, pruefen, titelZeile } = require('../../utils');

/**
 * @param {Object} mitglied Discord-GuildMember
 * @param {number} nummer Position wie in /music queue, ab 1
 */
module.exports = async (mitglied, nummer) => {
    const p = await pruefen(mitglied, { brauchtSteuerrecht: true, brauchtAbspieler: true });
    if (!p.ok) return antwort(p.fehler, 'warnung');

    if (!nummer || nummer < 1) return antwort('Gib die Nummer aus `/music queue` an.', 'warnung');

    // Angezeigt wird ab 1, gespeichert ab 0
    const entfernt = p.abspieler.entfernen(nummer - 1);
    if (!entfernt) return antwort('An dieser Stelle steht nichts.', 'warnung');

    return antwort(`Entfernt: ${titelZeile(entfernt)}`);
};
