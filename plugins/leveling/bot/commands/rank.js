'use strict';

const { ApplicationCommandOptionType, AttachmentBuilder, EmbedBuilder } = require('discord.js');
const { Gestaltung } = require('dunebot-sdk');
const Karte = require('../karte');

/**
 * `/rank [user]` — Rangkarte eines Mitglieds (LV-1g, 2026-11-15).
 *
 * Zeigt Level, XP im Level und gesamt, Platz in der Gesamt-Rangliste als
 * Bild (`kern:rangkarte` über `bot/karte.js`). Scheitert das Bild, kommt
 * dasselbe als Text. Für alle sichtbar, wie bei anderen Bots üblich; ohne
 * Angabe das eigene. Bots sammeln keine XP.
 *
 * Auch als Präfix-Befehl: `rank [@mitglied|ID|Name]`.
 *
 * @type {import('dunebot-sdk').CommandType}
 */
module.exports = {
    name: 'rank',
    description: 'leveling:RANG.DESCRIPTION',
    command: {
        enabled: true,
        usage: '[@member]',
        minArgsCount: 0,
    },
    slashCommand: {
        enabled: true,
        ephemeral: false,
        options: [
            {
                name: 'user',
                description: 'leveling:RANG.USER_DESC',
                type: ApplicationCommandOptionType.User,
                required: false,
            },
        ],
    },

    async messageRun({ message, args }) {
        const ziel = args[0] ? await message.guild.resolveMember(args.join(' ')) : message.member;
        if (!ziel) return message.replyT('leveling:RANG.NICHT_GEFUNDEN', { query: args.join(' ') });
        return message.reply(await antwort(ziel));
    },

    async interactionRun({ interaction }) {
        const user = interaction.options.getUser('user') || interaction.user;
        const ziel = interaction.guild.members.cache.get(user.id) || await interaction.guild.members.fetch(user.id).catch(() => null);
        if (!ziel) return interaction.editReply({ content: interaction.guild.getT('leveling:RANG.KEIN_MITGLIED') });
        return interaction.editReply(await antwort(ziel));
    },
};

/**
 * @param {import('discord.js').GuildMember} member
 * @returns {Promise<object>} Nachricht
 */
async function antwort(member) {
    const guild = member.guild;
    const t = (k, w) => guild.getT(`leveling:RANG.${k}`, w);
    if (member.user.bot) return { content: t('BOT') };

    const s = await Karte.standUndPlatz(guild.id, member.id);
    const bild = await Karte.zeichne(member, s);
    if (bild) return { files: [new AttachmentBuilder(bild.attachment, { name: bild.name })], allowedMentions: { parse: [] } };

    // Ersatz ohne Bild: dieselben Zahlen.
    const zahl = (n) => Number(n).toLocaleString(guild.locale || 'de-DE');
    const zeilen = [
        t('TEXT_LEVEL', { level: s.stand.level }),
        t('TEXT_XP', { xp: zahl(s.stand.xp) }),
        s.stand.naechste ? t('TEXT_NAECHSTE', { fehlt: zahl(s.stand.naechste.fehlt), level: s.stand.naechste.nummer }) : t('TEXT_OBEN'),
        s.platz ? t('TEXT_PLATZ', { platz: s.platz, von: s.von }) : t('TEXT_KEIN_PLATZ'),
    ];
    const embed = new EmbedBuilder()
        .setTitle(t('TITEL', { name: member.displayName }).slice(0, 256))
        .setDescription(zeilen.join('\n'))
        .setThumbnail(member.displayAvatarURL())
        .setColor(await Gestaltung.farbe(guild.id, 'akzent', 'leveling'));
    return { embeds: [embed], allowedMentions: { parse: [] } };
}
