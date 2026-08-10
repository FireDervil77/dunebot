'use strict';

const { PermissionFlagsBits } = require('discord.js');
const { Logger } = require('dunebot-sdk/utils');
const { DiscordRoleMenus } = require('../../../shared/models');
const { baueNachricht, reaktionsEmojis } = require('../../rollenmenue/nachricht');

/**
 * IPC-Ereignis: `discord:sendeRollenmenue`
 *
 * Schickt ein Rollenmenü in seinen Kanal — oder aktualisiert es, wenn es schon
 * dort steht.
 *
 * ## Warum aktualisiert statt neu gesendet wird
 *
 * Die Fassung in `greeting` sendete **immer** eine neue Nachricht. Zweimal auf
 * „Senden" heisst dort: zwei Menüs im Kanal, und das erste wirkt nicht mehr,
 * weil nur die neue Nachrichten-ID gespeichert bleibt. Die alte bleibt stehen,
 * sieht funktionsfähig aus und tut nichts — genau die Art Fehler, die niemand
 * meldet, weil man sie für eigenes Missverständnis hält.
 *
 * Hier wird zuerst versucht, die gespeicherte Nachricht zu holen. Gibt es sie
 * noch, wird sie bearbeitet. Ist sie gelöscht, wird eine neue gesendet und die
 * ID überschrieben.
 *
 * @param {{guildId: string, menuId: number}} payload
 * @param {import('discord.js').Client} discordClient
 * @returns {Promise<Object>}
 */
module.exports = async (payload, discordClient) => {
    const { guildId, menuId } = payload || {};

    const menu = await DiscordRoleMenus.getMenu(guildId, Number(menuId));
    if (!menu) {
        return { ok: false, fehler: 'Das Rollenmenü gibt es nicht.' };
    }
    if (!menu.channel_id) {
        return { ok: false, fehler: 'Für dieses Menü ist kein Kanal gewählt.' };
    }
    if (menu.optionen.length === 0) {
        return { ok: false, fehler: 'Das Menü hat noch keine Einträge.' };
    }

    const guild = discordClient.guilds.cache.get(guildId);
    if (!guild) {
        return { ok: false, fehler: 'Der Server ist gerade nicht erreichbar.' };
    }

    const channel = guild.channels.cache.get(menu.channel_id);
    if (!channel) {
        return { ok: false, fehler: 'Den gewählten Kanal gibt es nicht mehr.' };
    }

    // Vorher prüfen statt hinterher scheitern: ohne diese beiden Rechte wird
    // das Senden mit einer nichtssagenden Discord-Meldung abgelehnt.
    const ich = guild.members.me;
    const rechte = channel.permissionsFor(ich);
    if (!rechte?.has(PermissionFlagsBits.ViewChannel) || !rechte?.has(PermissionFlagsBits.SendMessages)) {
        return { ok: false, fehler: `Ich darf in #${channel.name} nicht schreiben.` };
    }
    if (menu.darstellung === 'reaktion' && !rechte.has(PermissionFlagsBits.AddReactions)) {
        return { ok: false, fehler: `Ich darf in #${channel.name} keine Reaktionen setzen.` };
    }

    const inhalt = baueNachricht(menu, guild);

    try {
        let nachricht = null;
        let neu = false;

        if (menu.message_id) {
            nachricht = await channel.messages.fetch(menu.message_id).catch(() => null);
        }

        if (nachricht) {
            await nachricht.edit(inhalt);
        } else {
            nachricht = await channel.send(inhalt);
            neu = true;
            await DiscordRoleMenus.updateMenu(guildId, menu.id, { message_id: nachricht.id });
        }

        const uebersprungen = await setzeReaktionen(nachricht, menu, neu);

        Logger.info(
            `[Discord] Rollenmenü #${menu.id} ${neu ? 'gesendet' : 'aktualisiert'} ` +
            `in #${channel.name} (${menu.optionen.length} Einträge)`
        );

        return {
            ok: true,
            messageId: nachricht.id,
            neu,
            uebersprungen,
            url: `https://discord.com/channels/${guildId}/${channel.id}/${nachricht.id}`
        };

    } catch (error) {
        Logger.error(`[Discord] Rollenmenü #${menu.id} konnte nicht gesendet werden`, error);
        return { ok: false, fehler: error.message };
    }
};

/**
 * Die Reaktionen unter die Nachricht setzen.
 *
 * Bei einer aktualisierten Nachricht werden vorhandene Reaktionen des Bots
 * zuerst entfernt — sonst bleibt das Emoji eines gelöschten Eintrags für immer
 * unter der Nachricht stehen und sieht aus, als täte es noch etwas.
 *
 * @param {import('discord.js').Message} nachricht
 * @param {Object} menu
 * @param {boolean} neu Ob die Nachricht gerade erst gesendet wurde
 * @returns {Promise<string[]>} Emojis, die nicht gesetzt werden konnten
 */
async function setzeReaktionen(nachricht, menu, neu) {
    const emojis = reaktionsEmojis(menu);
    if (emojis.length === 0) {
        if (!neu) await nachricht.reactions.removeAll().catch(() => {});
        return [];
    }

    if (!neu) {
        await nachricht.reactions.removeAll().catch(() => {});
    }

    const uebersprungen = [];
    for (const emoji of emojis) {
        try {
            await nachricht.react(emoji);
        } catch (err) {
            // Häufigster Grund: ein eigenes Emoji von einem anderen Server, das
            // der Bot nicht benutzen darf. Das darf den Rest nicht aufhalten.
            Logger.warn(`[Discord] Reaktion ${emoji} nicht setzbar: ${err.message}`);
            uebersprungen.push(emoji);
        }
    }

    return uebersprungen;
}
