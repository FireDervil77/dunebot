'use strict';

/**
 * Leveling: `/levels style` — eigene Rangkarte gestalten (LV-2b, K382, 2026-11-15).
 *
 * Gibt die Guild es im Kern-Bereich „Bildkarten“ frei (Rangkarte →
 * „Mitglieder gestalten mit“), wählt ein Mitglied hier Schablone und
 * Akzentfarbe seiner eigenen Karte. Nur für dich sichtbar; jede Wahl wird
 * sofort gespeichert und die Karte neu gezeichnet. Gespeichert, geprüft und
 * gezeichnet wird über `Bildkarte` im SDK (`speichereWahl`, `zeichneNutzung`),
 * dieselbe Rechnung wie auf der Profilseite im Dashboard
 * (`/guild/<id>/profile/karten`). Ein Bild wählen Mitglieder nie.
 *
 * Die Antwort ist zehn Minuten lang bedienbar (Discord erlaubt Änderungen
 * an einer Antwort 15 Minuten lang).
 *
 * @module leveling/bot/stil
 */

const {
    ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ComponentType, ModalBuilder,
    StringSelectMenuBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');
const { ServiceManager } = require('dunebot-core');
const { Bildkarte } = require('dunebot-sdk');
const Karte = require('./karte');
const Rangkarte = require('../shared/rangkarte');

const PLUGIN = 'leveling';
const BEDIENBAR_MS = 10 * 60 * 1000;
const MODAL_MS = 2 * 60 * 1000;
const ID = Object.freeze({
    SCHABLONE: 'leveling-stil-schablone',
    FARBE: 'leveling-stil-farbe',
    EIGEN: 'leveling-stil-eigen',
    ZURUECK: 'leveling-stil-zurueck',
    MODAL: 'leveling-stil-modal',
    FELD: 'leveling-stil-hex',
});
const WIE_SERVER = '-';

/** Feste Farben zur Wahl; eigene über das Fenster „Eigene Farbe …“. */
const FARBEN = Object.freeze([
    ['ROT', '#e74c3c'], ['ORANGE', '#e67e22'], ['GELB', '#f1c40f'], ['GRUEN', '#2ecc71'],
    ['TUERKIS', '#1abc9c'], ['BLAU', '#3498db'], ['INDIGO', '#5865f2'], ['LILA', '#9b59b6'],
    ['PINK', '#e91e63'], ['WEISS', '#ecf0f1'], ['GRAU', '#95a5a6'],
]);

function sprache(guild) {
    return String(guild.locale || 'de-DE').toLowerCase().startsWith('de') ? 'de' : 'en';
}

/**
 * Die Antwort: Text, Karte, Auswahlen. `zusatz` steht über dem Text
 * (Fehlermeldung nach einer Wahl).
 */
async function ansicht(member, w, zusatz = '') {
    const guild = member.guild;
    const t = (k, x) => guild.getT(`leveling:STIL.${k}`, x);
    const zeilen = [];
    if (zusatz) zeilen.push(zusatz, '');
    zeilen.push(`**${t('TITEL')}**`, t('TEXT'));

    const files = [];
    const bild = await Karte.zeichne(member, await Karte.standUndPlatz(guild.id, member.id));
    if (bild) files.push(new AttachmentBuilder(bild.attachment, { name: bild.name }));
    else zeilen.push('', t('KEIN_BILD'));

    const components = [];
    if (w.darf.schablone) {
        components.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
            .setCustomId(ID.SCHABLONE)
            .setPlaceholder(t('SCHABLONE'))
            .addOptions(
                { label: t('WIE_SERVER'), value: WIE_SERVER, default: !w.gewaehlt.vorlage },
                ...w.schablonen.map((s) => ({
                    label: (s.name.startsWith('kern:') ? guild.getT('leveling:STIL.STANDARD') : s.titel).slice(0, 100),
                    value: s.name,
                    default: s.name === w.gewaehlt.vorlage,
                })),
            )));
    }
    if (w.darf.farbe) {
        const eigen = w.gewaehlt.akzent && !FARBEN.some(([, hex]) => hex === w.gewaehlt.akzent);
        components.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
            .setCustomId(ID.FARBE)
            .setPlaceholder(t('FARBE'))
            .addOptions(
                { label: t('FARBE_SERVER'), value: WIE_SERVER, default: !w.gewaehlt.akzent },
                ...(eigen ? [{ label: t('FARBE_EIGEN', { hex: w.gewaehlt.akzent }), value: w.gewaehlt.akzent, default: true }] : []),
                ...FARBEN.map(([name, hex]) => ({ label: t(`FARBEN.${name}`), description: hex, value: hex, default: hex === w.gewaehlt.akzent })),
            )));
    }
    const knoepfe = [];
    if (w.darf.farbe) knoepfe.push(new ButtonBuilder().setCustomId(ID.EIGEN).setStyle(ButtonStyle.Secondary).setLabel(t('EIGENE_FARBE')));
    knoepfe.push(new ButtonBuilder().setCustomId(ID.ZURUECK).setStyle(ButtonStyle.Secondary).setLabel(t('ZURUECKSETZEN'))
        .setDisabled(!w.gewaehlt.vorlage && !w.gewaehlt.akzent));
    components.push(new ActionRowBuilder().addComponents(...knoepfe));

    return { content: zeilen.join('\n').slice(0, 2000), files, attachments: [], components, allowedMentions: { parse: [] } };
}

/**
 * Wahl speichern und die neue Ansicht bauen. Ein Eingabefehler (Guild hat
 * die Freigabe inzwischen zurückgenommen, Farbe falsch) steht oben in der
 * Antwort, gespeichert ist dann nichts.
 */
async function waehle(member, eingabe) {
    const guild = member.guild;
    let zusatz = '';
    try {
        await Bildkarte.speichereWahl(PLUGIN, Rangkarte.KARTE, guild.id, member.id, eingabe);
    } catch (error) {
        if (!(error instanceof Bildkarte.Eingabefehler)) throw error;
        zusatz = `⚠️ ${guild.getT('leveling:STIL.FEHLER', { grund: error.message })}`;
    }
    const w = await Bildkarte.mitgliedWahl(PLUGIN, Rangkarte.KARTE, guild.id, member.id, sprache(guild));
    return { w, nachricht: await ansicht(member, w, zusatz) };
}

/**
 * @param {import('discord.js').ChatInputCommandInteraction} interaction bereits verschoben (ephemeral)
 */
async function stilRun(interaction) {
    const { guild, user } = interaction;
    const Logger = ServiceManager.get('Logger');
    const member = guild.members.cache.get(user.id) || await guild.members.fetch(user.id);
    let w = await Bildkarte.mitgliedWahl(PLUGIN, Rangkarte.KARTE, guild.id, user.id, sprache(guild));
    if (!w.darf.schablone && !w.darf.farbe) return interaction.editReply({ content: guild.getT('leveling:STIL.NICHT_FREI') });

    const antwort = await interaction.editReply(await ansicht(member, w));
    const sammler = antwort.createMessageComponentCollector({ time: BEDIENBAR_MS, filter: (i) => i.user.id === user.id });

    sammler.on('collect', async (klick) => {
        try {
            if (klick.customId === ID.EIGEN) {
                // Je Klick eine eigene Kennung: Ein liegengelassenes Fenster
                // eines früheren Klicks löst sonst diesen hier aus.
                const fensterId = `${ID.MODAL}-${klick.id}`;
                await klick.showModal(new ModalBuilder().setCustomId(fensterId).setTitle(guild.getT('leveling:STIL.MODAL_TITEL')).addComponents(
                    new ActionRowBuilder().addComponents(new TextInputBuilder()
                        .setCustomId(ID.FELD)
                        .setLabel(guild.getT('leveling:STIL.MODAL_FELD').slice(0, 45))
                        .setStyle(TextInputStyle.Short)
                        .setMinLength(7).setMaxLength(7)
                        .setPlaceholder('#3498db')
                        .setValue(w.gewaehlt.akzent || '#')
                        .setRequired(true)),
                ));
                // Ablehnen heißt hier nur: Fenster nicht abgeschickt (Frist um),
                // wie bei /xp reset. Die Auswahl bleibt dann, wie sie war.
                const fenster = await klick.awaitModalSubmit({ time: MODAL_MS, filter: (m) => m.customId === fensterId && m.user.id === user.id }).catch(() => null);
                if (!fenster) return;
                const hex = fenster.fields.getTextInputValue(ID.FELD).trim().toLowerCase();
                const neu = await waehle(member, { vorlage: w.gewaehlt.vorlage, akzent: hex });
                w = neu.w;
                await fenster.update(neu.nachricht);
                return;
            }
            let eingabe;
            if (klick.customId === ID.SCHABLONE) eingabe = { vorlage: klick.values[0] === WIE_SERVER ? null : klick.values[0], akzent: w.gewaehlt.akzent };
            else if (klick.customId === ID.FARBE) eingabe = { vorlage: w.gewaehlt.vorlage, akzent: klick.values[0] === WIE_SERVER ? null : klick.values[0] };
            else if (klick.customId === ID.ZURUECK) eingabe = { vorlage: null, akzent: null };
            else return;
            await klick.deferUpdate();
            const neu = await waehle(member, eingabe);
            w = neu.w;
            await klick.editReply(neu.nachricht);
        } catch (error) {
            Logger.error(`[Leveling] /levels style für ${user.id} in ${guild.id}:`, error);
        }
    });
    sammler.on('end', () => {
        interaction.editReply({ components: [] })
            .catch((e) => Logger.debug(`[Leveling] Auswahl von /levels style nicht geschlossen: ${e.message}`));
    });
    return antwort;
}

module.exports = { stilRun, FARBEN, ID };
