const { antwort, pruefen } = require('../../utils');

/** @param {Object} mitglied Discord-GuildMember */
module.exports = async (mitglied) => {
    const p = await pruefen(mitglied, { brauchtSteuerrecht: true, brauchtAbspieler: true });
    if (!p.ok) return antwort(p.fehler, 'warnung');

    if (!p.abspieler.pausieren()) return antwort('Es ist schon angehalten.', 'warnung');
    return antwort('Angehalten. Weiter geht es mit `/music resume`.');
};
