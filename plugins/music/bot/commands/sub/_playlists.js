const { FARBE, antwort, pruefen, titelZeile, spielzeitText } = require('../../utils');
const { MusicPlaylists } = require('../../../shared/models');

/** So viele Titel zeigt die Vorschau einer Liste. */
const VORSCHAU = 10;

/**
 * Die Listen der Guild zeigen - ohne Namen alle, mit Namen den Inhalt.
 *
 * Braucht weder Sprachkanal noch Abspieler: Nachsehen darf jeder, auch wenn
 * gerade nichts laeuft.
 *
 * @param {Object} mitglied Discord-GuildMember
 * @param {string|null} name Listenname, oder null fuer die Uebersicht
 * @returns {Promise<Object>} Antwort
 */
module.exports = async (mitglied, name = null) => {
    const p = await pruefen(mitglied, { brauchtSprachkanal: false });
    if (!p.ok) return antwort(p.fehler, 'warnung');

    const gesucht = String(name || '').trim();

    if (gesucht) {
        const liste = await MusicPlaylists.getByName(mitglied.guild.id, gesucht);
        if (!liste) return antwort(`Eine Liste namens **${gesucht}** gibt es hier nicht.`, 'warnung');

        const titel = liste.tracks || [];
        const spielzeit = titel.reduce((s, t) => s + (t.duration_sec || 0), 0);

        const zeilen = titel.slice(0, VORSCHAU).map((t, i) => titelZeile({
            title: t.title, url: t.url, durationSec: t.duration_sec
        }, i + 1));

        const mehr = titel.length > VORSCHAU ? `\n… und ${titel.length - VORSCHAU} weitere` : '';

        return {
            embeds: [{
                color: FARBE,
                title: liste.name,
                description: liste.description || null,
                fields: zeilen.length > 0
                    ? [{ name: 'Titel', value: zeilen.join('\n').substring(0, 1024) + mehr }]
                    : [{ name: 'Titel', value: 'Diese Liste ist leer.' }],
                footer: { text: `${titel.length} Titel · ${spielzeitText(spielzeit)} · /music load ${liste.name}` }
            }]
        };
    }

    const alle = await MusicPlaylists.getAll(mitglied.guild.id);
    if (alle.length === 0) {
        return antwort(
            'Hier ist noch keine Liste gespeichert. Lege eine an, indem du eine ' +
            'Warteschlange zusammenstellst und `/music save <Name>` benutzt.',
            'warnung'
        );
    }

    const zeilen = alle.map(l =>
        `**${l.name}** — ${l.titel_anzahl} Titel, ${spielzeitText(Number(l.spielzeit_sek) || 0)}`
    );

    return {
        embeds: [{
            color: FARBE,
            title: 'Wiedergabelisten',
            description: zeilen.join('\n').substring(0, 4000),
            footer: { text: 'Inhalt zeigen: /music playlists <Name> · Einreihen: /music load <Name>' }
        }]
    };
};
