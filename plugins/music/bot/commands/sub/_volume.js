const { antwort, pruefen } = require('../../utils');

/**
 * @param {Object} mitglied Discord-GuildMember
 * @param {number|null} wert Neue Lautstaerke, oder null zum Abfragen
 */
module.exports = async (mitglied, wert) => {
    const nurLesen = wert === null || wert === undefined;

    const p = await pruefen(mitglied, {
        brauchtSprachkanal: !nurLesen,
        brauchtSteuerrecht: !nurLesen,
        brauchtAbspieler: true
    });
    if (!p.ok) return antwort(p.fehler, 'warnung');

    if (nurLesen) return antwort(`Die Lautstärke steht auf **${p.abspieler.lautstaerke}%**.`);

    const neu = p.abspieler.lautstaerkeSetzen(wert);
    const warnung = neu > 100 ? '\n\nÜber 100 % kann es übersteuern.' : '';
    return antwort(`Lautstärke auf **${neu}%** gesetzt.${warnung}`);
};
