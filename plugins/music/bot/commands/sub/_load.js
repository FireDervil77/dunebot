const { antwort, pruefen, spielzeitText } = require('../../utils');
const { MusicPlaylists } = require('../../../shared/models');

/**
 * Eine gespeicherte Liste in die Warteschlange legen.
 *
 * Braucht einen Sprachkanal: die Titel sollen ja gleich losgehen. Steht der
 * Bot noch nirgends, holt ihn das - wie `/music play` auch.
 *
 * @param {Object} mitglied Discord-GuildMember
 * @param {string} name Listenname
 * @param {string} textKanalId Wohin Ansagen gehen
 * @returns {Promise<Object>} Antwort
 */
module.exports = async (mitglied, name, textKanalId) => {
    const p = await pruefen(mitglied, { brauchtSprachkanal: true, brauchtSteuerrecht: true });
    if (!p.ok) return antwort(p.fehler, 'warnung');

    const listenName = String(name || '').trim();
    if (!listenName) return antwort('Welche Liste? Alle zeigt `/music playlists`.', 'warnung');

    const liste = await MusicPlaylists.getByName(mitglied.guild.id, listenName);
    if (!liste) return antwort(`Eine Liste namens **${listenName}** gibt es hier nicht.`, 'warnung');
    if (!liste.tracks || liste.tracks.length === 0) return antwort(`**${listenName}** ist leer.`, 'warnung');

    const sprachKanal = mitglied.voice.channel;
    if (!(await p.manager.kanalErlaubt(mitglied.guild.id, sprachKanal.id))) {
        return antwort('In diesem Sprachkanal ist Musik nicht freigegeben.', 'warnung');
    }

    const abspieler = p.manager.holen(mitglied.guild.id);

    try {
        await abspieler.beitreten(sprachKanal, textKanalId);
    } catch (err) {
        return antwort(`Ich komme in den Sprachkanal nicht hinein.\n\`${err.message}\``, 'fehler');
    }

    // Die Datenbank spricht Unterstriche, die Warteschlange spricht Binnenmajuskel
    const titel = liste.tracks.map(t => ({
        title: t.title,
        url: t.url,
        source: t.source,
        durationSec: t.duration_sec,
        thumbnail: t.thumbnail,
        requestedBy: mitglied.id
    }));

    const { aufgenommen, abgewiesen } = await abspieler.hinzufuegen(titel);
    await abspieler.starten();

    const spielzeit = titel.reduce((s, t) => s + (t.durationSec || 0), 0);
    const abgewiesenText = abgewiesen > 0 ? `\n${abgewiesen} Titel wurden abgewiesen.` : '';

    return antwort(
        `**${listenName}** eingereiht: **${aufgenommen} Titel** (${spielzeitText(spielzeit)}).${abgewiesenText}`
    );
};
