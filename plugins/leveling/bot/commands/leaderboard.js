'use strict';

const {
    ApplicationCommandOptionType, ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ComponentType, MessageFlags,
    ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MediaGalleryBuilder, MediaGalleryItemBuilder,
    SectionBuilder, ThumbnailBuilder,
} = require('discord.js');
const { ServiceManager } = require('dunebot-core');
const { Bildkarte, Fortschritt, Gestaltung } = require('dunebot-sdk');
const Regeln = require('../../shared/regeln');
const Rangliste = require('../../shared/rangliste');

/**
 * `/leaderboard [zeitraum]` — Rangliste (LV-1g, 2026-11-15).
 *
 * Gesamt (nach Prestige, dann XP), diese Woche (ab Montag) oder dieser Monat
 * (ab dem Ersten), gerechnet im Kern (`Fortschritt.rangliste`, G-20). Zehn je
 * Seite, Blättern mit Knöpfen fünf Minuten lang; blättern darf nur, wer
 * gefragt hat (andere bekommen einen Hinweis nur für sich). Darunter der
 * eigene Platz.
 *
 * Zwei Formen, je Guild gewählt unter Leveling → Nachrichten (LV-2c,
 * `level_einstellungen.rangliste_form`):
 *   - `liste` (Vorgabe): Components V2, Kopf mit dem Banner der Guild aus der
 *     Gestaltung (G-09), sonst Titel mit Servericon. Namen aus dem Speicher
 *     des Bots; wer dort fehlt, steht als Erwähnung da (pingt nicht,
 *     `allowedMentions` leer).
 *   - `bild`: Bildkarte `leveling:rangliste` (zehn Plätze mit Avatar). Wer
 *     nicht im Speicher ist, wird einzeln bei Discord nachgefragt (REST,
 *     höchstens zehn je Seite); scheitert das, steht „Unbekannt“ da.
 *     Scheitert das Bild, kommt die Liste.
 * Bis LV-2c war es ein Embed.
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
 * Eine Seite der Rangliste als Nachricht, in der Form der Guild.
 *
 * @returns {Promise<{nachricht: object, ohneKnoepfe: object, seite: number, seiten: number}>}
 */
async function baue(guild, user, zeitraum, seite) {
    const [liste, ich, form] = await Promise.all([
        Fortschritt.rangliste({ guildId: guild.id, kennung: 'leveling:community', zeitraum, seite, proSeite: PRO_SEITE }),
        Fortschritt.position({ guildId: guild.id, kennung: 'leveling:community', mitglied: user.id, zeitraum }),
        formDerGuild(guild.id),
    ]);
    // Seite hinter dem Ende (die Liste schrumpfte beim Blättern): die letzte.
    if (!liste.eintraege.length && liste.gesamt && seite > liste.seiten) return baue(guild, user, zeitraum, liste.seiten);

    const knoepfe = liste.seiten > 1 ? [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(KNOPF.ZURUECK).setStyle(ButtonStyle.Secondary).setEmoji('◀️').setDisabled(liste.seite <= 1),
        new ButtonBuilder().setCustomId(KNOPF.WEITER).setStyle(ButtonStyle.Secondary).setEmoji('▶️').setDisabled(liste.seite >= liste.seiten),
    )] : [];
    const aus = { seite: liste.seite, seiten: liste.seiten };

    if (form === 'bild' && liste.eintraege.length) {
        const bild = await alsBild(guild, zeitraum, liste, ich);
        if (bild) {
            const datei = new AttachmentBuilder(bild.puffer, { name: bild.dateiname('rangliste') });
            return {
                ...aus,
                nachricht: { content: '', files: [datei], attachments: [], components: knoepfe, allowedMentions: { parse: [] } },
                ohneKnoepfe: { components: [] },
            };
        }
    }
    const container = await alsListe(guild, zeitraum, liste, ich);
    return {
        ...aus,
        nachricht: { flags: MessageFlags.IsComponentsV2, files: [], attachments: [], components: [container, ...knoepfe], allowedMentions: { parse: [] } },
        ohneKnoepfe: { flags: MessageFlags.IsComponentsV2, components: [container] },
    };
}

/** Form der Rangliste (Vorgabe `liste`, auch wenn die Regeln nicht lesbar sind). */
async function formDerGuild(guildId) {
    try {
        const r = await Regeln.lade(guildId);
        return r?.einstellungen?.rangliste_form === 'bild' ? 'bild' : 'liste';
    } catch (error) {
        ServiceManager.get('Logger').warn(`[Leveling] Form der Rangliste in ${guildId} nicht lesbar, nehme die Liste: ${error.message}`);
        return 'liste';
    }
}

/**
 * Components V2: Kopf (Banner oder Titel mit Icon), zehn Zeilen, eigener
 * Platz, Seitenzahl.
 */
async function alsListe(guild, zeitraum, liste, ich) {
    const t = (k, w) => guild.getT(`leveling:RANGLISTE.${k}`, w);
    const zahl = (n) => Number(n).toLocaleString(guild.locale || 'de-DE');
    const zeilen = liste.eintraege.map((e) => {
        const m = guild.members.cache.get(e.mitglied_id);
        const name = m ? `**${m.displayName.replace(/[*_`~|>#\-]/g, '\\$&')}**` : `<@${e.mitglied_id}>`;
        const prestige = e.prestige > 0 ? ` · ${t('PRESTIGE', { n: e.prestige })}` : '';
        const xp = zeitraum === 'gesamt' ? t('ZEILE_XP', { xp: zahl(e.xp) }) : t('ZEILE_XP_ZEITRAUM', { xp: zahl(e.xp) });
        return `\`${String(e.platz).padStart(2, ' ')}.\` ${name} · ${t('ZEILE_LEVEL', { level: e.level })}${prestige} · ${xp}`;
    });
    const unten = ich.platz
        ? t('DEIN_PLATZ', { platz: ich.platz, von: ich.von, xp: zahl(ich.xp) })
        : t(zeitraum === 'gesamt' ? 'DU_OHNE' : 'DU_OHNE_ZEITRAUM');
    const titel = `## ${t('TITEL', { zeitraum: t(zeitraum.toUpperCase()), guild: guild.name })}`.slice(0, 300);

    const container = new ContainerBuilder().setAccentColor(await Gestaltung.farbe(guild.id, 'akzent', 'leveling'));
    const { banner } = await Gestaltung.bilder(guild.id);
    if (banner) {
        container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(banner)));
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(titel));
    } else if (guild.iconURL()) {
        container.addSectionComponents(new SectionBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(titel))
            .setThumbnailAccessory(new ThumbnailBuilder().setURL(guild.iconURL({ extension: 'png', size: 128 }))));
    } else {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(titel));
    }
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        zeilen.length ? zeilen.join('\n') : t(zeitraum === 'gesamt' ? 'LEER' : 'LEER_ZEITRAUM')));
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `${unten}\n-# ${t('SEITE', { seite: liste.seite, seiten: liste.seiten, gesamt: liste.gesamt })}`));
    return container;
}

/**
 * Bildkarte `leveling:rangliste`, oder null (Grund im Log).
 */
async function alsBild(guild, zeitraum, liste, ich) {
    const t = (k, w) => guild.getT(`leveling:RANGLISTE.${k}`, w);
    const zahl = (n) => Number(n).toLocaleString(guild.locale || 'de-DE');
    try {
        const personen = await namen(guild, liste.eintraege.map((e) => e.mitglied_id), t('UNBEKANNT'));
        const eintraege = liste.eintraege.map((e) => {
            const p = personen.get(e.mitglied_id);
            const prestige = e.prestige > 0 ? ` · ${t('PRESTIGE', { n: e.prestige })}` : '';
            return {
                platz: e.platz,
                name: p.name,
                avatar: p.avatar,
                level: `${t('ZEILE_LEVEL_BILD', { level: e.level })}${prestige}`,
                xp: t('ZEILE_XP', { xp: zahl(e.xp) }),
            };
        });
        const unten = ich.platz
            ? t('DEIN_PLATZ_BILD', { platz: ich.platz, von: ich.von, xp: zahl(ich.xp) })
            : t(zeitraum === 'gesamt' ? 'DU_OHNE' : 'DU_OHNE_ZEITRAUM');
        const werte = Rangliste.werte({
            titel: t('TITEL', { zeitraum: t(zeitraum.toUpperCase()), guild: guild.name }),
            untertitel: guild.name,
            seite: t('SEITE', { seite: liste.seite, seiten: liste.seiten, gesamt: liste.gesamt }),
            unten,
            eintraege,
        });
        const bild = await Bildkarte.zeichneNutzung('leveling', Rangliste.KARTE, { guild, werte }, { guildId: guild.id });
        if (bild.hinweise.length) ServiceManager.get('Logger').warn(`[Leveling] Ranglisten-Bild in ${guild.id}: ${bild.hinweise.slice(0, 5).join('; ')}`);
        return bild;
    } catch (error) {
        ServiceManager.get('Logger').error(`[Leveling] Ranglisten-Bild in ${guild.id} nicht gezeichnet:`, error);
        return null;
    }
}

/**
 * Anzeigename und Avatar je Mitglied: aus dem Speicher des Bots, sonst
 * einzeln bei Discord (REST, Nutzer statt Mitglied: kein Gateway-Abruf).
 * @returns {Promise<Map<string, {name: string, avatar: string}>>}
 */
async function namen(guild, ids, unbekannt) {
    const aus = new Map();
    await Promise.all(ids.map(async (id) => {
        const m = guild.members.cache.get(id);
        if (m) {
            aus.set(id, { name: m.displayName, avatar: m.displayAvatarURL({ extension: 'png', size: 128, forceStatic: true }) });
            return;
        }
        try {
            const u = await guild.client.users.fetch(id);
            aus.set(id, { name: u.globalName || u.username, avatar: u.displayAvatarURL({ extension: 'png', size: 128, forceStatic: true }) });
        } catch (error) {
            ServiceManager.get('Logger').debug(`[Leveling] Nutzer ${id} für die Rangliste nicht abrufbar: ${error.message}`);
            aus.set(id, { name: unbekannt, avatar: '' });
        }
    }));
    return aus;
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
    let letzte = start;
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
            letzte = neu;
            await klick.update(neu.nachricht);
        } catch (error) {
            ServiceManager.get('Logger').warn(`[Leveling] Rangliste blättern in ${guild.id}: ${error.message}`);
        }
    });
    sammler.on('end', () => {
        // V2: nur die Knöpfe weg, der Inhalt steckt selbst in components.
        const weg = letzte.ohneKnoepfe;
        const ende = interaction ? interaction.editReply(weg) : nachricht.edit(weg);
        Promise.resolve(ende).catch((e) => ServiceManager.get('Logger').debug(`[Leveling] Knöpfe der Rangliste nicht entfernt: ${e.message}`));
    });
}
