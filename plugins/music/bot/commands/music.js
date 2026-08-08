const { ApplicationCommandOptionType } = require('discord.js');
const klangfilter = require('../klangfilter');
const { holen: vorschlaegeHolen } = require('../quellen/vorschlaege');

const play = require('./sub/_play');
const skip = require('./sub/_skip');
const stop = require('./sub/_stop');
const pause = require('./sub/_pause');
const resume = require('./sub/_resume');
const disconnect = require('./sub/_disconnect');
const queue = require('./sub/_queue');
const nowplaying = require('./sub/_nowplaying');
const volume = require('./sub/_volume');
const loop = require('./sub/_loop');
const shuffle = require('./sub/_shuffle');
const remove = require('./sub/_remove');
const filter = require('./sub/_filter');
const mode247 = require('./sub/_mode247');
const autoplay = require('./sub/_autoplay');
const voteskip = require('./sub/_voteskip');
const move = require('./sub/_move');
const replay = require('./sub/_replay');
const similar = require('./sub/_similar');
const history = require('./sub/_history');
const fix = require('./sub/_fix');
const save = require('./sub/_save');
const load = require('./sub/_load');
const playlists = require('./sub/_playlists');
const unsave = require('./sub/_unsave');

/**
 * Musik - alle Befehle unter einem Dach.
 *
 * Bis zum 2026-08-07 lagen sie als 16 eigene Schraegstrich-Befehle vor. Bei
 * einem Bot mit zehn Plugins wird die Befehlsliste im Discord damit
 * unuebersichtlich - Diva bringt allein rund 80 eigene Eintraege mit. Jetzt
 * haengt alles unter `/music <unterbefehl>`.
 *
 * Discord erlaubt hoechstens 25 Unterbefehle je Befehl - und **genau 25 sind
 * es jetzt**. Wer einen weiteren braucht, muss zuerst zwei zusammenlegen oder
 * eine Untergruppe aufmachen. Deshalb sind `removedupes` und `leavecleanup`
 * keine eigenen Befehle geworden, sondern Schalter an `remove`, und `playfile`
 * ist ein Anhang an `play`.
 *
 * @type {import('dunebot-sdk').CommandType}
 */
module.exports = {
    name: 'music',
    description: 'music:DESCRIPTION',
    botPermissions: ['Connect', 'Speak'],
    command: {
        enabled: true,
        aliases: ['m', 'musik'],
        minArgsCount: 1,
        subcommands: [
            { trigger: 'play <Adresse|Suchbegriff>', description: 'music:PLAY.DESCRIPTION' },
            { trigger: 'skip [Anzahl]', description: 'music:SKIP.DESCRIPTION' },
            { trigger: 'stop', description: 'music:STOP.DESCRIPTION' },
            { trigger: 'pause', description: 'music:PAUSE.DESCRIPTION' },
            { trigger: 'resume', description: 'music:RESUME.DESCRIPTION' },
            { trigger: 'queue [Seite]', description: 'music:QUEUE.DESCRIPTION' },
            { trigger: 'nowplaying', description: 'music:NOWPLAYING.DESCRIPTION' },
            { trigger: 'volume [0-200]', description: 'music:VOLUME.DESCRIPTION' },
            { trigger: 'loop <aus|titel|liste>', description: 'music:LOOP.DESCRIPTION' },
            { trigger: 'shuffle', description: 'music:SHUFFLE.DESCRIPTION' },
            { trigger: 'remove <Nummer>', description: 'music:REMOVE.DESCRIPTION' },
            { trigger: 'filter [Name]', description: 'music:FILTER.DESCRIPTION' },
            { trigger: '247 <an|aus>', description: 'music:MODE247.DESCRIPTION' },
            { trigger: 'autoplay <an|aus>', description: 'music:AUTOPLAY.DESCRIPTION' },
            { trigger: 'voteskip', description: 'music:VOTESKIP.DESCRIPTION' },
            { trigger: 'leave', description: 'music:DISCONNECT.DESCRIPTION' },
            { trigger: 'move <von> <nach>', description: 'music:MOVE.DESCRIPTION' },
            { trigger: 'replay', description: 'music:REPLAY.DESCRIPTION' },
            { trigger: 'similar [Anzahl]', description: 'music:SIMILAR.DESCRIPTION' },
            { trigger: 'history [Nummer]', description: 'music:HISTORY.DESCRIPTION' },
            { trigger: 'fix', description: 'music:FIX.DESCRIPTION' },
            { trigger: 'save <Name>', description: 'music:SAVE.DESCRIPTION' },
            { trigger: 'load <Name>', description: 'music:LOAD.DESCRIPTION' },
            { trigger: 'playlists [Name]', description: 'music:PLAYLISTS.DESCRIPTION' },
            { trigger: 'unsave <Name>', description: 'music:UNSAVE.DESCRIPTION' }
        ]
    },
    slashCommand: {
        enabled: true,
        options: [
            {
                name: 'play',
                description: 'music:PLAY.DESCRIPTION',
                type: ApplicationCommandOptionType.Subcommand,
                options: [
                    { name: 'eingabe', description: 'music:PLAY.INPUT_DESC', type: ApplicationCommandOptionType.String, required: false, autocomplete: true },
                    { name: 'zuerst', description: 'music:PLAY.FIRST_DESC', type: ApplicationCommandOptionType.Boolean, required: false },
                    // Statt eines eigenen `playfile`: die Quelle `direct` traegt
                    // Anhaenge ohnehin, es fehlte nur der Weg hinein.
                    { name: 'datei', description: 'music:PLAY.FILE_DESC', type: ApplicationCommandOptionType.Attachment, required: false }
                ]
            },
            {
                name: 'skip',
                description: 'music:SKIP.DESCRIPTION',
                type: ApplicationCommandOptionType.Subcommand,
                options: [
                    { name: 'anzahl', description: 'music:SKIP.COUNT_DESC', type: ApplicationCommandOptionType.Integer, required: false, minValue: 1, maxValue: 50 }
                ]
            },
            { name: 'stop', description: 'music:STOP.DESCRIPTION', type: ApplicationCommandOptionType.Subcommand },
            { name: 'pause', description: 'music:PAUSE.DESCRIPTION', type: ApplicationCommandOptionType.Subcommand },
            { name: 'resume', description: 'music:RESUME.DESCRIPTION', type: ApplicationCommandOptionType.Subcommand },
            {
                name: 'queue',
                description: 'music:QUEUE.DESCRIPTION',
                type: ApplicationCommandOptionType.Subcommand,
                options: [
                    { name: 'seite', description: 'music:QUEUE.PAGE_DESC', type: ApplicationCommandOptionType.Integer, required: false, minValue: 1 }
                ]
            },
            { name: 'nowplaying', description: 'music:NOWPLAYING.DESCRIPTION', type: ApplicationCommandOptionType.Subcommand },
            {
                name: 'volume',
                description: 'music:VOLUME.DESCRIPTION',
                type: ApplicationCommandOptionType.Subcommand,
                options: [
                    { name: 'wert', description: 'music:VOLUME.VALUE_DESC', type: ApplicationCommandOptionType.Integer, required: false, minValue: 0, maxValue: 200 }
                ]
            },
            {
                name: 'loop',
                description: 'music:LOOP.DESCRIPTION',
                type: ApplicationCommandOptionType.Subcommand,
                options: [
                    {
                        name: 'modus', description: 'music:LOOP.MODE_DESC',
                        type: ApplicationCommandOptionType.String, required: true,
                        choices: [
                            { name: 'Aus', value: 'aus' },
                            { name: 'Titel wiederholen', value: 'titel' },
                            { name: 'Warteschlange wiederholen', value: 'liste' }
                        ]
                    }
                ]
            },
            { name: 'shuffle', description: 'music:SHUFFLE.DESCRIPTION', type: ApplicationCommandOptionType.Subcommand },
            {
                name: 'remove',
                description: 'music:REMOVE.DESCRIPTION',
                type: ApplicationCommandOptionType.Subcommand,
                options: [
                    { name: 'nummer', description: 'music:REMOVE.POSITION_DESC', type: ApplicationCommandOptionType.Integer, required: false, minValue: 1 },
                    { name: 'doppelte', description: 'music:REMOVE.DUPES_DESC', type: ApplicationCommandOptionType.Boolean, required: false },
                    { name: 'abwesende', description: 'music:REMOVE.GONE_DESC', type: ApplicationCommandOptionType.Boolean, required: false }
                ]
            },
            {
                name: 'filter',
                description: 'music:FILTER.DESCRIPTION',
                type: ApplicationCommandOptionType.Subcommand,
                options: [
                    {
                        name: 'name', description: 'music:FILTER.NAME_DESC',
                        type: ApplicationCommandOptionType.String, required: false,
                        choices: klangfilter.auswahl().map(f => ({ name: f.name, value: f.wert }))
                    }
                ]
            },
            {
                name: '247',
                description: 'music:MODE247.DESCRIPTION',
                type: ApplicationCommandOptionType.Subcommand,
                options: [
                    { name: 'zustand', description: 'music:MODE247.STATE_DESC', type: ApplicationCommandOptionType.Boolean, required: true }
                ]
            },
            {
                name: 'autoplay',
                description: 'music:AUTOPLAY.DESCRIPTION',
                type: ApplicationCommandOptionType.Subcommand,
                options: [
                    { name: 'zustand', description: 'music:AUTOPLAY.STATE_DESC', type: ApplicationCommandOptionType.Boolean, required: true }
                ]
            },
            { name: 'voteskip', description: 'music:VOTESKIP.DESCRIPTION', type: ApplicationCommandOptionType.Subcommand },
            { name: 'leave', description: 'music:DISCONNECT.DESCRIPTION', type: ApplicationCommandOptionType.Subcommand },
            {
                name: 'move',
                description: 'music:MOVE.DESCRIPTION',
                type: ApplicationCommandOptionType.Subcommand,
                options: [
                    { name: 'von', description: 'music:MOVE.FROM_DESC', type: ApplicationCommandOptionType.Integer, required: true, minValue: 1 },
                    { name: 'nach', description: 'music:MOVE.TO_DESC', type: ApplicationCommandOptionType.Integer, required: true, minValue: 1 }
                ]
            },
            { name: 'replay', description: 'music:REPLAY.DESCRIPTION', type: ApplicationCommandOptionType.Subcommand },
            {
                name: 'similar',
                description: 'music:SIMILAR.DESCRIPTION',
                type: ApplicationCommandOptionType.Subcommand,
                options: [
                    { name: 'anzahl', description: 'music:SIMILAR.COUNT_DESC', type: ApplicationCommandOptionType.Integer, required: false, minValue: 1, maxValue: 10 }
                ]
            },
            {
                name: 'history',
                description: 'music:HISTORY.DESCRIPTION',
                type: ApplicationCommandOptionType.Subcommand,
                options: [
                    { name: 'nummer', description: 'music:HISTORY.POSITION_DESC', type: ApplicationCommandOptionType.Integer, required: false, minValue: 1 }
                ]
            },
            { name: 'fix', description: 'music:FIX.DESCRIPTION', type: ApplicationCommandOptionType.Subcommand },
            {
                name: 'save',
                description: 'music:SAVE.DESCRIPTION',
                type: ApplicationCommandOptionType.Subcommand,
                options: [
                    { name: 'name', description: 'music:SAVE.NAME_DESC', type: ApplicationCommandOptionType.String, required: true }
                ]
            },
            {
                name: 'load',
                description: 'music:LOAD.DESCRIPTION',
                type: ApplicationCommandOptionType.Subcommand,
                options: [
                    { name: 'name', description: 'music:LOAD.NAME_DESC', type: ApplicationCommandOptionType.String, required: true }
                ]
            },
            {
                name: 'playlists',
                description: 'music:PLAYLISTS.DESCRIPTION',
                type: ApplicationCommandOptionType.Subcommand,
                options: [
                    { name: 'name', description: 'music:PLAYLISTS.NAME_DESC', type: ApplicationCommandOptionType.String, required: false }
                ]
            },
            {
                name: 'unsave',
                description: 'music:UNSAVE.DESCRIPTION',
                type: ApplicationCommandOptionType.Subcommand,
                options: [
                    { name: 'name', description: 'music:UNSAVE.NAME_DESC', type: ApplicationCommandOptionType.String, required: true }
                ]
            }
        ]
    },

    async messageRun({ message, args }) {
        const unterbefehl = (args[0] || '').toLowerCase();
        const rest = args.slice(1);
        const mitglied = message.member;

        const antwort = await ausfuehren(unterbefehl, mitglied, {
            eingabe: rest.join(' '),
            zahl: parseInt(rest[0], 10),
            // Fuer `move <von> <nach>`; alle anderen brauchen nur die erste Zahl
            zahl2: parseInt(rest[1], 10),
            wort: (rest[0] || '').toLowerCase(),
            textKanalId: message.channelId
        });

        await message.reply(antwort);
    },

    async interactionRun({ interaction }) {
        const unterbefehl = interaction.options.getSubcommand();

        // Ein Anhang ist auch nur eine Adresse. Die Quelle `direct` schickt sie
        // ohne Umweg an ffmpeg - dafuer braucht es keinen eigenen Befehl.
        const anhang = unterbefehl === 'play' ? interaction.options.getAttachment('datei') : null;

        const antwort = await ausfuehren(unterbefehl, interaction.member, {
            eingabe: anhang?.url || interaction.options.getString('eingabe'),
            zuerst: interaction.options.getBoolean('zuerst') || false,
            anzahl: interaction.options.getInteger('anzahl'),
            seite: interaction.options.getInteger('seite'),
            wert: interaction.options.getInteger('wert'),
            nummer: interaction.options.getInteger('nummer'),
            von: interaction.options.getInteger('von'),
            nach: interaction.options.getInteger('nach'),
            modus: interaction.options.getString('modus'),
            name: interaction.options.getString('name'),
            zustand: interaction.options.getBoolean('zustand'),
            doppelte: interaction.options.getBoolean('doppelte'),
            abwesende: interaction.options.getBoolean('abwesende'),
            textKanalId: interaction.channelId
        });

        await interaction.followUp(antwort);
    },

    /**
     * Trefferliste waehrend des Tippens bei `/music play`.
     *
     * Der Wert eines Vorschlags ist die YouTube-Adresse, nicht der Titel. So
     * spielt genau das, was in der Liste stand - eine zweite Suche beim
     * Abspielen koennte einen anderen Treffer liefern.
     *
     * Nimmt der Nutzer keinen Vorschlag an, sondern tippt einfach weiter und
     * schickt ab, kommt sein Text unveraendert bei `play` an. Die Liste ist ein
     * Angebot, keine Pflicht.
     */
    async autocomplete({ interaction }) {
        try {
            const feld = interaction.options.getFocused(true);

            // Nur das Eingabefeld von `play` bekommt eine Liste
            if (feld?.name !== 'eingabe') return await interaction.respond([]);

            const vorschlaege = await vorschlaegeHolen(feld.value, interaction.user.id, interaction.guildId);
            await interaction.respond(vorschlaege);
        } catch {
            // Eine leere Liste ist die einzige Antwort, die Discord nie stoert
            try { await interaction.respond([]); } catch { /* Frist schon abgelaufen */ }
        }
    }
};

/** Wortformen, die als "an" gelten - fuer den Aufruf per Nachricht. */
const JA = ['an', 'ein', 'on', 'true', 'ja'];

/**
 * Einen Unterbefehl ausfuehren.
 *
 * Beide Aufrufwege - Schraegstrich und Nachricht - landen hier, damit die
 * Zuordnung nur einmal existiert.
 *
 * @param {string} unterbefehl Name des Unterbefehls
 * @param {Object} mitglied Discord-GuildMember
 * @param {Object} o Gesammelte Argumente beider Aufrufwege
 * @returns {Promise<Object>} Antwort
 */
async function ausfuehren(unterbefehl, mitglied, o) {
    switch (unterbefehl) {
        case 'play':
            return await play(mitglied, o.eingabe, Boolean(o.zuerst), o.textKanalId);

        case 'skip':
            return await skip(mitglied, o.anzahl ?? (Number.isNaN(o.zahl) ? 1 : o.zahl));

        case 'stop':       return await stop(mitglied);
        case 'pause':      return await pause(mitglied);
        case 'resume':     return await resume(mitglied);
        case 'shuffle':    return await shuffle(mitglied);
        case 'nowplaying': return await nowplaying(mitglied);
        case 'voteskip':   return await voteskip(mitglied);
        case 'leave':      return await disconnect(mitglied);

        case 'queue':
            return await queue(mitglied, o.seite ?? (Number.isNaN(o.zahl) ? 1 : o.zahl));

        case 'volume': {
            // Ohne Wert nur nachschauen
            const wert = o.wert ?? (Number.isNaN(o.zahl) ? null : o.zahl);
            return await volume(mitglied, wert);
        }

        case 'remove':
            return await remove(mitglied, {
                nummer: o.nummer ?? (Number.isNaN(o.zahl) ? null : o.zahl),
                // Im Chat: `!music remove doppelte`
                doppelte: o.doppelte ?? o.wort === 'doppelte',
                abwesende: o.abwesende ?? o.wort === 'abwesende'
            });

        case 'move':
            return await move(
                mitglied,
                o.von ?? (Number.isNaN(o.zahl) ? null : o.zahl),
                o.nach ?? (Number.isNaN(o.zahl2) ? null : o.zahl2)
            );

        case 'replay': return await replay(mitglied);
        case 'fix':    return await fix(mitglied);

        case 'similar':
            return await similar(mitglied, o.anzahl ?? (Number.isNaN(o.zahl) ? 1 : o.zahl));

        case 'history':
            return await history(mitglied, o.nummer ?? (Number.isNaN(o.zahl) ? null : o.zahl));

        case 'save':
            return await save(mitglied, o.name ?? o.eingabe);

        case 'load':
            return await load(mitglied, o.name ?? o.eingabe, o.textKanalId);

        case 'playlists':
            return await playlists(mitglied, o.name ?? (o.eingabe || null));

        case 'unsave':
            return await unsave(mitglied, o.name ?? o.eingabe);

        case 'loop':
            return await loop(mitglied, o.modus ?? o.wort);

        case 'filter':
            return await filter(mitglied, o.name ?? (o.wort || null));

        case '247':
            return await mode247(mitglied, o.zustand ?? JA.includes(o.wort));

        case 'autoplay':
            return await autoplay(mitglied, o.zustand ?? JA.includes(o.wort));

        default:
            return {
                embeds: [{
                    color: 0xF59F00,
                    description: 'Unbekannter Unterbefehl. Nutze `/music` und waehle aus der Liste.'
                }]
            };
    }
}
