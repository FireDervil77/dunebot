'use strict';

const {
    ApplicationCommandOptionType, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType,
    ModalBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');
const { ServiceManager } = require('dunebot-core');
const { Fortschritt, Ereignisse } = require('dunebot-sdk');
const { EmbedUtils } = require('dunebot-sdk/utils');
const { darf } = require('../recht');
const { nachBuchung } = require('../nachbuchung');
const { KENNUNG } = require('../../shared/vorgaben');

// Vor module.exports: die Optionen unten lesen MENGE_MAX schon beim Laden.
const RECHT = 'LEVELING.XP.MANAGE';
const ARTEN = Object.freeze(['add', 'remove', 'set', 'reset']);
/** Größte Eingabe; der Kern nimmt bis 10¹². */
const MENGE_MAX = 1_000_000_000;
const KNOPF_MS = 60_000;
const FENSTER_MS = 120_000;

/**
 * `/xp add|remove|set|reset` — XP von Hand ändern (LV-1h, 2026-11-15).
 *
 * Jede Änderung ist eine Buchung im Kern (G-20) mit Quelle `hand`, Akteur und
 * Pflichtgrund; nachvollziehbar und einzeln stornierbar (Konzept §3). Dazu
 * `leveling.xp.korrigiert` ins Ereignisbuch.
 *
 *   add     +menge
 *   remove  −menge, gekürzt auf den Stand (nie unter 0)
 *   set     Differenz zum Stand
 *   reset   −Stand, erst nach Knopf und eingetipptem Namen (wie /mydata)
 *
 * Ein Stufenwechsel läuft wie bei Chat und Sprache weiter: Level-up-Nachricht
 * (im Kanal des Befehls bei „Kanal der Nachricht“), Belohnungsrollen.
 * Prestige bleibt beim Zurücksetzen stehen (kommt mit LV-3d).
 *
 * Wer darf: das Recht `LEVELING.XP.MANAGE` (Administrator, Moderator) über
 * `core:RECHT_PRUEFEN`, keine Discord-Berechtigung (Konzept §11).
 *
 * Nur als Slash-Befehl: Bestätigung und Fenster gehen nur an Interaktionen.
 *
 * @type {import('dunebot-sdk').CommandType}
 */
module.exports = {
    name: 'xp',
    description: 'leveling:XP.DESCRIPTION',
    command: {
        enabled: false,
    },
    slashCommand: {
        enabled: true,
        ephemeral: true,
        options: [
            unter('add', [mitgliedOption(), mengeOption('leveling:XP.MENGE_ADD_DESC'), grundOption()]),
            unter('remove', [mitgliedOption(), mengeOption('leveling:XP.MENGE_REMOVE_DESC'), grundOption()]),
            unter('set', [mitgliedOption(), mengeOption('leveling:XP.MENGE_SET_DESC', 0), grundOption()]),
            unter('reset', [mitgliedOption(), grundOption()]),
        ],
    },

    async interactionRun({ interaction }) {
        const { guild, user } = interaction;
        const t = (k, w) => guild.getT(`leveling:XP.${k}`, w);
        const art = interaction.options.getSubcommand();
        if (!ARTEN.includes(art)) return interaction.editReply({ content: t('UNBEKANNT') });

        const ziel = interaction.options.getUser('user');
        if (ziel.bot) return interaction.editReply({ content: t('BOT') });
        const grund = interaction.options.getString('reason').trim();
        if (!grund) return interaction.editReply({ content: t('GRUND_FEHLT') });

        const recht = await darf(guild, user, RECHT);
        if (recht.fehler) return interaction.editReply({ content: t('KEIN_DASHBOARD', { grund: recht.fehler }) });
        if (!recht.darf) return interaction.editReply({ content: t('KEIN_RECHT', { recht: RECHT }) });

        const vorher = await Fortschritt.stand({ guildId: guild.id, kennung: KENNUNG, mitglied: ziel.id });
        let menge;
        if (art === 'add') menge = interaction.options.getInteger('amount');
        else if (art === 'remove') menge = -interaction.options.getInteger('amount');
        else if (art === 'set') menge = interaction.options.getInteger('amount') - vorher.xp;
        else menge = -vorher.xp;

        if (menge === 0) return interaction.editReply({ content: t(art === 'reset' ? 'SCHON_NULL' : 'NICHTS', { name: ziel.username }) });
        if (art === 'remove' && vorher.xp <= 0) return interaction.editReply({ content: t('SCHON_NULL', { name: ziel.username }) });

        if (art === 'reset') {
            const ok = await bestaetige(interaction, ziel, vorher, t);
            if (!ok) return null;
        }
        return buche(interaction, { art, ziel, menge, grund, vorher, t });
    },
};

function unter(name, options) {
    return { name, description: `leveling:XP.${name.toUpperCase()}_DESC`, type: ApplicationCommandOptionType.Subcommand, options };
}
function mitgliedOption() {
    return { name: 'user', description: 'leveling:XP.USER_DESC', type: ApplicationCommandOptionType.User, required: true };
}
function mengeOption(description, min = 1) {
    return { name: 'amount', description, type: ApplicationCommandOptionType.Integer, required: true, minValue: min, maxValue: MENGE_MAX };
}
function grundOption() {
    return { name: 'reason', description: 'leveling:XP.GRUND_DESC', type: ApplicationCommandOptionType.String, required: true, maxLength: 255 };
}

function nameStimmt(eingabe, soll) {
    return String(eingabe ?? '').trim().toLowerCase() === String(soll ?? '').trim().toLowerCase();
}

/**
 * Zurücksetzen bestätigen: Knopf, dann den Benutzernamen eintippen.
 * @returns {Promise<boolean>}
 */
async function bestaetige(interaction, ziel, vorher, t) {
    const knopfId = `leveling-xp-reset-${interaction.id}`;
    const nachricht = await interaction.editReply({
        embeds: [EmbedUtils.error({
            title: t('RESET_TITEL'),
            description: t('RESET_FRAGE', { name: ziel.username, xp: vorher.xp, level: vorher.level }),
        })],
        components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(knopfId).setStyle(ButtonStyle.Danger).setLabel(t('RESET_KNOPF').slice(0, 80)),
        )],
    });
    const klick = await nachricht.awaitMessageComponent({
        componentType: ComponentType.Button,
        filter: (i) => i.customId === knopfId && i.user.id === interaction.user.id,
        time: KNOPF_MS,
    }).catch(() => null);
    if (!klick) {
        await interaction.editReply({ embeds: [EmbedUtils.embed({ description: t('RESET_ABGELAUFEN') })], components: [] }).catch(() => null);
        return false;
    }
    const fensterId = `leveling-xp-reset-fenster-${klick.id}`;
    await klick.showModal(new ModalBuilder({
        customId: fensterId,
        title: t('RESET_FENSTER_TITEL').slice(0, 45),
        components: [new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('name')
                .setLabel(t('RESET_FENSTER_LABEL').slice(0, 45))
                .setPlaceholder(String(ziel.username).slice(0, 100))
                .setStyle(TextInputStyle.Short)
                .setRequired(true),
        )],
    }));
    const fenster = await klick.awaitModalSubmit({
        time: FENSTER_MS,
        filter: (m) => m.customId === fensterId && m.user.id === interaction.user.id,
    }).catch(() => null);
    if (!fenster) {
        await interaction.editReply({ embeds: [EmbedUtils.embed({ description: t('RESET_ABGELAUFEN') })], components: [] }).catch(() => null);
        return false;
    }
    if (!nameStimmt(fenster.fields.getTextInputValue('name'), ziel.username)) {
        await fenster.update({ embeds: [EmbedUtils.error({ description: t('RESET_FALSCH', { name: ziel.username }) })], components: [] });
        return false;
    }
    await fenster.update({ embeds: [EmbedUtils.embed({ description: t('RESET_LAEUFT') })], components: [] });
    return true;
}

/**
 * Buchen, Stufenwechsel weiterreichen, Ereignis melden, antworten.
 */
async function buche(interaction, { art, ziel, menge, grund, vorher, t }) {
    const { guild, user } = interaction;
    let e;
    try {
        e = await Fortschritt.buche({
            guildId: guild.id, kennung: 'leveling:community', mitglied: ziel.id, menge, quelle: 'hand',
            schluessel: `hand:${interaction.id}`, akteur: user.id, grund: `${art}: ${grund}`,
        });
    } catch (error) {
        ServiceManager.get('Logger').error(`[Leveling] /xp ${art} in ${guild.id} gescheitert:`, error);
        return interaction.editReply({ content: t('FEHLER', { fehler: error.message }), embeds: [], components: [] });
    }
    if (e.doppelt) return interaction.editReply({ content: t('DOPPELT'), embeds: [], components: [] });

    await nachBuchung({ guildId: guild.id, mitglied: ziel.id, ergebnis: e, guild, kanal: String(interaction.channelId) });
    try {
        await Ereignisse.melde('leveling.xp.korrigiert', {
            guild_id: guild.id,
            schluessel: `leveling:hand:${e.buchung_id}`,
            akteur: user.id,
            betroffen: ziel.id,
            daten: { fortschritt: KENNUNG, art, xp: e.menge, grund },
        });
    } catch (error) {
        ServiceManager.get('Logger').error('[Leveling] leveling.xp.korrigiert nicht gemeldet:', error);
    }

    const zeilen = [
        t(`ERG_${art.toUpperCase()}`, { name: ziel.username, menge: Math.abs(e.menge), xp: e.xp }),
        t('ERG_STAND', { vorher: vorher.xp, xp: e.xp, lv: vorher.level, level: e.level }),
    ];
    if (e.gekuerzt) zeilen.push(t('ERG_GEKUERZT'));
    if (art === 'reset' && e.prestige > 0) zeilen.push(t('ERG_PRESTIGE', { n: e.prestige }));
    zeilen.push('', t('ERG_GRUND', { grund }));
    return interaction.editReply({
        content: '',
        embeds: [EmbedUtils.success({ title: t('ERG_TITEL'), description: zeilen.join('\n').slice(0, 4000) })],
        components: [],
    });
}
