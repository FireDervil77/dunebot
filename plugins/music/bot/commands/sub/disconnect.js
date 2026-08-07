const { antwort, pruefen } = require('../../utils');

/** @param {Object} mitglied Discord-GuildMember */
module.exports = async (mitglied) => {
    const p = await pruefen(mitglied, { brauchtSteuerrecht: true, brauchtAbspieler: true });
    if (!p.ok) return antwort(p.fehler, 'warnung');

    p.manager.beenden(mitglied.guild.id);
    return antwort('Ich habe den Sprachkanal verlassen.');
};
