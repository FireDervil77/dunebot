const { antwort, pruefen, melden, mitgliedAus } = require('../utils');

/**
 * @type {import('dunebot-sdk').CommandType}
 */
module.exports = {
    name: 'shuffle',
    description: 'music:SHUFFLE.DESCRIPTION',
    command: { enabled: true, minArgsCount: 0 },
    slashCommand: { enabled: true, options: [] },

    async messageRun(ctx) { await mischen(ctx); },
    async interactionRun(ctx) { await mischen(ctx); }
};

/** @param {Object} ctx Befehlskontext */
async function mischen(ctx) {
    const mitglied = mitgliedAus(ctx);
    const p = await pruefen(mitglied, { brauchtSteuerrecht: true, brauchtAbspieler: true });
    if (!p.ok) return melden(ctx, antwort(p.fehler, 'warnung'));

    const anzahl = p.abspieler.mischen();
    if (anzahl < 2) {
        return melden(ctx, antwort('Zum Mischen braucht es mindestens zwei wartende Titel.', 'warnung'));
    }
    return melden(ctx, antwort(`**${anzahl} Titel** neu gemischt.`));
}
