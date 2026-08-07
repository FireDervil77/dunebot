const { antwort, pruefen, melden, mitgliedAus } = require('../utils');

/**
 * @type {import('dunebot-sdk').CommandType}
 */
module.exports = {
    name: 'disconnect',
    description: 'music:DISCONNECT.DESCRIPTION',
    command: { enabled: true, aliases: ['leave'], minArgsCount: 0 },
    slashCommand: { enabled: true, options: [] },

    async messageRun(ctx) { await trennen(ctx); },
    async interactionRun(ctx) { await trennen(ctx); }
};

/** @param {Object} ctx Befehlskontext */
async function trennen(ctx) {
    const mitglied = mitgliedAus(ctx);
    const p = await pruefen(mitglied, { brauchtSteuerrecht: true, brauchtAbspieler: true });
    if (!p.ok) return melden(ctx, antwort(p.fehler, 'warnung'));

    p.manager.beenden(mitglied.guild.id);
    return melden(ctx, antwort('Ich habe den Sprachkanal verlassen.'));
}
