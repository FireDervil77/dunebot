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

    // Hier wird IMMER abgestimmt (Betreiber 2026-10-29, F26): Die DJ-Rolle gilt
    // für die Grundsteuerung (play, skip, shuffle, loop …), `voteskip` heißt nur
    // „skip" im Namen. Bis heute übersprang hier sofort, wer steuern darf — und
    // ohne DJ-Rolle darf das jeder (`darfSteuern`), es kam also nie zu einer
    // Abstimmung. Wer direkt überspringen will und darf, nimmt `/music skip`.
    // Allein im Kanal reicht die eigene Stimme (mindestens 1, `abstimmen`).
    const zuhoerer = mitglied.voice.channel.members.filter(m => !m.user.bot).size;
    const ergebnis = p.abspieler.abstimmen(mitglied.id, zuhoerer, einstellungen.vote_skip_percent || 50);

    if (ergebnis.schonGestimmt && !ergebnis.erreicht) {
        return antwort(`Du hast schon gestimmt. **${ergebnis.gezaehlt}/${ergebnis.noetig}** Stimmen.`, 'warnung');
    }

    if (ergebnis.erreicht) {
        p.abspieler.ueberspringen(1);
        return antwort(
            `Genug Stimmen (**${ergebnis.gezaehlt}/${ergebnis.noetig}**) — übersprungen: ` +
            `${aktuell ? titelZeile(aktuell) : '—'}`
        );
    }

    return antwort(`Stimme gezählt: **${ergebnis.gezaehlt}/${ergebnis.noetig}**.`);
};
