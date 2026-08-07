const { antwort, pruefen } = require('../../utils');

/** @param {Object} mitglied Discord-GuildMember */
module.exports = async (mitglied) => {
    const p = await pruefen(mitglied, { brauchtSteuerrecht: true, brauchtAbspieler: true });
    if (!p.ok) return antwort(p.fehler, 'warnung');

    const anzahl = p.abspieler.mischen();
    if (anzahl < 2) return antwort('Zum Mischen braucht es mindestens zwei wartende Titel.', 'warnung');
    return antwort(`**${anzahl} Titel** neu gemischt.`);
};
