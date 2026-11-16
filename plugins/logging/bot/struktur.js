'use strict';

/**
 * Logging: Server und Struktur, Einladungen (3.4, 3.6; LG-1b, K382, 2026-11-16).
 *
 * Kanäle, Rollen, Servereinstellungen, Webhooks, Einladungen. Rechte werden
 * lesbar gemacht („@Rolle darf jetzt Nachrichten senden“): Bei Rollen der
 * Unterschied der Rechte, bei Kanälen je Überschreibung.
 *
 * Positionen bleiben draußen: Verschiebt jemand einen Kanal, rücken alle
 * darunter mit, und jeder davon käme als eigene Änderung.
 *
 * @module logging/bot/struktur
 */

const { erfasse } = require('./erfasser');
const V = require('../shared/vergleich');
const { GEFAEHRLICHE_RECHTE } = require('../shared/katalog');

const KANAL_FELDER = ['name', 'typ', 'eltern', 'thema', 'nsfw', 'langsam_s', 'bitrate', 'plaetze'];
const ROLLEN_FELDER = ['name', 'farbe', 'abgesetzt', 'erwaehnbar', 'icon', 'emoji', 'verwaltet'];
const SERVER_FELDER = ['name', 'icon', 'banner', 'beschreibung', 'besitzer', 'verifizierung', 'inhaltsfilter',
    'mfa', 'benachrichtigungen', 'systemkanal', 'regelkanal', 'updatekanal', 'afk_kanal', 'afk_s', 'vanity', 'sprache', 'nsfw_stufe'];

/** Kanal in einfache Werte (nur Einstellungen der Guild, nie Nachrichten). */
function kanalWerte(k) {
    return {
        name: k?.name ?? null, typ: k?.type ?? null, eltern: k?.parentId ?? null, thema: k?.topic ?? null,
        nsfw: k?.nsfw ?? null, langsam_s: k?.rateLimitPerUser ?? null, bitrate: k?.bitrate ?? null, plaetze: k?.userLimit ?? null,
    };
}

/** Überschreibungen eines Kanals als einfache Liste. */
function ueberschreibungenVon(k) {
    const cache = k?.permissionOverwrites?.cache;
    if (!cache) return [];
    return [...cache.values()].map((o) => ({ id: String(o.id), type: o.type, allow: o.allow?.bitfield ?? 0n, deny: o.deny?.bitfield ?? 0n }));
}

function rollenWerte(r) {
    return {
        name: r?.name ?? null, farbe: r?.hexColor ?? null, abgesetzt: r?.hoist ?? null, erwaehnbar: r?.mentionable ?? null,
        icon: r?.icon ?? null, emoji: r?.unicodeEmoji ?? null, verwaltet: r?.managed ?? null,
    };
}

function serverWerte(g) {
    return {
        name: g?.name ?? null, icon: g?.icon ?? null, banner: g?.banner ?? null, beschreibung: g?.description ?? null,
        besitzer: g?.ownerId ?? null, verifizierung: g?.verificationLevel ?? null, inhaltsfilter: g?.explicitContentFilter ?? null,
        mfa: g?.mfaLevel ?? null, benachrichtigungen: g?.defaultMessageNotifications ?? null,
        systemkanal: g?.systemChannelId ?? null, regelkanal: g?.rulesChannelId ?? null, updatekanal: g?.publicUpdatesChannelId ?? null,
        afk_kanal: g?.afkChannelId ?? null, afk_s: g?.afkTimeout ?? null, vanity: g?.vanityURLCode ?? null,
        sprache: g?.preferredLocale ?? null, nsfw_stufe: g?.nsfwLevel ?? null,
    };
}

/** Schwere über alle Überschreibungen: @everyone ist die Überschreibung mit der Guild-ID. */
function ueberschreibungsSchwere(liste, guildId) {
    return V.schwerste(...liste.map((u) => V.rechteSchwere(u.erlaubt, String(u.ziel) === String(guildId))));
}

function kanalAngelegt(k) {
    const rechte = V.ueberschreibungen([], ueberschreibungenVon(k));
    // Ein neuer Kanal bringt fast immer Überschreibungen mit; das allein ist
    // keine Warnung. Kritisch bleibt kritisch (Administrator, Gefährliches an @everyone).
    const kritisch = rechte.length && ueberschreibungsSchwere(rechte, k.guild?.id) === 'kritisch';
    return [{
        art: 'kanal.angelegt', schwere: kritisch ? 'kritisch' : 'info',
        kanal: k.id, objekt: { typ: 'kanal', id: k.id, name: k.name },
        nachher: { ...kanalWerte(k), ...(rechte.length ? { rechte } : {}) },
    }];
}

function kanalGeloescht(k) {
    return [{ art: 'kanal.geloescht', schwere: 'warnung', kanal: k.id, objekt: { typ: 'kanal', id: k.id, name: k.name }, vorher: kanalWerte(k) }];
}

function kanalGeaendert(alt, neu) {
    const aus = [];
    const objekt = { typ: 'kanal', id: neu.id, name: neu.name };
    const d = V.unterschied(kanalWerte(alt), kanalWerte(neu), KANAL_FELDER);
    if (d) aus.push({ art: 'kanal.geaendert', schwere: 'info', kanal: neu.id, objekt, ...d });
    const rechte = V.ueberschreibungen(ueberschreibungenVon(alt), ueberschreibungenVon(neu));
    if (rechte.length) {
        aus.push({ art: 'kanal.rechte', schwere: ueberschreibungsSchwere(rechte, neu.guild?.id), kanal: neu.id, objekt, nachher: { rechte } });
    }
    return aus;
}

/** Schwere beim Anlegen einer Rolle: Administrator kritisch, Gefährliches warnung. */
function rollenRechteSchwere(r) {
    const namen = V.rechteNamen(r?.permissions?.bitfield ?? 0n);
    if (namen.includes('Administrator')) return 'kritisch';
    return namen.some((n) => GEFAEHRLICHE_RECHTE.includes(n)) ? 'warnung' : 'info';
}

function rolleAngelegt(r) {
    return [{
        art: 'rolle.angelegt', schwere: rollenRechteSchwere(r), objekt: { typ: 'rolle', id: r.id, name: r.name },
        nachher: { ...rollenWerte(r), rechte: V.rechteNamen(r?.permissions?.bitfield ?? 0n) },
    }];
}

function rolleGeloescht(r) {
    return [{ art: 'rolle.geloescht', schwere: 'warnung', objekt: { typ: 'rolle', id: r.id, name: r.name },
        vorher: { ...rollenWerte(r), rechte: V.rechteNamen(r?.permissions?.bitfield ?? 0n) } }];
}

function rolleGeaendert(alt, neu) {
    const aus = [];
    const objekt = { typ: 'rolle', id: neu.id, name: neu.name };
    const d = V.unterschied(rollenWerte(alt), rollenWerte(neu), ROLLEN_FELDER);
    if (d) aus.push({ art: 'rolle.geaendert', schwere: 'info', objekt, ...d });
    const rechte = V.rechteUnterschied(alt?.permissions?.bitfield ?? 0n, neu?.permissions?.bitfield ?? 0n);
    if (rechte.neu.length || rechte.weg.length) {
        const everyone = String(neu.id) === String(neu.guild?.id);
        aus.push({ art: 'rolle.rechte', schwere: V.rechteSchwere(rechte, everyone), objekt, nachher: { erlaubt: rechte } });
    }
    return aus;
}

/**
 * Servereinstellungen. Kritisch: neuer Besitzer. Warnung: Verifizierung,
 * Inhaltsfilter oder MFA heruntergesetzt.
 */
function serverGeaendert(alt, neu) {
    const d = V.unterschied(serverWerte(alt), serverWerte(neu), SERVER_FELDER);
    if (!d) return [];
    let schwere = 'info';
    if ('besitzer' in d.nachher) schwere = 'kritisch';
    else if (['verifizierung', 'inhaltsfilter', 'mfa'].some((f) => f in d.nachher && Number(d.nachher[f]) < Number(d.vorher[f]))) schwere = 'warnung';
    return [{ art: 'server.geaendert', schwere, objekt: { typ: 'server', id: neu.id, name: neu.name }, ...d }];
}

function webhooksGeaendert(kanal) {
    return [{ art: 'webhooks.geaendert', schwere: 'warnung', kanal: kanal.id, objekt: { typ: 'kanal', id: kanal.id, name: kanal.name } }];
}

/** Einladung angelegt: Der Einlader ist bekannt, die Zuordnung sicher. */
function einladungAngelegt(inv) {
    return [{
        art: 'einladung.angelegt', schwere: 'info', akteur: inv.inviter?.id || inv.inviterId || null, zuordnung: 'sicher',
        kanal: inv.channelId || inv.channel?.id || null, objekt: { typ: 'einladung', name: inv.code },
        nachher: { max_nutzungen: inv.maxUses ?? null, gueltig_s: inv.maxAge ?? null, voruebergehend: inv.temporary ?? null },
    }];
}

function einladungGeloescht(inv) {
    return [{ art: 'einladung.geloescht', schwere: 'info', kanal: inv.channelId || inv.channel?.id || null, objekt: { typ: 'einladung', name: inv.code } }];
}

/** Kanal-Kette für den Kanal-Ausschluss: der Kanal und seine Kategorie. */
function kette(k) {
    return [k?.id, k?.parentId].filter(Boolean).map(String);
}

async function melde(guildId, ereignisse, kontext = {}) {
    for (const e of ereignisse) await erfasse(guildId, e, kontext);
}

module.exports = {
    kanalAngelegt, kanalGeloescht, kanalGeaendert, rolleAngelegt, rolleGeloescht, rolleGeaendert,
    serverGeaendert, webhooksGeaendert, einladungAngelegt, einladungGeloescht,
    ueberschreibungenVon, kette, melde,
};
