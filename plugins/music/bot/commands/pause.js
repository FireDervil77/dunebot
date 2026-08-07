const { antwort, pruefen, melden, mitgliedAus } = require('../utils');

/**
 * @type {import('dunebot-sdk').CommandType}
 */
module.exports = {
    name: 'pause',
    description: 'music:PAUSE.DESCRIPTION',
    command: { enabled: true, minArgsCount: 0 },
    slashCommand: { enabled: true, options: [] },

    async messageRun(ctx) { await pausieren(ctx); },
    async interactionRun(ctx) { await pausieren(ctx); }
};

/** @param {Object} ctx Befehlskontext */
async function pausieren(ctx) {
    const mitglied = mitgliedAus(ctx);
    const p = await pruefen(mitglied, { brauchtSteuerrecht: true, brauchtAbspieler: true });
    if (!p.ok) return melden(ctx, antwort(p.fehler, 'warnung'));

    if (!p.abspieler.pausieren()) {
        return melden(ctx, antwort('Es ist schon angehalten.', 'warnung'));
    }
    return melden(ctx, antwort('Angehalten. Weiter geht es mit `/resume`.'));
}
