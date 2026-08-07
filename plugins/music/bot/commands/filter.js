const { ApplicationCommandOptionType } = require('discord.js');
const { antwort, pruefen, melden, mitgliedAus } = require('../utils');
const klangfilter = require('../klangfilter');
const { MusicSettings } = require('../../shared/models');

/**
 * @type {import('dunebot-sdk').CommandType}
 */
module.exports = {
    name: 'filter',
    description: 'music:FILTER.DESCRIPTION',
    command: { enabled: true, usage: '<Filter>', minArgsCount: 0 },
    slashCommand: {
        enabled: true,
        options: [{
            name: 'name',
            description: 'music:FILTER.NAME_DESC',
            type: ApplicationCommandOptionType.String,
            required: false,
            // Discord erlaubt hoechstens 25 Auswahlpunkte - wir haben neun
            choices: klangfilter.auswahl().map(f => ({ name: f.name, value: f.wert }))
        }]
    },

    async messageRun(ctx) { await setzen(ctx, (ctx.args[0] || '').toLowerCase() || null); },
    async interactionRun(ctx) { await setzen(ctx, ctx.interaction.options.getString('name')); }
};

/**
 * @param {Object} ctx Befehlskontext
 * @param {string|null} name Filtername, oder null zum Abfragen
 */
async function setzen(ctx, name) {
    const mitglied = mitgliedAus(ctx);
    const nurLesen = !name;

    const p = await pruefen(mitglied, {
        brauchtSprachkanal: !nurLesen,
        brauchtSteuerrecht: !nurLesen,
        brauchtAbspieler: !nurLesen
    });
    if (!p.ok) return melden(ctx, antwort(p.fehler, 'warnung'));

    if (nurLesen) {
        const einstellungen = await MusicSettings.getSettings(mitglied.guild.id);
        const aktiv = p.abspieler?.filter || einstellungen.audio_filter || 'aus';
        const liste = klangfilter.auswahl().map(f => `\`${f.wert}\` ${f.name}`).join(' · ');
        return melden(ctx, antwort(`Aktiver Filter: **${klangfilter.holen(aktiv).name}**\n\n${liste}`));
    }

    if (!p.abspieler.filterSetzen(name)) {
        return melden(ctx, antwort('Diesen Filter kenne ich nicht.', 'warnung'));
    }

    const filter = klangfilter.holen(name);
    const hinweis = filter.tempo !== 1
        ? '\n\nDieser Filter aendert das Tempo — die angezeigte Dauer stimmt dann nicht mehr genau.'
        : '';

    return melden(ctx, antwort(
        `Filter auf **${filter.name}** gesetzt. Er greift ab dem naechsten Titel — ` +
        `mit \`/skip\` sofort.${hinweis}`
    ));
}
