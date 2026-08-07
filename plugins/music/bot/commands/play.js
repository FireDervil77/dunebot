const { ApplicationCommandOptionType } = require('discord.js');
const { aufloesen } = require('../quellen');
const { antwort, pruefen, melden, mitgliedAus, textKanalAus, titelZeile, spielzeitText, hinweisText } = require('../utils');
const { MusicSettings } = require('../../shared/models');

/**
 * @type {import('dunebot-sdk').CommandType}
 */
module.exports = {
    name: 'play',
    description: 'music:PLAY.DESCRIPTION',
    botPermissions: ['Connect', 'Speak'],
    command: {
        enabled: true,
        usage: '<Adresse oder Suchbegriff>',
        minArgsCount: 1
    },
    slashCommand: {
        enabled: true,
        options: [
            {
                name: 'eingabe',
                description: 'music:PLAY.INPUT_DESC',
                type: ApplicationCommandOptionType.String,
                required: true
            },
            {
                name: 'zuerst',
                description: 'music:PLAY.FIRST_DESC',
                type: ApplicationCommandOptionType.Boolean,
                required: false
            }
        ]
    },

    async messageRun(ctx) {
        const eingabe = ctx.args.join(' ');
        await abspielen(ctx, eingabe, false);
    },

    async interactionRun(ctx) {
        const eingabe = ctx.interaction.options.getString('eingabe');
        const zuerst = ctx.interaction.options.getBoolean('zuerst') || false;
        await abspielen(ctx, eingabe, zuerst);
    }
};

/**
 * Eingabe aufloesen, in die Warteschlange legen und notfalls starten.
 *
 * @param {Object} ctx Befehlskontext
 * @param {string} eingabe Adresse oder Suchbegriff
 * @param {boolean} zuerst Vorne einreihen
 */
async function abspielen(ctx, eingabe, zuerst) {
    const mitglied = mitgliedAus(ctx);

    const p = await pruefen(mitglied, { brauchtSprachkanal: true });
    if (!p.ok) return melden(ctx, antwort(p.fehler, 'warnung'));

    const sprachKanal = mitglied.voice.channel;

    if (!(await p.manager.kanalErlaubt(mitglied.guild.id, sprachKanal.id))) {
        return melden(ctx, antwort('In diesem Sprachkanal ist Musik nicht freigegeben.', 'warnung'));
    }

    const einstellungen = await MusicSettings.getSettings(mitglied.guild.id);
    const ergebnis = await aufloesen(eingabe, { angefordertVon: mitglied.id, einstellungen });

    if (ergebnis.titel.length === 0) {
        return melden(ctx, antwort(hinweisText(ergebnis.hinweis), 'warnung'));
    }

    const abspieler = p.manager.holen(mitglied.guild.id);

    try {
        await abspieler.beitreten(sprachKanal, textKanalAus(ctx));
    } catch {
        return melden(ctx, antwort('Ich komme in den Sprachkanal nicht hinein.', 'fehler'));
    }

    const { aufgenommen, abgewiesen } = await abspieler.hinzufuegen(ergebnis.titel, { anfang: zuerst });

    if (aufgenommen === 0) {
        return melden(ctx, antwort('Nichts aufgenommen — die Warteschlange ist voll oder die Titel sind zu lang.', 'warnung'));
    }

    const liefSchon = Boolean(abspieler.aktuell);
    await abspieler.starten();

    // Bei Spotify sagen wir gleich dazu, woher der Ton wirklich kommt
    const spotifyHinweis = ergebnis.quelle === 'spotify'
        ? '\n\n*Spotify liefert keinen Ton. Ich suche die Titel auf YouTube.*'
        : '';

    if (aufgenommen === 1) {
        const t = ergebnis.titel[0];
        return melden(ctx, antwort(
            (liefSchon ? '**In die Warteschlange:**\n' : '**Wird abgespielt:**\n') +
            titelZeile(t) + spotifyHinweis
        ));
    }

    const spielzeit = ergebnis.titel.reduce((s, t) => s + (t.durationSec || 0), 0);
    const abgewiesenText = abgewiesen > 0 ? `\n${abgewiesen} Titel wurden abgewiesen.` : '';

    return melden(ctx, antwort(
        `**${aufgenommen} Titel** aufgenommen (${spielzeitText(spielzeit)}).${abgewiesenText}${spotifyHinweis}`
    ));
}
