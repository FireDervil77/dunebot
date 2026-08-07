const { antwort, pruefen } = require('../../utils');
const { MusicSettings } = require('../../../shared/models');

/**
 * @param {Object} mitglied Discord-GuildMember
 * @param {boolean} an Zustand
 */
module.exports = async (mitglied, an) => {
    const p = await pruefen(mitglied, { brauchtSteuerrecht: true, brauchtAbspieler: true });
    if (!p.ok) return antwort(p.fehler, 'warnung');

    p.abspieler.dauerbetriebSetzen(an);

    // Auch fuer den naechsten Start merken
    await MusicSettings.updateSettings(mitglied.guild.id, {
        mode_247: an ? 1 : 0,
        mode_247_channel: an ? p.abspieler.sprachKanalId : null
    });

    return antwort(an
        ? 'Dauerbetrieb **an** — ich bleibe im Sprachkanal, auch wenn nichts laeuft.'
        : 'Dauerbetrieb **aus** — ich gehe wieder, wenn nichts mehr kommt.');
};
