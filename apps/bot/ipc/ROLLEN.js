'use strict';

/**
 * Kern-IPC-Handler: ROLLEN (G-07, K382, 2026-11-14)
 *
 * Ein Auftrag der Rollenvergabe aus dem Dashboard (`Rollen.vergib`, `nimm`,
 * `gibAb` im Dashboard schicken ihn hierher). Ausgeführt wird er mit
 * demselben Code wie im Bot (`dunebot-sdk/lib/Rollen.js`), das Buch
 * `rollen_vergaben` schreibt also nur der Bot.
 *
 * Gibt es die Guild auf diesem Shard nicht, antwortet er `success: false`
 * mit Code 10004; das Dashboard nimmt die Antwort des Shards, der sie hat.
 *
 * @param {{ art: 'vergib'|'nimm'|'gibAb', guildId: string, userId: string,
 *           rollen: string[], besitzer: string, bezug?: string, grund?: string }} payload
 * @param {import('discord.js').Client} client
 * @returns {Promise<{success: boolean, ergebnis?: Object, error?: string, code?: number}>}
 */
const Rollen = require('dunebot-sdk/lib/Rollen');

const ID = /^\d{17,20}$/;

module.exports = async (payload, client) => {
    const { art, guildId, userId, rollen, besitzer, bezug, grund } = payload || {};
    if (!Rollen.ARTEN.includes(art)) return { success: false, error: `Unbekannte Art "${art}"` };
    if (!ID.test(String(guildId || '')) || !ID.test(String(userId || ''))) return { success: false, error: 'guildId oder userId fehlt' };
    if (!Rollen.BESITZER.test(String(besitzer || ''))) return { success: false, error: `Besitzer "${besitzer}" ungültig` };

    const guild = client.guilds.cache.get(String(guildId));
    if (!guild) return { success: false, error: 'Guild nicht gefunden', code: 10004 };

    const ergebnis = await Rollen[art]({ guild, userId: String(userId), rollen, besitzer, bezug, grund });
    return { success: true, ergebnis };
};
