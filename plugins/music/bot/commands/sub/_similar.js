const { antwort, pruefen, titelZeile } = require('../../utils');

/**
 * Passende Titel nachlegen - von Hand, was Autoplay von allein tut.
 *
 * @param {Object} mitglied Discord-GuildMember
 * @param {number} anzahl Wie viele
 * @returns {Promise<Object>} Antwort
 */
module.exports = async (mitglied, anzahl = 1) => {
    const p = await pruefen(mitglied, { brauchtSteuerrecht: true, brauchtAbspieler: true });
    if (!p.ok) return antwort(p.fehler, 'warnung');

    const grundlage = p.abspieler.aktuell
        || p.abspieler.warteschlange[p.abspieler.warteschlange.length - 1];

    if (!grundlage) {
        return antwort('Ich brauche einen Titel, an dem ich mich orientieren kann.', 'warnung');
    }

    const gefunden = await p.abspieler.aehnlichesAnhaengen(anzahl || 1);

    if (gefunden.length === 0) {
        return antwort(`Zu **${grundlage.title}** habe ich nichts Passendes gefunden.`, 'warnung');
    }

    await p.abspieler.starten();

    return antwort(
        `Passend zu **${grundlage.title}** aufgenommen:\n` +
        gefunden.map((t, i) => titelZeile(t, i + 1)).join('\n').substring(0, 3500)
    );
};
