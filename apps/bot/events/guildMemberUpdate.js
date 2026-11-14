'use strict';

const { ServiceManager } = require('dunebot-core');
const Rollen = require('dunebot-sdk/lib/Rollen');

/**
 * Kern-Event: guildMemberUpdate — das Buch der Rollenvergabe folgt Discord
 * (G-07, F-G12 Punkt 3, 2026-11-14).
 *
 * Nimmt jemand einem Mitglied eine verwaltete Rolle von Hand weg, geht der
 * Eintrag in `rollen_vergaben`. Ob das System sie wieder gibt, entscheidet es
 * beim nächsten Anlass.
 *
 * **Altes Mitglied zuerst prüfen (G-13).** Für ungecachte Mitglieder kommt
 * ein leeres altes Mitglied (`partial`), dessen Rollen unbekannt sind. Dann
 * geschieht hier nichts, auch keine Abfrage; der tägliche Abgleich holt es
 * nach. Gelöscht wird nur, was dieses Ereignis als entfernt zeigt (alt hatte
 * die Rolle, neu nicht). Ein verspätetes Ereignis von vor einer Vergabe kann
 * so keinen frischen Eintrag löschen: alt hatte die Rolle dann auch nicht.
 *
 * @param {import('discord.js').GuildMember} alt
 * @param {import('discord.js').GuildMember} neu
 */
module.exports = async (alt, neu) => {
    if (!alt || alt.partial || !neu) return;
    const weg = [...alt.roles.cache.keys()].filter((r) => !neu.roles.cache.has(r));
    if (!weg.length) return;
    try {
        await Rollen.vergiss(neu.guild.id, { mitgliedId: neu.id, rollen: weg });
    } catch (error) {
        ServiceManager.get('Logger').error(`[Rollen] Buch nach Rollenänderung von ${neu.id} in ${neu.guild.id} nicht nachgeführt:`, error);
    }
};
