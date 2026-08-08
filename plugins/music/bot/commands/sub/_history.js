const { FARBE, antwort, pruefen, titelZeile } = require('../../utils');
const { MusicHistory } = require('../../../shared/models');

/** So viele Eintraege zeigt der Verlauf. */
const ANZAHL = 15;

/**
 * Der Verlauf - und der Weg zurueck.
 *
 * Ohne Nummer zeigt er die zuletzt gelaufenen Titel. Mit Nummer reiht er
 * genau den wieder ein; `/music history 1` ist damit das, was andere Bots
 * `addprevious` nennen.
 *
 * @param {Object} mitglied Discord-GuildMember
 * @param {number|null} nummer Welchen Eintrag wieder einreihen
 * @returns {Promise<Object>} Antwort
 */
module.exports = async (mitglied, nummer = null) => {
    const nurLesen = !nummer;

    const p = await pruefen(mitglied, {
        brauchtSprachkanal: !nurLesen,
        brauchtSteuerrecht: !nurLesen,
        brauchtAbspieler: !nurLesen
    });
    if (!p.ok) return antwort(p.fehler, 'warnung');

    const eintraege = await MusicHistory.getRecent(mitglied.guild.id, ANZAHL);
    if (eintraege.length === 0) return antwort('Hier ist noch nichts gelaufen.', 'warnung');

    if (nurLesen) {
        const zeilen = eintraege.map((e, i) => titelZeile({
            title: e.title, url: e.url, durationSec: e.duration_sec
        }, i + 1));

        return {
            embeds: [{
                color: FARBE,
                title: 'Zuletzt gelaufen',
                description: zeilen.join('\n').substring(0, 4000),
                footer: { text: 'Wieder einreihen: /music history <Nummer>' }
            }]
        };
    }

    const e = eintraege[nummer - 1];
    if (!e) return antwort(`Im Verlauf stehen nur ${eintraege.length} Eintraege.`, 'warnung');
    if (!e.url) return antwort('Zu diesem Eintrag steht keine Quelle mehr fest.', 'warnung');

    const { aufgenommen } = await p.abspieler.hinzufuegen([{
        title: e.title,
        url: e.url,
        source: e.source,
        durationSec: e.duration_sec,
        thumbnail: e.thumbnail,
        requestedBy: mitglied.id
    }]);

    if (aufgenommen === 0) return antwort('Nichts aufgenommen — die Warteschlange ist voll.', 'warnung');

    await p.abspieler.starten();

    return antwort(
        `Wieder eingereiht: ${titelZeile({ title: e.title, url: e.url, durationSec: e.duration_sec })}`
    );
};
