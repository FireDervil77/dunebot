const { antwort, pruefen } = require('../../utils');
const { MusicSettings } = require('../../../shared/models');

/**
 * @param {Object} mitglied Discord-GuildMember
 * @param {boolean} an Zustand
 */
module.exports = async (mitglied, an) => {
    const p = await pruefen(mitglied, { brauchtSteuerrecht: true, brauchtAbspieler: true });
    if (!p.ok) return antwort(p.fehler, 'warnung');

    p.abspieler.autoplaySetzen(an);
    await MusicSettings.updateSettings(mitglied.guild.id, { autoplay: an ? 1 : 0 });

    return antwort(an
        ? 'Autoplay **an** — wenn die Warteschlange leer laeuft, suche ich passende Titel nach.'
        : 'Autoplay **aus** — nach dem letzten Titel ist Schluss.');
};
