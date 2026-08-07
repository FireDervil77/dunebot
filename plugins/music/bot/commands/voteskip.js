const { antwort, pruefen, melden, mitgliedAus, titelZeile } = require('../utils');
const { MusicSettings } = require('../../shared/models');

/**
 * @type {import('dunebot-sdk').CommandType}
 */
module.exports = {
    name: 'voteskip',
    description: 'music:VOTESKIP.DESCRIPTION',
    command: { enabled: true, aliases: ['vs'], minArgsCount: 0 },
    slashCommand: { enabled: true, options: [] },

    async messageRun(ctx) { await abstimmen(ctx); },
    async interactionRun(ctx) { await abstimmen(ctx); }
};

/** @param {Object} ctx Befehlskontext */
async function abstimmen(ctx) {
    const mitglied = mitgliedAus(ctx);

    // Hier ausdruecklich ohne Steuerrecht: darum geht es ja gerade
    const p = await pruefen(mitglied, { brauchtSprachkanal: true, brauchtAbspieler: true });
    if (!p.ok) return melden(ctx, antwort(p.fehler, 'warnung'));

    const einstellungen = await MusicSettings.getSettings(mitglied.guild.id);
    if (!einstellungen.vote_skip_enabled) {
        return melden(ctx, antwort('Abstimmungen sind auf diesem Server abgeschaltet.', 'warnung'));
    }

    const aktuell = p.abspieler.aktuell;

    // Wer ohnehin steuern darf, braucht keine Abstimmung
    if (await p.manager.darfSteuern(mitglied)) {
        p.abspieler.ueberspringen(1);
        return melden(ctx, antwort(`Uebersprungen: ${aktuell ? titelZeile(aktuell) : '—'}`));
    }

    const zuhoerer = mitglied.voice.channel.members.filter(m => !m.user.bot).size;
    const ergebnis = p.abspieler.abstimmen(mitglied.id, zuhoerer, einstellungen.vote_skip_percent || 50);

    if (ergebnis.schonGestimmt && !ergebnis.erreicht) {
        return melden(ctx, antwort(
            `Du hast schon gestimmt. **${ergebnis.gezaehlt}/${ergebnis.noetig}** Stimmen.`, 'warnung'
        ));
    }

    if (ergebnis.erreicht) {
        p.abspieler.ueberspringen(1);
        return melden(ctx, antwort(
            `Genug Stimmen (**${ergebnis.gezaehlt}/${ergebnis.noetig}**) — uebersprungen: ` +
            `${aktuell ? titelZeile(aktuell) : '—'}`
        ));
    }

    return melden(ctx, antwort(`Stimme gezaehlt: **${ergebnis.gezaehlt}/${ergebnis.noetig}**.`));
}
