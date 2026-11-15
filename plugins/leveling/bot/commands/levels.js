'use strict';

const { ApplicationCommandOptionType } = require('discord.js');
const { EmbedUtils } = require('dunebot-sdk/utils');
const { sync } = require('../sync');
const { darf } = require('../recht');

/**
 * `/levels sync` — Belohnungsrollen aller Mitglieder an ihre Stufe angleichen
 * (LV-1e, 2026-11-15).
 *
 * Wer darf: das Recht `LEVELING.REWARDS.MANAGE` aus dem Rechtesystem, nicht
 * eine Discord-Berechtigung (Konzept §11). Entschieden wird im Dashboard
 * (`core:RECHT_PRUEFEN`), ohne Antwort von dort läuft nichts. Der Abgleich
 * selbst läuft im Bot, der die Guild hat (`bot/sync.js`).
 *
 * Nur als Slash-Befehl: Der Fortschritt steht in der Antwort, und die ist nur
 * an einer Interaktion änderbar.
 *
 * @type {import('dunebot-sdk').CommandType}
 */
module.exports = {
    name: 'levels',
    description: 'leveling:LEVELS.DESCRIPTION',
    command: {
        enabled: false,
    },
    slashCommand: {
        enabled: true,
        ephemeral: true,
        options: [
            {
                name: 'sync',
                description: 'leveling:LEVELS.SYNC_DESCRIPTION',
                type: ApplicationCommandOptionType.Subcommand,
            },
        ],
    },

    async interactionRun({ interaction }) {
        const unter = interaction.options.getSubcommand();
        if (unter === 'sync') return levelsSync(interaction);
        return interaction.editReply({ content: interaction.guild.getT('leveling:LEVELS.UNBEKANNT') });
    },
};

const RECHT = 'LEVELING.REWARDS.MANAGE';
/** Danach ist die Antwort nicht mehr änderbar (Discord: 15 min). */
const ANTWORT_MS = 14 * 60 * 1000;
const HOECHSTENS_ZEILEN = 15;

/**
 * @param {import('discord.js').ChatInputCommandInteraction} interaction bereits verschoben (ephemeral)
 */
async function levelsSync(interaction) {
    const { guild, user } = interaction;
    const t = (k, w) => guild.getT(`leveling:LEVELS.${k}`, w);

    const recht = await darf(guild, user, RECHT);
    if (recht.fehler) return interaction.editReply({ content: t('KEIN_DASHBOARD', { grund: recht.fehler }) });
    if (!recht.darf) return interaction.editReply({ content: t('KEIN_RECHT', { recht: RECHT }) });

    const beginn = Date.now();
    await interaction.editReply({ content: t('LAEUFT') });
    const e = await sync({
        guild,
        fortschritt: ({ fertig, gesamt }) => (Date.now() - beginn < ANTWORT_MS
            ? interaction.editReply({ content: t('FORTSCHRITT', { fertig, gesamt }) })
            : null),
    });
    if (e.laeuftSchon) return interaction.editReply({ content: t('LAEUFT_SCHON') });
    if (e.ohneBelohnungen && !e.gesamt) return interaction.editReply({ content: t('KEINE_BELOHNUNGEN') });

    const zeilen = [
        t('ERG_GEPRUEFT', { n: e.gesamt }),
        t('ERG_VERGEBEN', { n: e.vergeben }),
        t('ERG_ENTFERNT', { n: e.entzogen }),
    ];
    if (e.gehalten) zeilen.push(t('ERG_GEHALTEN', { n: e.gehalten }));
    if (e.fort) zeilen.push(t('ERG_FORT', { n: e.fort }));
    if (e.ohneBelohnungen) zeilen.push('', t('ERG_OHNE_BELOHNUNGEN'));
    const fehl = [...e.fehlgeschlagen.map((f) => ({ ...f, text: grundText(t, f) })), ...e.gescheitert.map((f) => ({ ...f, text: f.fehler }))];
    if (fehl.length) {
        zeilen.push('', `**${t('ERG_FEHLGESCHLAGEN', { n: fehl.length })}**`);
        for (const f of fehl.slice(0, HOECHSTENS_ZEILEN)) {
            zeilen.push(`• <@${f.mitglied}>${f.rolle ? ` · ${f.name ? `@${f.name}` : `<@&${f.rolle}>`}` : ''}: ${f.text}`);
        }
        if (fehl.length > HOECHSTENS_ZEILEN) zeilen.push(t('ERG_WEITERE', { n: fehl.length - HOECHSTENS_ZEILEN }));
    }
    const embed = EmbedUtils[fehl.length ? 'error' : 'success']({
        title: t(fehl.length ? 'ERG_TITEL_TEILWEISE' : 'ERG_TITEL'),
        description: zeilen.join('\n').slice(0, 4000),
    });

    if (Date.now() - beginn < ANTWORT_MS) return interaction.editReply({ content: '', embeds: [embed] });
    // Die Antwort ist nicht mehr änderbar: Ergebnis in den Kanal, mit Hinweis.
    return interaction.channel.send({ content: t('ERG_IM_KANAL', { nutzer: `<@${user.id}>` }), embeds: [embed], allowedMentions: { parse: [] } });
}

/** Grund einer blockierten Rolle in Worten (Rollen.GRUND). */
function grundText(t, f) {
    switch (f.grund) {
        case 'KEIN_RECHT': return t('GRUND_KEIN_RECHT');
        case 'ZU_HOCH': return t('GRUND_ZU_HOCH');
        case 'VERWALTET': return t('GRUND_VERWALTET');
        case 'WEG': return t('GRUND_WEG');
        default: return t('GRUND_FEHLER', { fehler: f.fehler || '?' });
    }
}
