'use strict';

/**
 * Kern-IPC-Handler: GUILDS_ABGLEICH (K383, 2026-11-14)
 *
 * Das Dashboard fragt einmal am Tag (`core:guild-abgleich`, siehe
 * `apps/dashboard/helpers/GuildAbgleich.js`): „Hier sind die Guilds, die bei
 * uns als Mitglied stehen. In welchen bist du wirklich nicht mehr?“ Der Grund:
 * Wird der Bot hinausgeworfen, während er aus ist, kommt nie ein
 * `guildDelete`. Die Guild behielte `left_at = NULL` und ihre Daten für immer.
 *
 * **Gefragt wird Discord, nicht der Cache.** Der Bot läuft unter dem
 * `ShardingManager`, jeder Shard kennt nur seine eigenen Guilds. Ein Vergleich
 * mit `client.guilds.cache` hielte jede Guild eines anderen Shards für
 * verlassen. Die REST-Liste `GET /users/@me/guilds` gilt für die ganze
 * Anwendung, egal welcher Shard die Frage bekommt.
 *
 * Jede Guild, die in der Liste fehlt, wird **einzeln** nachgefragt
 * (`GET /guilds/{id}`). Nur eine ausdrückliche Absage zählt als „weg“:
 * 404 mit Code 10004 (Unknown Guild) oder 403 mit Code 50001 (Missing
 * Access). Kommt die Guild zurück (der Bot ist inzwischen wieder drin),
 * steht sie unter `drin`. Jede andere Antwort (Netz, 5xx, Ratenbremse) steht
 * unter `unklar` und wird nicht angefasst.
 *
 * Entschieden wird im Dashboard. Dieser Handler schreibt nichts.
 *
 * @param {{ guildIds: string[] }} payload Guilds ohne `left_at`
 * @param {import('discord.js').Client} client
 * @returns {Promise<{botId: string, discord: number, kontrollGuild: boolean,
 *          weg: string[], drin: string[], unklar: {id: string, fehler: string}[]}>}
 *          Wirft, wenn die Liste nicht vollständig zu holen ist.
 */

const { Routes } = require('discord.js');

/** Discord liefert höchstens 200 Guilds je Seite. */
const SEITE = 200;
/** Ausdrückliche Absagen: Der Bot ist in dieser Guild nicht (mehr). */
const ABSAGEN = new Set([10004, 50001]);
const ID = /^\d{17,20}$/;

module.exports = async (payload, client) => {
    const ids = Array.isArray(payload?.guildIds) ? payload.guildIds.map(String) : null;
    if (!ids || ids.some(id => !ID.test(id))) throw new Error('guildIds fehlt oder enthält keine Guild-ID');

    // Wer bin ich? Das Dashboard vergleicht mit seiner CLIENT_ID: Ein Token
    // einer anderen Anwendung sähe lauter fremde Guilds.
    const ich = await client.rest.get(Routes.user());

    const mitglied = new Set();
    let nach = null;
    for (let seite = 0; ; seite++) {
        if (seite > 1000) throw new Error('mehr als 200.000 Guilds, Abbruch');
        const q = new URLSearchParams({ limit: String(SEITE) });
        if (nach) q.set('after', nach);
        const teil = await client.rest.get(Routes.userGuilds(), { query: q });
        if (!Array.isArray(teil)) throw new Error('Discord lieferte keine Liste');
        for (const g of teil) mitglied.add(String(g.id));
        if (teil.length < SEITE) break;
        nach = String(teil[teil.length - 1].id);
    }

    const weg = [];
    const drin = [];
    const unklar = [];
    for (const id of ids) {
        if (mitglied.has(id)) continue;
        try {
            await client.rest.get(Routes.guild(id));
            drin.push(id);
        } catch (e) {
            if (ABSAGEN.has(e?.code)) weg.push(id);
            else unklar.push({ id, fehler: `${e?.status ?? '?'} ${e?.code ?? ''} ${e?.message ?? e}`.trim() });
        }
    }

    return {
        botId: String(ich?.id ?? ''),
        discord: mitglied.size,
        kontrollGuild: mitglied.has(String(process.env.CONTROL_GUILD_ID || '')),
        weg,
        drin,
        unklar,
    };
};
