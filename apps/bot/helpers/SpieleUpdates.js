'use strict';

const { ServiceManager, Spielemeldungen } = require('dunebot-core');
const SpieleBilder = require('./SpieleBilder');

/**
 * Der Bot als Leser des Kanals mit den Spiele-Updates.
 *
 * Er hört mit (neu, geändert, gelöscht) und holt nach, was während einer
 * Pause eingegangen ist. Was aus einer Nachricht wird und was nicht, steht
 * nicht hier, sondern in `dunebot-core/lib/Spielemeldungen.js`.
 *
 * Welcher Kanal es ist, stellt der Betreiber unter `/admin/content` ein. Ohne
 * Eintrag passiert nichts.
 */

/** So lange gilt der gelesene Kanal. Jede Nachricht in jedem Server fragt danach. */
const MERKDAUER = 60_000;
/** Obergrenze je Nachholen: 30 × 100 Nachrichten. */
const RUNDEN = 30;

let gemerkt = { bis: 0, kanal: null };

const q = (sql, werte) => ServiceManager.get('dbService').query(sql, werte);

async function kanal() {
    if (Date.now() < gemerkt.bis) return gemerkt.kanal;
    gemerkt = { bis: Date.now() + MERKDAUER, kanal: await Spielemeldungen.kanal(q) };
    return gemerkt.kanal;
}

/** Der Kanal wurde im Dashboard geändert. */
function vergiss() {
    gemerkt = { bis: 0, kanal: null };
}

/**
 * Eine Nachricht übernehmen — samt ihrer Bilder. Die Bilder kommen zuerst in
 * die Medienablage; nur was dort liegt, steht danach im Beitrag. Für eine
 * Nachricht, die gar kein Beitrag wird, wird nichts geladen.
 */
async function uebernimm(message, kanalId) {
    const n = Spielemeldungen.ausDiscordJs(message);
    const b = Spielemeldungen.beitrag(n);
    if (!b) return null;
    const bilder = b.originalWeg ? []
        : await SpieleBilder.sichere(n, message.guildId, message.client?.user?.id, `${b.spiel}: ${b.titel}`);
    return Spielemeldungen.uebernimm(q, n, kanalId, bilder);
}

/** Eine neue oder geänderte Nachricht. */
async function beiNachricht(message) {
    const Logger = ServiceManager.get('Logger');
    try {
        const k = await kanal();
        if (!k || message?.channelId !== k.channel_id) return;
        // Eine geänderte Nachricht, die der Bot nicht im Speicher hat, kommt unvollständig.
        const ganz = message.partial ? await message.fetch() : message;
        const was = await uebernimm(ganz, k.channel_id);
        if (was && was !== 'gleich') Logger.info(`[SpieleUpdates] Meldung ${ganz.id} (${ganz.author?.username || '?'}): ${was}`);
    } catch (fehler) {
        Logger.error(`[SpieleUpdates] Meldung ${message?.id} nicht übernommen: ${fehler.message}`, fehler);
    }
}

/** Eine Nachricht wurde aus dem Kanal gelöscht. */
async function beiLoeschung(message) {
    const Logger = ServiceManager.get('Logger');
    try {
        const k = await kanal();
        if (!k || message?.channelId !== k.channel_id) return;
        if (await Spielemeldungen.entfernt(q, message.id)) Logger.info(`[SpieleUpdates] Meldung ${message.id} gelöscht — Beitrag entfernt`);
    } catch (fehler) {
        Logger.error(`[SpieleUpdates] Löschung ${message?.id} nicht verarbeitet: ${fehler.message}`, fehler);
    }
}

/**
 * Holt alles nach, was nach der jüngsten eingelesenen Meldung im Kanal steht —
 * beim ersten Mal alles ab dem Stichtag.
 *
 * `vonVorn` liest den Kanal noch einmal ab dem Stichtag: Was schon im Blog
 * steht, wird dabei nicht doppelt angelegt, aber nachgezogen — ein Text, den
 * der Hersteller geändert hat, während der Bot aus war, und Bilder, die beim
 * ersten Mal fehlten. So ruft es das Dashboard, wenn der Betreiber „Speichern
 * und nachholen" drückt.
 *
 * @param {import('discord.js').Client} client
 * @param {{vonVorn?: boolean}} [wie]
 * @returns {Promise<{aktiv: boolean, kanal?: string, gelesen?: number, neu?: number, geaendert?: number, fehler?: string}>}
 */
async function nachholen(client, { vonVorn = false } = {}) {
    const k = await kanal();
    if (!k) return { aktiv: false };

    const ziel = await client.channels.fetch(k.channel_id).catch(() => null);
    if (!ziel?.messages) return { aktiv: true, kanal: k.channel_name, fehler: 'Der Bot kann den Kanal nicht lesen.' };

    const stichtag = Spielemeldungen.kennungAus(new Date(`${Spielemeldungen.STICHTAG}T00:00:00Z`));
    let nach = (vonVorn ? null : await Spielemeldungen.letzteKennung(q, k.channel_id)) || stichtag;
    const zahl = { gelesen: 0, neu: 0, geaendert: 0 };

    for (let runde = 0; runde < RUNDEN; runde++) {
        const teil = await ziel.messages.fetch({ after: nach, limit: 100 });
        if (!teil.size) break;
        // Älteste zuerst, damit ein Abbruch mittendrin keine Lücke lässt.
        const sortiert = [...teil.values()].sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
        for (const message of sortiert) {
            zahl.gelesen++;
            const was = await uebernimm(message, k.channel_id);
            if (was === 'neu') zahl.neu++;
            if (was === 'geaendert') zahl.geaendert++;
        }
        nach = sortiert[sortiert.length - 1].id;
        if (teil.size < 100) break;
    }
    return { aktiv: true, kanal: k.channel_name, ...zahl };
}

module.exports = { beiNachricht, beiLoeschung, nachholen, vergiss };
