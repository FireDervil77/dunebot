const { antwort, pruefen, melden, mitgliedAus } = require('../utils');

/**
 * @type {import('dunebot-sdk').CommandType}
 */
module.exports = {
    name: 'resume',
    description: 'music:RESUME.DESCRIPTION',
    command: { enabled: true, minArgsCount: 0 },
    slashCommand: { enabled: true, options: [] },

    async messageRun(ctx) { await fortsetzen(ctx); },
    async interactionRun(ctx) { await fortsetzen(ctx); }
};

/** @param {Object} ctx Befehlskontext */
async function fortsetzen(ctx) {
    const mitglied = mitgliedAus(ctx);
    const p = await pruefen(mitglied, { brauchtSteuerrecht: true, brauchtAbspieler: true });
    if (!p.ok) return melden(ctx, antwort(p.fehler, 'warnung'));

    if (!p.abspieler.fortsetzen()) {
        return melden(ctx, antwort('Es laeuft bereits.', 'warnung'));
    }
    return melden(ctx, antwort('Weiter geht es.'));
}
