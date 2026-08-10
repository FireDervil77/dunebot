'use strict';

const { MessageFlags } = require('discord.js');
const { Logger } = require('dunebot-sdk/utils');
const { DiscordRoleMenus } = require('../../shared/models');
const { AKTION, fuerEinenEintrag, fuerAuswahl } = require('../rollenmenue/entscheidung');
const { wendeAn } = require('../rollenmenue/anwenden');
const { baueText } = require('../rollenmenue/rueckmeldung');
const { leseKennung } = require('../rollenmenue/nachricht');

/**
 * Knöpfe und Auswahllisten eines Rollenmenüs.
 *
 * ## Warum zuerst geantwortet und dann gearbeitet wird
 *
 * Discord gibt **drei Sekunden**, um auf eine Interaktion zu reagieren.
 * Danach sieht der Nutzer „Diese Interaktion ist fehlgeschlagen", ganz gleich
 * was der Bot danach noch tut. Eine Datenbankabfrage plus zwei Rollenaufrufe
 * passen bei gutem Wetter hinein — bei schlechtem nicht.
 *
 * Deshalb steht `deferReply` an erster Stelle, noch vor dem Nachschlagen des
 * Menüs. Danach sind es 15 Minuten statt drei Sekunden.
 *
 * @param {import('discord.js').Interaction} interaction
 */
module.exports = async (interaction) => {
    if (!interaction.isButton() && !interaction.isStringSelectMenu()) return;

    const kennung = leseKennung(interaction.customId);
    if (!kennung) return;
    if (!interaction.guild || !interaction.member) return;

    try {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    } catch {
        // Die drei Sekunden sind bereits verstrichen, oder Discord hat die
        // Interaktion schon verworfen. Ohne Antwortkanal ist hier nichts mehr
        // auszurichten — der Rollenteil würde zwar laufen, aber der Nutzer
        // bekäme trotzdem einen Fehler zu sehen.
        return;
    }

    try {
        const menu = await DiscordRoleMenus.getMenu(interaction.guild.id, kennung.menuId);

        if (!menu || !menu.enabled) {
            return interaction.editReply({
                content: 'Dieses Rollenmenü gibt es nicht mehr oder es ist abgeschaltet.'
            });
        }

        const alleRollen = menu.optionen.map(o => String(o.role_id));
        const hatRollen = new Set(interaction.member.roles.cache.map(r => r.id));

        let aenderung;

        if (interaction.isStringSelectMenu()) {
            // Discord schickt die Eintrags-IDs zurück, nicht die Rollen-IDs.
            // Der Umweg ist Absicht: die Kennung eines Eintrags bleibt gleich,
            // auch wenn ihm später eine andere Rolle zugeordnet wird.
            const gewaehlteRollen = interaction.values
                .map(wert => menu.optionen.find(o => String(o.id) === String(wert)))
                .filter(Boolean)
                .map(o => String(o.role_id));

            aenderung = fuerAuswahl(menu, gewaehlteRollen, alleRollen, hatRollen);
        } else {
            const eintrag = menu.optionen.find(o => String(o.id) === String(kennung.optionId));
            if (!eintrag) {
                return interaction.editReply({
                    content: 'Dieser Eintrag gehört nicht mehr zum Menü.'
                });
            }

            aenderung = fuerEinenEintrag(menu, eintrag, alleRollen, hatRollen, AKTION.SETZEN);
        }

        const ergebnis = await wendeAn(
            interaction.member,
            aenderung,
            `Rollenmenü „${menu.title}" (#${menu.id})`
        );

        return interaction.editReply({ content: baueText(ergebnis, aenderung.hinweis) });

    } catch (error) {
        Logger.error('[Discord] Rollenmenü-Interaktion fehlgeschlagen', error);

        // `editReply` und nicht `reply`: der Antwortkanal steht seit dem
        // `deferReply` oben offen, ein zweites `reply` würde selbst werfen.
        return interaction.editReply({
            content: 'Da ist etwas schiefgegangen. Bitte später noch einmal versuchen.'
        }).catch(() => {});
    }
};
