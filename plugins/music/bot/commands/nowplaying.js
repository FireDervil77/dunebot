const { FARBE, antwort, pruefen, melden, mitgliedAus, dauerText } = require('../utils');

/** Breite des Fortschrittsbalkens in Zeichen. */
const BALKEN = 20;

/**
 * @type {import('dunebot-sdk').CommandType}
 */
module.exports = {
    name: 'nowplaying',
    description: 'music:NOWPLAYING.DESCRIPTION',
    command: { enabled: true, aliases: ['np'], minArgsCount: 0 },
    slashCommand: { enabled: true, options: [] },

    async messageRun(ctx) { await zeigen(ctx); },
    async interactionRun(ctx) { await zeigen(ctx); }
};

/** @param {Object} ctx Befehlskontext */
async function zeigen(ctx) {
    const mitglied = mitgliedAus(ctx);
    const p = await pruefen(mitglied, { brauchtSprachkanal: false });
    if (!p.ok) return melden(ctx, antwort(p.fehler, 'warnung'));

    const zustand = p.manager.zustand(mitglied.guild.id);
    if (!zustand.aktuell) return melden(ctx, antwort('Es laeuft gerade nichts.', 'warnung'));

    const t = zustand.aktuell;
    const gelaufen = t.positionSek || 0;

    // Bei Radio gibt es keine Gesamtdauer, also auch keinen Balken
    let fortschritt = '';
    if (t.durationSec > 0) {
        const anteil = Math.min(1, gelaufen / t.durationSec);
        const stelle = Math.round(anteil * (BALKEN - 1));
        fortschritt = '\n`' + '─'.repeat(stelle) + '●' + '─'.repeat(BALKEN - 1 - stelle) +
                      ` ${dauerText(gelaufen)} / ${dauerText(t.durationSec)}\``;
    }

    return melden(ctx, {
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
    });
}
