'use strict';

const {
    ApplicationCommandOptionType, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, EmbedBuilder, MessageFlags,
} = require('discord.js');
const { ServiceManager } = require('dunebot-core');
const { Fortschritt, Gestaltung } = require('dunebot-sdk');

/**
 * `/leaderboard [zeitraum]` — Rangliste (LV-1g, 2026-11-15).
 *
 * Gesamt (nach Prestige, dann XP), diese Woche (ab Montag) oder dieser Monat
 * (ab dem Ersten), gerechnet im Kern (`Fortschritt.rangliste`, G-20). Zehn je
 * Seite, Blättern mit Knöpfen fünf Minuten lang; blättern darf nur, wer
 * gefragt hat (andere bekommen einen Hinweis nur für sich). Darunter der
 * eigene Platz.
 *
 * Namen kommen aus dem Speicher des Bots; wer dort fehlt, steht als
 * Erwähnung da (Erwähnungen pingen in Embeds nicht).
 *
 * Auch als Präfix-Befehl: `leaderboard [gesamt|woche|monat]`.
 *
 * @type {import('dunebot-sdk').CommandType}
 */
module.exports = {
    name: 'leaderboard',
    description: 'leveling:RANGLISTE.DESCRIPTION',
    command: {
        enabled: true,
        usage: '[gesamt|woche|monat]',
        minArgsCount: 0,
    },
    slashCommand: {
        enabled: true,
        ephemeral: false,
        options: [
            {
                name: 'zeitraum',
                description: 'leveling:RANGLISTE.ZEITRAUM_DESC',
                type: ApplicationCommandOptionType.String,
                required: false,
                choices: [
                    { name: 'leveling:RANGLISTE.GESAMT', value: 'gesamt' },
                    { name: 'leveling:RANGLISTE.WOCHE', value: 'woche' },
                    { name: 'leveling:RANGLISTE.MONAT', value: 'monat' },
                ],
            },
        ],
    },

    async messageRun({ message, args }) {
        const zeitraum = ZEITRAEUME[String(args[0] || '').toLowerCase()] || 'gesamt';
        const seite = await baue(message.guild, message.author, zeitraum, 1);
        const gesendet = await message.reply(seite.nachricht);
        return blaettern(gesendet, message.guild, message.author, zeitraum, seite);
    },

    async interactionRun({ interaction }) {
        const zeitraum = interaction.options.getString('zeitraum') || 'gesamt';
        const seite = await baue(interaction.guild, interaction.user, zeitraum, 1);
        const gesendet = await interaction.editReply(seite.nachricht);
        return blaettern(gesendet, interaction.guild, interaction.user, zeitraum, seite, interaction);
    },
};

/** Eingaben des Präfix-Befehls → Zeitraum des Kerns. */
const ZEITRAEUME = Object.freeze({
    gesamt: 'gesamt', total: 'gesamt', all: 'gesamt',
    woche: 'woche', week: 'woche', weekly: 'woche',
    monat: 'monat', month: 'monat', monthly: 'monat',
});
const PRO_SEITE = 10;
const KNOEPFE_MS = 5 * 60 * 1000;
const KNOPF = Object.freeze({ ZURUECK: 'leveling-lb-zurueck', WEITER: 'leveling-lb-weiter' });

/**
 * Eine Seite der Rangliste als Nachricht.
 *
 * @returns {Promise<{nachricht: object, seite: number, seiten: number}>}
 */
async function baue(guild, user, zeitraum, seite) {
    const t = (k, w) => guild.getT(`leveling:RANGLISTE.${k}`, w);
    const zahl = (n) => Number(n).toLocaleString(guild.locale || 'de-DE');
    const [liste, ich] = await Promise.all([
        Fortschritt.rangliste({ guildId: guild.id, kennung: 'leveling:community', zeitraum, seite, proSeite: PRO_SEITE }),
        Fortschritt.position({ guildId: guild.id, kennung: 'leveling:community', mitglied: user.id, zeitraum }),
    ]);
    // Seite hinter dem Ende (die Liste schrumpfte beim Blättern): die letzte.
    if (!liste.eintraege.length && liste.gesamt && seite > liste.seiten) return baue(guild, user, zeitraum, liste.seiten);

    const zeilen = liste.eintraege.map((e) => {
        const m = guild.members.cache.get(e.mitglied_id);
        const name = m ? `**${m.displayName.replace(/[*_`~|>]/g, '\\$&')}**` : `<@${e.mitglied_id}>`;
        const prestige = e.prestige > 0 ? ` · ${t('PRESTIGE', { n: e.prestige })}` : '';
        const xp = zeitraum === 'gesamt' ? t('ZEILE_XP', { xp: zahl(e.xp) }) : t('ZEILE_XP_ZEITRAUM', { xp: zahl(e.xp) });
        return `\`${String(e.platz).padStart(2, ' ')}.\` ${name} · ${t('ZEILE_LEVEL', { level: e.level })}${prestige} · ${xp}`;
    });
    const unten = ich.platz
        ? t('DEIN_PLATZ', { platz: ich.platz, von: ich.von, xp: zahl(ich.xp) })
        : t(zeitraum === 'gesamt' ? 'DU_OHNE' : 'DU_OHNE_ZEITRAUM');

    const embed = new EmbedBuilder()
        .setTitle(t('TITEL', { zeitraum: t(zeitraum.toUpperCase()), guild: guild.name }).slice(0, 256))
        .setDescription(zeilen.length ? `${zeilen.join('\n')}\n\n${unten}` : `${t(zeitraum === 'gesamt' ? 'LEER' : 'LEER_ZEITRAUM')}\n\n${unten}`)
        .setFooter({ text: t('SEITE', { seite: liste.seite, seiten: liste.seiten, gesamt: liste.gesamt }) })
        .setColor(await Gestaltung.farbe(guild.id, 'akzent', 'leveling'));
    if (guild.iconURL()) embed.setThumbnail(guild.iconURL());

    const components = liste.seiten > 1 ? [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(KNOPF.ZURUECK).setStyle(ButtonStyle.Secondary).setEmoji('◀️').setDisabled(liste.seite <= 1),
        new ButtonBuilder().setCustomId(KNOPF.WEITER).setStyle(ButtonStyle.Secondary).setEmoji('▶️').setDisabled(liste.seite >= liste.seiten),
    )] : [];
    return { nachricht: { embeds: [embed], components, allowedMentions: { parse: [] } }, seite: liste.seite, seiten: liste.seiten };
}

/**
 * Knöpfe bedienen, bis fünf Minuten um sind; danach verschwinden sie.
 *
 * @param {import('discord.js').Message} nachricht
 * @param {import('discord.js').ChatInputCommandInteraction} [interaction] zum Entfernen der Knöpfe an der Antwort
 */
async function blaettern(nachricht, guild, user, zeitraum, start, interaction = null) {
    if (start.seiten <= 1 || !nachricht?.createMessageComponentCollector) return;
    let seite = start.seite;
    const sammler = nachricht.createMessageComponentCollector({ componentType: ComponentType.Button, time: KNOEPFE_MS });
    sammler.on('collect', async (klick) => {
        try {
            if (klick.user.id !== user.id) {
                await klick.reply({ content: guild.getT('leveling:RANGLISTE.NUR_DU'), flags: MessageFlags.Ephemeral });
                return;
            }
            seite += klick.customId === KNOPF.WEITER ? 1 : -1;
            const neu = await baue(guild, user, zeitraum, Math.max(1, seite));
            seite = neu.seite;
            await klick.update(neu.nachricht);
        } catch (error) {
            ServiceManager.get('Logger').warn(`[Leveling] Rangliste blättern in ${guild.id}: ${error.message}`);
        }
    });
    sammler.on('end', () => {
        const weg = { components: [] };
        const ende = interaction ? interaction.editReply(weg) : nachricht.edit(weg);
        Promise.resolve(ende).catch((e) => ServiceManager.get('Logger').debug(`[Leveling] Knöpfe der Rangliste nicht entfernt: ${e.message}`));
    });
}
