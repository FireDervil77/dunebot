const { ApplicationCommandOptionType } = require('discord.js');
const { antwort, pruefen, melden, mitgliedAus } = require('../utils');
const { MusicSettings } = require('../../shared/models');

/**
 * @type {import('dunebot-sdk').CommandType}
 */
module.exports = {
    name: 'autoplay',
    description: 'music:AUTOPLAY.DESCRIPTION',
    command: { enabled: true, usage: '<an|aus>', minArgsCount: 0 },
    slashCommand: {
        enabled: true,
        options: [{
            name: 'zustand',
            description: 'music:AUTOPLAY.STATE_DESC',
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

    p.abspieler.autoplaySetzen(an);
    await MusicSettings.updateSettings(mitglied.guild.id, { autoplay: an ? 1 : 0 });

    return melden(ctx, antwort(an
        ? 'Autoplay **an** — wenn die Warteschlange leer laeuft, suche ich passende Titel nach.'
        : 'Autoplay **aus** — nach dem letzten Titel ist Schluss.'));
}
