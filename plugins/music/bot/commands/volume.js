const { ApplicationCommandOptionType } = require('discord.js');
const { antwort, pruefen, melden, mitgliedAus } = require('../utils');

/**
 * @type {import('dunebot-sdk').CommandType}
 */
module.exports = {
    name: 'volume',
    description: 'music:VOLUME.DESCRIPTION',
    command: { enabled: true, aliases: ['vol'], usage: '[0-200]', minArgsCount: 0 },
    slashCommand: {
        enabled: true,
        options: [{
            name: 'wert',
            description: 'music:VOLUME.VALUE_DESC',
            type: ApplicationCommandOptionType.Integer,
            required: false,
            minValue: 0,
            maxValue: 200
        }]
    },

    async messageRun(ctx) {
        const wert = ctx.args.length > 0 ? parseInt(ctx.args[0], 10) : null;
        await setzen(ctx, Number.isNaN(wert) ? null : wert);
    },
    async interactionRun(ctx) { await setzen(ctx, ctx.interaction.options.getInteger('wert')); }
};

/**
 * @param {Object} ctx Befehlskontext
 * @param {number|null} wert Neue Lautstaerke, oder null zum Abfragen
 */
async function setzen(ctx, wert) {
    const mitglied = mitgliedAus(ctx);

    // Nur nachschauen darf jeder
    const nurLesen = wert === null || wert === undefined;
    const p = await pruefen(mitglied, { brauchtSprachkanal: !nurLesen, brauchtSteuerrecht: !nurLesen, brauchtAbspieler: true });
    if (!p.ok) return melden(ctx, antwort(p.fehler, 'warnung'));

    if (nurLesen) {
        return melden(ctx, antwort(`Die Lautstaerke steht auf **${p.abspieler.lautstaerke}%**.`));
    }

    const neu = p.abspieler.lautstaerkeSetzen(wert);
    const warnung = neu > 100 ? '\n\nUeber 100 % kann es uebersteuern.' : '';
    return melden(ctx, antwort(`Lautstaerke auf **${neu}%** gesetzt.${warnung}`));
}
