'use strict';

const { KanalTypen } = require('dunebot-core');

const { KANAL, TYP_NAMEN } = KanalTypen;

/**
 * Kern-IPC-Handler: GET_GUILD_CHANNELS
 *
 * Liefert Kanäle einer Guild für die Auswahllisten im Dashboard.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * Am 2026-08-09 erweitert. Vorher stand hier fest verdrahtet:
 *
 *     .filter(channel => channel.type === 0 && channel.viewable)
 *
 * `0` ist `GuildText`. Damit fielen Sprachkanäle (die seit 2022 einen Textchat
 * haben), Ankündigungs-, Bühnen-, Forum- und Medienkanäle heraus.
 *
 * Das war nicht nur unvollständig, sondern in einer Hälfte der Fälle falsch.
 * Die Liste wird für **zwei Zwecke** benutzt:
 *
 *   - **Zielkanal** — wohin der Bot schreibt (Log-Kanal, Alarmkanal,
 *     Willkommenskanal). Hier ist eine Einschränkung sinnvoll.
 *   - **Auswahlkanal** — welche Kanäle betroffen oder ausgenommen sein sollen
 *     (AutoMod-Whitelist, Ausnahmen, Kanalregeln). Hier war sie falsch:
 *     `messageCreate` filtert **nicht** nach Kanaltyp, der Bot moderiert den
 *     Chat in Sprachkanälen also mit — ausnehmen liess er sich aber nicht.
 *
 * Deshalb entscheidet jetzt der Aufrufer über `types`. **Ohne Angabe bleibt
 * es beim alten Verhalten**, damit die bestehenden neun Aufrufer nicht auf
 * einen Schlag etwas anderes bekommen.
 * ───────────────────────────────────────────────────────────────────────────
 *
 * Threads werden bewusst **nicht** geliefert. Sie kommen und gehen, eine
 * Auswahlliste voller Threads wäre unbrauchbar. Wer den Elternkanal ausnimmt,
 * muss damit auch dessen Threads ausnehmen — das gehört in die Prüfung beim
 * Moderieren, nicht in diese Liste.
 *
 * @param {Object} payload
 * @param {string} payload.guildId Discord-Guild-ID
 * @param {number[]} [payload.types] Gewünschte Kanaltypen. Ohne Angabe: nur Textkanäle.
 * @param {import('discord.js').Client} client
 */
module.exports = (payload, client) => {
    const { guildId, types } = payload;

    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
        return { success: false, error: 'Guild not found', channels: [] };
    }

    // Ohne Angabe: das Verhalten von vor dem 2026-08-09.
    const erlaubt = Array.isArray(types) && types.length > 0
        ? new Set(types.map(Number))
        : new Set([KANAL.TEXT]);

    try {
        const channels = guild.channels.cache
            .filter(channel => erlaubt.has(channel.type) && channel.viewable)
            .sort((a, b) => a.position - b.position)
            .map(channel => ({
                id: channel.id,
                name: channel.name,
                type: channel.type,
                typeName: TYP_NAMEN[channel.type] || 'unknown',
                position: channel.position,
                parentId: channel.parentId,
                parentName: channel.parent ? channel.parent.name : null
            }));

        return { success: true, channels };

    } catch (error) {
        return { success: false, error: error.message, channels: [] };
    }
};
