'use strict';

const { Logger } = require('dunebot-sdk/utils');
const { DiscordRoleMenus } = require('../../../shared/models');
const { reaktionsEmojis } = require('../../rollenmenue/nachricht');

/**
 * IPC-Ereignis: `discord:raeumeRollenmenue`
 *
 * Räumt die Bedienelemente eines Menüs aus Discord, bevor das Menü im Dashboard
 * gelöscht wird.
 *
 * ## Warum das nötig ist
 *
 * Beim Löschen eines Menüs blieb die Nachricht im Kanal stehen — mit Absicht:
 * eine fremde Nachricht zu löschen wäre ein Eingriff, den niemand angefordert
 * hat. Nur blieben mit ihr auch die **Knöpfe und Reaktionen** stehen. Wer
 * darauf drückte, bekam keine Rolle und keine Erklärung. Eine Bedienung, die
 * aussieht wie eine Bedienung und keine mehr ist.
 *
 * Die Nachricht bleibt weiterhin stehen. Was verschwindet, ist ausschliesslich
 * das, was der Bot selbst angebracht hat:
 *
 * - die Knöpfe bzw. die Auswahlliste — aber nur an einer **eigenen** Nachricht,
 *   eine fremde darf Discord ohnehin nicht bearbeiten;
 * - die eigenen Reaktionen des Bots. Die von Mitgliedern bleiben. Sie
 *   mitzunehmen hiesse `removeAll()`, und das löscht auch Daumen und Herzen,
 *   die mit dem Menü nie etwas zu tun hatten.
 *
 * ## Reihenfolge
 *
 * Der Aufruf muss **vor** dem Löschen in der Datenbank erfolgen. Danach gibt es
 * weder Nachrichten-ID noch Emoji-Liste, und es wäre nicht mehr feststellbar,
 * was aufzuräumen ist.
 *
 * @param {{guildId: string, menuId: number}} payload
 * @param {import('discord.js').Client} discordClient
 * @returns {Promise<{ok: boolean, geraeumt?: boolean, fehler?: string}>}
 */
module.exports = async (payload, discordClient) => {
    const { guildId, menuId } = payload || {};

    try {
        const menu = await DiscordRoleMenus.getMenu(guildId, Number(menuId));
        if (!menu) return { ok: true, geraeumt: false };
        if (!menu.message_id || !menu.channel_id) return { ok: true, geraeumt: false };

        const guild = discordClient.guilds.cache.get(String(guildId));
        if (!guild) return { ok: false, fehler: 'Der Server ist gerade nicht erreichbar.' };

        const channel = guild.channels.cache.get(menu.channel_id);
        if (!channel) return { ok: true, geraeumt: false };

        const nachricht = await channel.messages.fetch(menu.message_id).catch(() => null);
        if (!nachricht) return { ok: true, geraeumt: false };

        // Knöpfe und Auswahllisten weg — nur an der eigenen Nachricht.
        if (!menu.fremde_nachricht && nachricht.components.length > 0) {
            await nachricht.edit({ components: [] }).catch((err) => {
                Logger.warn(`[Discord] Bedienelemente von Menü #${menu.id} nicht entfernbar: ${err.message}`);
            });
        }

        // Eigene Reaktionen weg. Verglichen wird ohne Variationsselektor —
        // siehe `rollenmenue/reaktion.js`, dort steht die Begründung.
        const schluessel = (wert) => String(wert || '').replace(/\uFE0F/g, '');
        const meine = new Set(reaktionsEmojis(menu).map(schluessel));
        const ich = discordClient.user.id;

        for (const reaktion of nachricht.reactions.cache.values()) {
            const kennung = reaktion.emoji.id
                ? `<${reaktion.emoji.animated ? 'a' : ''}:${reaktion.emoji.name}:${reaktion.emoji.id}>`
                : reaktion.emoji.name;

            if (!meine.has(schluessel(kennung))) continue;
            if (!reaktion.me) continue;

            await reaktion.users.remove(ich).catch(() => {});
        }

        Logger.info(`[Discord] Rollenmenü #${menu.id} in Discord abgeräumt (Nachricht bleibt stehen)`);
        return { ok: true, geraeumt: true };

    } catch (error) {
        Logger.error(`[Discord] Rollenmenü #${menuId} konnte nicht abgeräumt werden`, error);
        return { ok: false, fehler: error.message };
    }
};
