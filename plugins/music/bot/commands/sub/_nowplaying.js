const { FARBE, antwort, pruefen, dauerText } = require('../../utils');

/** Breite des Fortschrittsbalkens in Zeichen. */
const BALKEN = 20;

/** @param {Object} mitglied Discord-GuildMember */
module.exports = async (mitglied) => {
    const p = await pruefen(mitglied, { brauchtSprachkanal: false });
    if (!p.ok) return antwort(p.fehler, 'warnung');

    const zustand = p.manager.zustand(mitglied.guild.id);
    if (!zustand.aktuell) return antwort('Es laeuft gerade nichts.', 'warnung');

    const t = zustand.aktuell;
    const gelaufen = t.positionSek || 0;

    // Bei Radio gibt es keine Gesamtdauer, also auch keinen Balken
    let fortschritt = '';
    if (t.durationSec > 0) {
        const stelle = Math.round(Math.min(1, gelaufen / t.durationSec) * (BALKEN - 1));
        fortschritt = '\n`' + '─'.repeat(stelle) + '●' + '─'.repeat(BALKEN - 1 - stelle) +
                      ` ${dauerText(gelaufen)} / ${dauerText(t.durationSec)}\``;
    }

    return {
        embeds: [{
            color: FARBE,
            author: { name: zustand.pausiert ? 'Angehalten' : 'Jetzt laeuft' },
            title: t.title.substring(0, 256),
            url: t.herkunftUrl || t.url,
            description: fortschritt || `\`${dauerText(gelaufen)} — live\``,
            thumbnail: t.thumbnail ? { url: t.thumbnail } : undefined,
            fields: [
                { name: 'Quelle', value: t.source, inline: true },
                { name: 'Lautstaerke', value: `${zustand.lautstaerke}%`, inline: true },
                ...(t.requestedBy ? [{ name: 'Gewuenscht von', value: `<@${t.requestedBy}>`, inline: true }] : [])
            ],
            footer: { text: `${zustand.warteschlangeLaenge} weitere in der Warteschlange` }
        }]
    };
};
