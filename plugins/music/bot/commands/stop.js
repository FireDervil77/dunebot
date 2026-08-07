const { antwort, pruefen, melden, mitgliedAus } = require('../utils');

/**
 * @type {import('dunebot-sdk').CommandType}
 */
module.exports = {
    name: 'stop',
    description: 'music:STOP.DESCRIPTION',
    command: { enabled: true, minArgsCount: 0 },
    slashCommand: { enabled: true, options: [] },

    async messageRun(ctx) { await stoppen(ctx); },
    async interactionRun(ctx) { await stoppen(ctx); }
};

/** @param {Object} ctx Befehlskontext */
async function stoppen(ctx) {
    const mitglied = mitgliedAus(ctx);
    const p = await pruefen(mitglied, { brauchtSteuerrecht: true, brauchtAbspieler: true });
    if (!p.ok) return melden(ctx, antwort(p.fehler, 'warnung'));

    p.abspieler.stoppen();
    return melden(ctx, antwort('Wiedergabe beendet und Warteschlange geleert.'));
}
