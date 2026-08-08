const { antwort, pruefen } = require('../../utils');
const { MusicPlaylists } = require('../../../shared/models');

/**
 * Eine gespeicherte Liste loeschen.
 *
 * Braucht das Steuerrecht - eine Liste gehoert dem Server, nicht dem, der
 * gerade tippt. Die Titel gehen per Fremdschluessel mit.
 *
 * @param {Object} mitglied Discord-GuildMember
 * @param {string} name Listenname
 * @returns {Promise<Object>} Antwort
 */
module.exports = async (mitglied, name) => {
    const p = await pruefen(mitglied, { brauchtSprachkanal: false, brauchtSteuerrecht: true });
    if (!p.ok) return antwort(p.fehler, 'warnung');

    const listenName = String(name || '').trim();
    if (!listenName) return antwort('Welche Liste? Alle zeigt `/music playlists`.', 'warnung');

    const liste = await MusicPlaylists.getByName(mitglied.guild.id, listenName);
    if (!liste) return antwort(`Eine Liste namens **${listenName}** gibt es hier nicht.`, 'warnung');

    const anzahl = (liste.tracks || []).length;
    const weg = await MusicPlaylists.delete(liste.id, mitglied.guild.id);

    return weg
        ? antwort(`**${listenName}** geloescht (${anzahl} Titel).`)
        : antwort('Die Liste liess sich nicht loeschen.', 'fehler');
};
