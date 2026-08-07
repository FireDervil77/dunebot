const { ApplicationCommandOptionType } = require('discord.js');
const { antwort, pruefen, melden, mitgliedAus } = require('../utils');
const { MusicSettings } = require('../../shared/models');

/**
 * @type {import('dunebot-sdk').CommandType}
 */
module.exports = {
    name: '247',
    description: 'music:MODE247.DESCRIPTION',
    command: { enabled: true, aliases: ['24/7'], usage: '<an|aus>', minArgsCount: 0 },
    slashCommand: {
        enabled: true,
        options: [{
            name: 'zustand',
            description: 'music:MODE247.STATE_DESC',
            type: ApplicationCommandOptionType.Boolean,
            required: true
        }]
    },

    async messageRun(ctx) {
        const wort = (ctx.args[0] || '').toLowerCase();
        await schalten(ctx, ['an', 'ein', 'on', 'true'].includes(wort));
    },
    async interactionRun(ctx) { await schalten(ctx, ctx.interaction.options.getBoolean('zustand')); }
};

/**
 * @param {Object} ctx Befehlskontext
 * @param {boolean} an Zustand
 */
async function schalten(ctx, an) {
    const mitglied = mitgliedAus(ctx);
    const p = await pruefen(mitglied, { brauchtSteuerrecht: true, brauchtAbspieler: true });
    if (!p.ok) return melden(ctx, antwort(p.fehler, 'warnung'));

    p.abspieler.dauerbetriebSetzen(an);

    // Auch fuer den naechsten Start merken
    await MusicSettings.updateSettings(mitglied.guild.id, {
        mode_247: an ? 1 : 0,
        mode_247_channel: an ? p.abspieler.sprachKanalId : null
    });

    return melden(ctx, antwort(an
        ? 'Dauerbetrieb **an** — ich bleibe im Sprachkanal, auch wenn nichts laeuft.'
        : 'Dauerbetrieb **aus** — ich gehe wieder, wenn nichts mehr kommt.'));
}
