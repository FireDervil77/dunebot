const { antwort, pruefen } = require('../../utils');

/** @param {Object} mitglied Discord-GuildMember */
module.exports = async (mitglied) => {
    const p = await pruefen(mitglied, { brauchtSteuerrecht: true, brauchtAbspieler: true });
    if (!p.ok) return antwort(p.fehler, 'warnung');

    if (!p.abspieler.fortsetzen()) return antwort('Es laeuft bereits.', 'warnung');
    return antwort('Weiter geht es.');
};
