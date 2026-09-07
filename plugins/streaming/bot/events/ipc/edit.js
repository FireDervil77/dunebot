'use strict';

/**
 * IPC: Ankuendigung bearbeiten.
 *
 * Wird zweimal gebraucht: waehrend des Streams, wenn Titel oder Kategorie
 * nachkommen, und danach fuer die Rueckschau.
 *
 * @param {Object} payload { guildId, channelId, messageId, content, embeds, components }
 * @param {Object} client Discord-Client
 * @returns {Promise<Object>} { success } oder { success: false, error, code }
 */

/**
 * Ab wann ein Schritt gemeldet wird.
 *
 * Dieselbe Zahl wie `IPCClient.LANGSAM_MS`. Wer darueber liegt, haelt den
 * Aufrufer im Dashboard auf.
 */
const LANGSAM_MS = 5000;

/**
 * Einen Schritt mit einer Wache versehen.
 *
 * **Der Wecker feuert, waehrend der Schritt noch laeuft** - und genau darauf
 * kommt es an. Gemessen am 2026-09-07 (Baustelle 102): 250-mal brach
 * `mitFrist` diesen Handler nach exakt 25 001 ms ab. Eine Messung, die erst
 * NACH dem `await` protokolliert, wird in diesem Fall nie erreicht; sie haette
 * den ganzen Abend geschwiegen.
 *
 * Was dabei herauskommt, ist die eine Auskunft, die bis heute fehlt: **welcher
 * der drei Aufrufe** haengt. Ausgeschlossen ist bereits Discords Ratenbremse -
 * `Ratenbremse` ist seit dem 2026-08-26 angemeldet und hat in 250 Faellen
 * keinen einzigen `rateLimited` gemeldet.
 *
 * @param {Object} client Discord-Client (traegt den Logger)
 * @param {string} was Name des Schritts
 * @param {Function} tun Der Schritt
 * @returns {Promise<*>} Ergebnis des Schritts
 */
async function mitWache(client, was, tun) {
    const start = Date.now();
    const wecker = setTimeout(() => {
        client.logger?.warn(`[Streaming/edit] "${was}" laeuft seit ${LANGSAM_MS} ms und ist nicht zurueck`);
    }, LANGSAM_MS);

    try {
        return await tun();
    } finally {
        clearTimeout(wecker);
        const dauer = Date.now() - start;
        if (dauer >= LANGSAM_MS) {
            client.logger?.warn(`[Streaming/edit] "${was}" brauchte ${dauer} ms`);
        }
    }
}

module.exports = async (payload, client) => {
    const { guildId, channelId, messageId, content, embeds, components } = payload;

    try {
        const guild = client.guilds.cache.get(guildId);
        if (!guild) return { success: false, error: 'Guild nicht gefunden', code: 10004 };

        const kanal = await mitWache(client, `channels.fetch ${channelId}`,
            () => guild.channels.fetch(channelId).catch(() => null));
        if (!kanal) return { success: false, error: 'Kanal nicht gefunden', code: 10003 };

        const nachricht = await mitWache(client, `messages.fetch ${messageId}`,
            () => kanal.messages.fetch(messageId).catch(() => null));
        if (!nachricht) return { success: false, error: 'Nachricht nicht gefunden', code: 10008 };

        await mitWache(client, `message.edit ${messageId}`,
            () => nachricht.edit({ content, embeds, components }));
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message, code: error.code ?? null };
    }
};
