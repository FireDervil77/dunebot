const { ApplicationCommandOptionType } = require('discord.js');
const { antwort, pruefen, melden, mitgliedAus, titelZeile } = require('../utils');

/**
 * @type {import('dunebot-sdk').CommandType}
 */
module.exports = {
    name: 'remove',
    description: 'music:REMOVE.DESCRIPTION',
    command: { enabled: true, usage: '<Nummer>', minArgsCount: 1 },
    slashCommand: {
        enabled: true,
        options: [{
            name: 'nummer',
            description: 'music:REMOVE.POSITION_DESC',
            type: ApplicationCommandOptionType.Integer,
            required: true,
            minValue: 1
        }]
    },

    async messageRun(ctx) { await entfernen(ctx, parseInt(ctx.args[0], 10)); },
    async interactionRun(ctx) { await entfernen(ctx, ctx.interaction.options.getInteger('nummer')); }
};

/**
 * @param {Object} ctx Befehlskontext
 * @param {number} nummer Position, wie sie `/queue` anzeigt (ab 1)
 */
async function entfernen(ctx, nummer) {
    const mitglied = mitgliedAus(ctx);
    const p = await pruefen(mitglied, { brauchtSteuerrecht: true, brauchtAbspieler: true });
    if (!p.ok) return melden(ctx, antwort(p.fehler, 'warnung'));

    if (!nummer || nummer < 1) {
        return melden(ctx, antwort('Gib die Nummer aus `/queue` an.', 'warnung'));
    }

    // Angezeigt wird ab 1, gespeichert ab 0
    const entfernt = p.abspieler.entfernen(nummer - 1);
    if (!entfernt) {
        return melden(ctx, antwort('An dieser Stelle steht nichts.', 'warnung'));
    }

    return melden(ctx, antwort(`Entfernt: ${titelZeile(entfernt)}`));
}
