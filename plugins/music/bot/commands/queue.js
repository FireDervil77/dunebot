const { ApplicationCommandOptionType } = require('discord.js');
const { FARBE, antwort, pruefen, melden, mitgliedAus, titelZeile, dauerText, spielzeitText } = require('../utils');

/** So viele Titel passen auf eine Seite. */
const PRO_SEITE = 10;

/**
 * @type {import('dunebot-sdk').CommandType}
 */
module.exports = {
    name: 'queue',
    description: 'music:QUEUE.DESCRIPTION',
    command: { enabled: true, aliases: ['q'], usage: '[Seite]', minArgsCount: 0 },
    slashCommand: {
        enabled: true,
        options: [{
            name: 'seite',
            description: 'music:QUEUE.PAGE_DESC',
            type: ApplicationCommandOptionType.Integer,
            required: false,
            minValue: 1
        }]
    },

    async messageRun(ctx) { await zeigen(ctx, parseInt(ctx.args[0], 10) || 1); },
    async interactionRun(ctx) { await zeigen(ctx, ctx.interaction.options.getInteger('seite') || 1); }
};

/**
 * @param {Object} ctx Befehlskontext
 * @param {number} seite Gewuenschte Seite
 */
async function zeigen(ctx, seite) {
    const mitglied = mitgliedAus(ctx);
    const p = await pruefen(mitglied, { brauchtSprachkanal: false });
    if (!p.ok) return melden(ctx, antwort(p.fehler, 'warnung'));

    const zustand = p.manager.zustand(mitglied.guild.id);

    if (!zustand.aktuell && zustand.warteschlange.length === 0) {
        return melden(ctx, antwort('Die Warteschlange ist leer.', 'warnung'));
    }

    const seiten = Math.max(1, Math.ceil(zustand.warteschlange.length / PRO_SEITE));
    const aktuelleSeite = Math.min(Math.max(1, seite), seiten);
    const von = (aktuelleSeite - 1) * PRO_SEITE;
    const ausschnitt = zustand.warteschlange.slice(von, von + PRO_SEITE);

    const felder = [];

    if (zustand.aktuell) {
        const gelaufen = dauerText(zustand.aktuell.positionSek);
        const gesamt = dauerText(zustand.aktuell.durationSec);
        felder.push({
            name: zustand.pausiert ? 'Angehalten' : 'Laeuft gerade',
            value: `${titelZeile(zustand.aktuell)}\n\`${gelaufen} / ${gesamt}\``
        });
    }

    if (ausschnitt.length > 0) {
        felder.push({
            name: `Als Naechstes (Seite ${aktuelleSeite} von ${seiten})`,
            value: ausschnitt.map((t, i) => titelZeile(t, von + i + 1)).join('\n').substring(0, 1024)
        });
    }

    const fuss = [
        `${zustand.warteschlange.length} in der Warteschlange`,
        `Restspielzeit ${spielzeitText(zustand.restspielzeitSek)}`,
        `Lautstaerke ${zustand.lautstaerke}%`,
        zustand.wiederholung !== 'aus' ? `Wiederholung: ${zustand.wiederholung}` : null
    ].filter(Boolean).join(' · ');

    return melden(ctx, { embeds: [{ color: FARBE, title: 'Warteschlange', fields: felder, footer: { text: fuss } }] });
}
