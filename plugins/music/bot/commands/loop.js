const { ApplicationCommandOptionType } = require('discord.js');
const { antwort, pruefen, melden, mitgliedAus } = require('../utils');
const GuildPlayer = require('../managers/GuildPlayer');

/** Was der Nutzer eingibt, auf den inneren Modus abbilden. */
const MODI = {
    aus: GuildPlayer.WIEDERHOLUNG.AUS,
    off: GuildPlayer.WIEDERHOLUNG.AUS,
    titel: GuildPlayer.WIEDERHOLUNG.TITEL,
    track: GuildPlayer.WIEDERHOLUNG.TITEL,
    liste: GuildPlayer.WIEDERHOLUNG.LISTE,
    queue: GuildPlayer.WIEDERHOLUNG.LISTE
};

const BESCHREIBUNG = {
    aus: 'Wiederholung ist **aus**.',
    titel: 'Der laufende Titel wiederholt sich.',
    liste: 'Die ganze Warteschlange wiederholt sich.'
};

/**
 * @type {import('dunebot-sdk').CommandType}
 */
module.exports = {
    name: 'loop',
    description: 'music:LOOP.DESCRIPTION',
    command: { enabled: true, usage: '<aus|titel|liste>', minArgsCount: 0 },
    slashCommand: {
        enabled: true,
        options: [{
            name: 'modus',
            description: 'music:LOOP.MODE_DESC',
            type: ApplicationCommandOptionType.String,
            required: true,
            choices: [
                { name: 'Aus', value: 'aus' },
                { name: 'Titel wiederholen', value: 'titel' },
                { name: 'Warteschlange wiederholen', value: 'liste' }
            ]
        }]
    },

    async messageRun(ctx) { await setzen(ctx, (ctx.args[0] || '').toLowerCase()); },
    async interactionRun(ctx) { await setzen(ctx, ctx.interaction.options.getString('modus')); }
};

/**
 * @param {Object} ctx Befehlskontext
 * @param {string} eingabe Gewuenschter Modus
 */
async function setzen(ctx, eingabe) {
    const mitglied = mitgliedAus(ctx);
    const p = await pruefen(mitglied, { brauchtSteuerrecht: true, brauchtAbspieler: true });
    if (!p.ok) return melden(ctx, antwort(p.fehler, 'warnung'));

    const modus = MODI[eingabe];
    if (!modus) {
        return melden(ctx, antwort('Waehle `aus`, `titel` oder `liste`.', 'warnung'));
    }

    p.abspieler.wiederholungSetzen(modus);
    return melden(ctx, antwort(BESCHREIBUNG[modus]));
}
