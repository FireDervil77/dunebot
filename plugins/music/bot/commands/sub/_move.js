const { antwort, pruefen, titelZeile } = require('../../utils');

/**
 * Einen Titel in der Warteschlange verschieben.
 *
 * Die Mechanik dafuer gab es im Abspieler von Anfang an - erreichbar war sie
 * bisher nur ueber das Dashboard.
 *
 * Gezaehlt wird wie in `/music queue`, also ab 1.
 *
 * @param {Object} mitglied Discord-GuildMember
 * @param {number} von Herkunftsplatz
 * @param {number} nach Zielplatz
 * @returns {Promise<Object>} Antwort
 */
module.exports = async (mitglied, von, nach) => {
    const p = await pruefen(mitglied, { brauchtSteuerrecht: true, brauchtAbspieler: true });
    if (!p.ok) return antwort(p.fehler, 'warnung');

    if (!von || !nach || von < 1 || nach < 1) {
        return antwort('Gib zwei Nummern aus `/music queue` an — von wo, nach wo.', 'warnung');
    }

    const titel = p.abspieler.warteschlange[von - 1];
    if (!titel) return antwort('An dieser Stelle steht nichts.', 'warnung');

    if (!p.abspieler.verschieben(von - 1, nach - 1)) {
        return antwort('Das liess sich nicht verschieben.', 'warnung');
    }

    // Wohin es wirklich ging - `verschieben` begrenzt auf das Ende der Liste
    const gelandet = p.abspieler.warteschlange.indexOf(titel) + 1;

    return antwort(`${titelZeile(titel)} steht jetzt auf **Platz ${gelandet}**.`);
};
