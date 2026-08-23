'use strict';

const { ApplicationCommandOptionType } = require('discord.js');
const modelle = require('../../shared/models');

/**
 * Streaming - alle Befehle unter einem Dach.
 *
 * Bewusst wenige: Was man **einmal einrichtet**, gehoert ins Dashboard; in den
 * Discord gehoert, was man **waehrend** eines Streams braucht. Der Marktfuehrer
 * faehrt mit sieben Slash-Befehlen und rund fuenfzig Dashboard-Einstellungen -
 * und das aus gutem Grund: Wer das Eintragen im Discord nachbaut, hat zwei
 * Oberflaechen zu pflegen und eine davon schlecht.
 *
 * Untergruppen kaeme das Befehlsgeruest ohnehin nicht mit
 * (`apps/bot/handler.js` kennt nur Subcommand, keine SubcommandGroup).
 *
 * @type {import('dunebot-sdk').CommandType}
 */
module.exports = {
    name: 'streaming',
    description: 'streaming:DESCRIPTION',
    command: {
        enabled: true,
        aliases: ['stream', 'live'],
        minArgsCount: 0,
        subcommands: [
            { trigger: 'live',   description: 'streaming:CMD.LIVE' },
            { trigger: 'liste',  description: 'streaming:CMD.LIST' },
            { trigger: 'status', description: 'streaming:CMD.STATUS' },
            { trigger: 'hilfe',  description: 'streaming:CMD.HELP' }
        ]
    },
    slashCommand: {
        enabled: true,
        options: [
            { name: 'live',   description: 'streaming:CMD.LIVE',   type: ApplicationCommandOptionType.Subcommand },
            { name: 'liste',  description: 'streaming:CMD.LIST',   type: ApplicationCommandOptionType.Subcommand },
            { name: 'status', description: 'streaming:CMD.STATUS', type: ApplicationCommandOptionType.Subcommand },
            { name: 'hilfe',  description: 'streaming:CMD.HELP',   type: ApplicationCommandOptionType.Subcommand }
        ]
    },

    /**
     * @param {Object} kontext Kontext
     * @param {Object} kontext.message Nachricht
     * @param {Array} kontext.args Argumente
     * @returns {Promise<Object>} Antwort
     */
    async messageRun({ message, args }) {
        return await ausfuehren(args[0] || 'hilfe', message.guild?.id);
    },

    /**
     * @param {Object} kontext Kontext
     * @param {Object} kontext.interaction Interaktion
     * @returns {Promise<Object>} Antwort
     */
    async interactionRun({ interaction }) {
        return await ausfuehren(interaction.options.getSubcommand(), interaction.guildId);
    }
};

const FARBE = 0x9146FF;

/**
 * Fuehrt einen Unterbefehl aus.
 *
 * @param {string} unterbefehl Unterbefehl
 * @param {string} guildId Discord-Guild-ID
 * @returns {Promise<Object>} Antwort fuer Discord
 */
async function ausfuehren(unterbefehl, guildId) {
    if (!guildId) return karte('Das geht nur auf einem Server.');

    switch (unterbefehl) {
        case 'live': {
            const alle = await modelle.streamerDerGuild(guildId);
            const live = alle.filter(s => s.ist_live);

            if (live.length === 0) return karte('Gerade sendet niemand aus der Liste dieses Servers.');

            return karte(
                live.map(s => {
                    const was = s.kategorie ? ` — ${s.kategorie}` : '';
                    return `**${s.anzeigename || s.login}**${was}\n${s.titel || ''}`;
                }).join('\n\n'),
                `${live.length} gerade live`
            );
        }

        case 'liste': {
            const alle = await modelle.streamerDerGuild(guildId);
            if (alle.length === 0) {
                return karte('Dieser Server beobachtet noch keinen Kanal. Eingerichtet wird das im Dashboard.');
            }
            return karte(
                alle.map(s => `${s.ist_live ? '●' : '○'} ${s.anzeigename || s.login} (${s.plattform})`).join('\n'),
                `${alle.length} beobachtete Kanaele`
            );
        }

        case 'status': {
            const z = await modelle.zustandDerGuild(guildId);

            // Auch hier gilt: lieber die Luecke zeigen als "alles gut" behaupten.
            const gehoert = z.letzteMeldungAm
                ? `<t:${Math.floor(new Date(z.letzteMeldungAm).getTime() / 1000)}:R>`
                : 'noch nie';

            const zeilen = [
                `Ueberwacht: **${z.ueberwacht}** Kanaele, davon **${z.live}** live`,
                `Zuletzt gehoert: ${gehoert}`,
                `Offene Auftraege: ${z.offeneAuftraege}`
            ];
            if (z.gescheitert > 0)          zeilen.push(`⚠ Aufgegeben: ${z.gescheitert}`);
            if (z.kaputteAbos.length > 0)   zeilen.push(`⚠ Abos gestoert: ${z.kaputteAbos.map(a => a.login).join(', ')}`);

            return karte(zeilen.join('\n'), 'Betriebszustand');
        }

        case 'hilfe':
        default:
            return karte(
                'Eingerichtet wird Streaming im Dashboard: Kanaele eintragen, Ziel und Text festlegen.\n\n' +
                'Hier im Discord gibt es nur, was waehrend eines Streams zaehlt:\n' +
                '`/streaming live` · `/streaming liste` · `/streaming status`',
                'Streaming'
            );
    }
}

/**
 * Einheitliche Antwortkarte.
 *
 * @param {string} text Inhalt
 * @param {string|null} [titel] Ueberschrift
 * @returns {Object} Discord-Antwort
 */
function karte(text, titel = null) {
    return { embeds: [{ color: FARBE, title: titel || undefined, description: text }] };
}
