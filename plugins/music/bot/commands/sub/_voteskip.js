const { antwort, pruefen, titelZeile } = require('../../utils');
const { MusicSettings } = require('../../../shared/models');

/** @param {Object} mitglied Discord-GuildMember */
module.exports = async (mitglied) => {
    // Hier ausdruecklich ohne Steuerrecht: darum geht es ja gerade
    const p = await pruefen(mitglied, { brauchtSprachkanal: true, brauchtAbspieler: true });
    if (!p.ok) return antwort(p.fehler, 'warnung');

    const einstellungen = await MusicSettings.getSettings(mitglied.guild.id);
    if (!einstellungen.vote_skip_enabled) {
        return antwort('Abstimmungen sind auf diesem Server abgeschaltet.', 'warnung');
    }

    const aktuell = p.abspieler.aktuell;

    // Wer ohnehin steuern darf, braucht keine Abstimmung
    if (await p.manager.darfSteuern(mitglied)) {
        p.abspieler.ueberspringen(1);
        return antwort(`Uebersprungen: ${aktuell ? titelZeile(aktuell) : '—'}`);
    }

    const zuhoerer = mitglied.voice.channel.members.filter(m => !m.user.bot).size;
    const ergebnis = p.abspieler.abstimmen(mitglied.id, zuhoerer, einstellungen.vote_skip_percent || 50);

    if (ergebnis.schonGestimmt && !ergebnis.erreicht) {
        return antwort(`Du hast schon gestimmt. **${ergebnis.gezaehlt}/${ergebnis.noetig}** Stimmen.`, 'warnung');
    }

    if (ergebnis.erreicht) {
        p.abspieler.ueberspringen(1);
        return antwort(
            `Genug Stimmen (**${ergebnis.gezaehlt}/${ergebnis.noetig}**) — uebersprungen: ` +
            `${aktuell ? titelZeile(aktuell) : '—'}`
        );
    }

    return antwort(`Stimme gezaehlt: **${ergebnis.gezaehlt}/${ergebnis.noetig}**.`);
};
