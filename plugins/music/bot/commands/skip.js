const { ApplicationCommandOptionType } = require('discord.js');
const { antwort, pruefen, melden, mitgliedAus, titelZeile } = require('../utils');

/**
 * @type {import('dunebot-sdk').CommandType}
 */
module.exports = {
    name: 'skip',
    description: 'music:SKIP.DESCRIPTION',
    command: { enabled: true, usage: '[Anzahl]', minArgsCount: 0 },
    slashCommand: {
        enabled: true,
        options: [{
            name: 'anzahl',
            description: 'music:SKIP.COUNT_DESC',
            type: ApplicationCommandOptionType.Integer,
            required: false,
            minValue: 1,
            maxValue: 50
        }]
    },

    async messageRun(ctx) {
        await ueberspringen(ctx, parseInt(ctx.args[0], 10) || 1);
    },

    async interactionRun(ctx) {
        await ueberspringen(ctx, ctx.interaction.options.getInteger('anzahl') || 1);
    }
};

/**
 * @param {Object} ctx Befehlskontext
 * @param {number} anzahl Wie viele Titel
 */
async function ueberspringen(ctx, anzahl) {
    const mitglied = mitgliedAus(ctx);
    const p = await pruefen(mitglied, { brauchtSteuerrecht: true, brauchtAbspieler: true });
    if (!p.ok) return melden(ctx, antwort(p.fehler, 'warnung'));

    const uebersprungen = p.abspieler.aktuell;
    p.abspieler.ueberspringen(anzahl);

    const text = anzahl > 1
        ? `**${anzahl} Titel** uebersprungen.`
        : `Uebersprungen: ${uebersprungen ? titelZeile(uebersprungen) : '—'}`;

    return melden(ctx, antwort(text));
}
