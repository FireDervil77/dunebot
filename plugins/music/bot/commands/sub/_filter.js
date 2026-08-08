const { antwort, pruefen } = require('../../utils');
const klangfilter = require('../../klangfilter');
const { MusicSettings } = require('../../../shared/models');

/**
 * @param {Object} mitglied Discord-GuildMember
 * @param {string|null} name Filtername, oder null zum Abfragen
 */
module.exports = async (mitglied, name) => {
    const nurLesen = !name;

    const p = await pruefen(mitglied, {
        brauchtSprachkanal: !nurLesen,
        brauchtSteuerrecht: !nurLesen,
        brauchtAbspieler: !nurLesen
    });
    if (!p.ok) return antwort(p.fehler, 'warnung');

    if (nurLesen) {
        const einstellungen = await MusicSettings.getSettings(mitglied.guild.id);
        const aktiv = p.abspieler?.filter || einstellungen.audio_filter || 'aus';
        const liste = klangfilter.auswahl().map(f => `\`${f.wert}\` ${f.name}`).join(' · ');
        return antwort(`Aktiver Filter: **${klangfilter.holen(aktiv).name}**\n\n${liste}`);
    }

    if (!p.abspieler.filterSetzen(name)) return antwort('Diesen Filter kenne ich nicht.', 'warnung');

    const filter = klangfilter.holen(name);
    const hinweis = filter.tempo !== 1
        ? '\n\nDieser Filter aendert das Tempo — die angezeigte Dauer stimmt dann nicht mehr genau.'
        : '';

    return antwort(
        `Filter auf **${filter.name}** gesetzt. Er greift ab dem naechsten Titel — ` +
        `mit \`/music skip\` sofort.${hinweis}`
    );
};
