const { antwort, pruefen, spielzeitText } = require('../../utils');
const { MusicPlaylists } = require('../../../shared/models');

/**
 * Titel als Wiedergabeliste sichern.
 *
 * **Zwei Umfaenge, und der Unterschied ist wichtig:** „alles" nimmt den
 * laufenden Titel und die ganze Warteschlange, „nur den laufenden" nimmt genau
 * einen. Ohne das Zweite ist mit Listen nicht vernuenftig zu arbeiten - man
 * hoert etwas Gutes und will genau das behalten, nicht den ganzen Abend.
 *
 * Gibt es die Liste schon, werden die Titel angehaengt statt sie zu ersetzen -
 * Anhaengen laesst sich rueckgaengig machen, Ueberschreiben nicht.
 *
 * @param {Object} mitglied Discord-GuildMember
 * @param {string} name Listenname
 * @param {boolean} nurAktuell Nur den laufenden Titel
 * @returns {Promise<Object>} Antwort
 */
module.exports = async (mitglied, name, nurAktuell = false) => {
    const p = await pruefen(mitglied, { brauchtSprachkanal: false, brauchtAbspieler: true });
    if (!p.ok) return antwort(p.fehler, 'warnung');

    const listenName = String(name || '').trim();
    if (!listenName) return antwort('Gib der Liste einen Namen.', 'warnung');

    const zustand = p.abspieler.zustand();

    if (nurAktuell && !zustand.aktuell) {
        return antwort('Gerade laeuft nichts, was sich sichern liesse.', 'warnung');
    }

    const alle = nurAktuell
        ? [zustand.aktuell]
        : [...(zustand.aktuell ? [zustand.aktuell] : []), ...zustand.warteschlange];

    if (alle.length === 0) return antwort('Es ist nichts da, was sich sichern liesse.', 'warnung');

    // `music_playlist_tracks.url` ist NOT NULL. Spotify-Titel tragen erst eine
    // Adresse, wenn sie an der Reihe waren - die koennen wir hier noch nicht
    // ablegen, ohne zu raten. Lieber ehrlich zaehlen als still verlieren.
    const speicherbar = alle.filter(t => t.url);
    const ohneAdresse = alle.length - speicherbar.length;

    if (speicherbar.length === 0) {
        return antwort(
            'Von diesen Titeln steht noch keiner fest — sie warten alle noch auf ihre Quelle. ' +
            'Sichere die Liste, wenn etwas davon gelaufen ist.',
            'warnung'
        );
    }

    const vorhanden = await MusicPlaylists.getByName(mitglied.guild.id, listenName);
    const listenId = vorhanden
        ? vorhanden.id
        : await MusicPlaylists.create(mitglied.guild.id, { name: listenName, createdBy: mitglied.id });

    await MusicPlaylists.addTracks(listenId, speicherbar, mitglied.id);

    const spielzeit = speicherbar.reduce((s, t) => s + (t.durationSec || 0), 0);
    const nachtrag = ohneAdresse > 0
        ? `\n${ohneAdresse} Titel blieben aussen vor — sie haben noch keine Quelle.`
        : '';

    return antwort(
        `${vorhanden ? 'An **' + listenName + '** angehaengt' : 'Liste **' + listenName + '** angelegt'}: ` +
        `**${speicherbar.length} Titel** (${spielzeitText(spielzeit)}).${nachtrag}\n` +
        `Wieder einreihen mit \`/music load ${listenName}\`.`
    );
};
