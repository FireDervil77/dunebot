const { antwort, pruefen } = require('../../utils');
const GuildPlayer = require('../../managers/GuildPlayer');

const BESCHREIBUNG = {
    aus: 'Wiederholung ist **aus**.',
    titel: 'Der laufende Titel wiederholt sich.',
    liste: 'Die ganze Warteschlange wiederholt sich.'
};

/**
 * @param {Object} mitglied Discord-GuildMember
 * @param {string} modus aus, titel oder liste
 */
module.exports = async (mitglied, modus) => {
    const p = await pruefen(mitglied, { brauchtSteuerrecht: true, brauchtAbspieler: true });
    if (!p.ok) return antwort(p.fehler, 'warnung');

    if (!Object.values(GuildPlayer.WIEDERHOLUNG).includes(modus)) {
        return antwort('Waehle `aus`, `titel` oder `liste`.', 'warnung');
    }

    p.abspieler.wiederholungSetzen(modus);
    return antwort(BESCHREIBUNG[modus]);
};
