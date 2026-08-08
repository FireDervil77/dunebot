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

    if (nurLesen) return antwort(`Die Lautstaerke steht auf **${p.abspieler.lautstaerke}%**.`);

    const neu = p.abspieler.lautstaerkeSetzen(wert);
    const warnung = neu > 100 ? '\n\nUeber 100 % kann es uebersteuern.' : '';
    return antwort(`Lautstaerke auf **${neu}%** gesetzt.${warnung}`);
};
