'use strict';

const { PermissionFlagsBits } = require('discord.js');
const { Logger } = require('dunebot-sdk/utils');

/**
 * IPC-Ereignis: `discord:pruefeNachricht`
 *
 * Eine bestehende Nachricht nachschlagen, damit ein Rollenmenü daran gehängt
 * werden kann.
 *
 * ## Warum das geprüft wird, bevor irgendetwas gespeichert wird
 *
 * Eine Nachrichten-ID sieht immer gleich aus, ob sie stimmt oder nicht. Wer
 * sie ins Dashboard tippt und erst beim Senden erfährt, dass der Bot den Kanal
 * nicht sieht, hat inzwischen ein halbes Menü gebaut. Deshalb steht die
 * Prüfung vor dem Speichern und beantwortet gleich alles, was danach zählt:
 *
 * - Gibt es die Nachricht, und in welchem Kanal steht sie?
 * - Ist sie vom Bot? Dann geht alles — Text ändern, Knöpfe, Auswahlliste.
 * - Ist sie von jemand anderem? Dann **nur Reaktionen**. Discord lässt keine
 *   fremde Nachricht bearbeiten, und Bauteile gehören zur Nachricht, nicht
 *   zum Bot.
 * - Darf der Bot dort überhaupt Reaktionen setzen?
 *
 * @param {{guildId: string, eingabe: string}} payload
 * @param {import('discord.js').Client} discordClient
 * @returns {Promise<Object>}
 */
module.exports = async (payload, discordClient) => {
    const { guildId, eingabe } = payload || {};

    const guild = discordClient.guilds.cache.get(guildId);
    if (!guild) {
        return { ok: false, fehler: 'Der Server ist gerade nicht erreichbar.' };
    }

    const gelesen = leseEingabe(eingabe);
    if (!gelesen) {
        return {
            ok: false,
            fehler: 'Das ist weder eine Nachrichten-ID noch ein Nachrichtenlink.'
        };
    }

    // Aus einem Link kommt der Kanal mit; aus einer blossen ID nicht — dann
    // müssen alle Kanäle durchsucht werden, in denen der Bot lesen darf.
    const kanaele = gelesen.channelId
        ? [guild.channels.cache.get(gelesen.channelId)].filter(Boolean)
        : [...guild.channels.cache.filter(k => typeof k.messages?.fetch === 'function').values()];

    if (kanaele.length === 0) {
        return { ok: false, fehler: 'Den Kanal aus dem Link gibt es nicht mehr.' };
    }

    // Aus einem Link stammt die Guild-ID mit — gehört sie zu einer anderen
    // Guild, ist der Link schlicht der falsche. Das jetzt zu sagen ist
    // freundlicher als „Nachricht nicht gefunden".
    if (gelesen.guildId && gelesen.guildId !== guildId) {
        return { ok: false, fehler: 'Dieser Link zeigt auf einen anderen Server.' };
    }

    let nachricht = null;
    for (const kanal of kanaele) {
        nachricht = await kanal.messages.fetch(gelesen.messageId).catch(() => null);
        if (nachricht) break;
    }

    if (!nachricht) {
        return {
            ok: false,
            fehler: gelesen.channelId
                ? 'In diesem Kanal gibt es keine Nachricht mit dieser ID.'
                : 'Keine Nachricht mit dieser ID gefunden. Mit einem Nachrichtenlink geht die Suche sicherer.'
        };
    }

    const kanal = nachricht.channel;
    const rechte = kanal.permissionsFor(guild.members.me);

    if (!rechte?.has(PermissionFlagsBits.AddReactions)) {
        return { ok: false, fehler: `Ich darf in #${kanal.name} keine Reaktionen setzen.` };
    }

    const vomBot = nachricht.author?.id === discordClient.user.id;

    Logger.info(
        `[Discord] Nachricht ${nachricht.id} in #${kanal.name} geprüft ` +
        `(${vomBot ? 'eigene' : 'fremde'} Nachricht)`
    );

    return {
        ok: true,
        messageId: nachricht.id,
        channelId: kanal.id,
        channelName: kanal.name,
        vomBot,
        autor: nachricht.author?.tag || null,
        // Ein Vorschautext, damit im Dashboard erkennbar ist, ob es die
        // richtige Nachricht ist. Eine ID allein sagt niemandem etwas.
        vorschau: kuerzeVorschau(nachricht),
        url: nachricht.url
    };
};

/**
 * Eingabe als Nachrichtenlink oder als blosse ID lesen.
 *
 * Discord kopiert „Nachrichtenlink kopieren" als
 * `https://discord.com/channels/<guild>/<kanal>/<nachricht>`; die Handy-App
 * und ältere Fassungen benutzen `canary.` oder `ptb.` davor, manche auch
 * `discordapp.com`. Alle vier Formen kommen in der Praxis vor.
 *
 * @param {*} eingabe
 * @returns {{guildId: string|null, channelId: string|null, messageId: string}|null}
 */
function leseEingabe(eingabe) {
    const text = String(eingabe || '').trim();
    if (!text) return null;

    const link = /(?:https?:\/\/)?(?:\w+\.)?discord(?:app)?\.com\/channels\/(\d+|@me)\/(\d+)\/(\d+)/.exec(text);
    if (link) {
        return {
            guildId: link[1] === '@me' ? null : link[1],
            channelId: link[2],
            messageId: link[3]
        };
    }

    // Discord-IDs (Snowflakes) sind 17 bis 20 Stellen lang.
    if (/^\d{17,20}$/.test(text)) {
        return { guildId: null, channelId: null, messageId: text };
    }

    return null;
}

/**
 * Kurzer Vorschautext einer Nachricht.
 *
 * Eine Nachricht muss keinen Text haben — sie kann nur aus einer Einbettung
 * oder einem Bild bestehen. Dann wird gesagt, was es ist, statt eine leere
 * Zeile zu zeigen.
 *
 * @param {import('discord.js').Message} nachricht
 * @returns {string}
 */
function kuerzeVorschau(nachricht) {
    const text = (nachricht.content || '').replace(/\s+/g, ' ').trim();
    if (text) return text.length > 120 ? text.slice(0, 119) + '…' : text;

    if (nachricht.embeds?.length > 0) {
        const titel = nachricht.embeds[0].title;
        return titel ? `[Einbettung] ${titel}` : '[Einbettung ohne Titel]';
    }
    if (nachricht.attachments?.size > 0) return `[${nachricht.attachments.size} Anhang/Anhänge]`;

    return '[Nachricht ohne Text]';
}
