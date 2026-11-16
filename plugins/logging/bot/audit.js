'use strict';

/**
 * Logging: Audit-Eintrag → Kandidaten für die Täter-Zuordnung (LG-1c, K382, 2026-11-16).
 *
 * Rein, ohne Zustand, damit der Wächter jede Zeile der Tabelle prüft. Den
 * Zustand (warten, zwischenspeichern, Bündel nachfragen) hält `zuordner.js`.
 *
 * Ein Kandidat sagt: „Dieser Eintrag kann Ereignisse der Arten X mit Ziel Y
 * erklären, Täter Z, Güte G.“ Ein Ereignis passt, wenn seine Art dabei ist
 * und sein Ziel (`zielVon`) gleich ist. Der Kanal muss zusätzlich passen,
 * wenn der Kandidat einen nennt.
 *
 * Güte (Konzept „Audit-Zuordnung“):
 *   sicher          Der Eintrag ist das Ereignis selbst: gleiche Aktion, gleiches Ziel.
 *   wahrscheinlich  Discord nennt das Ziel nicht genau. Nachrichten löschen
 *                   (Ziel ist der Autor, nicht die Nachricht, und Discord
 *                   bündelt), Verschieben/Trennen im Sprachkanal (kein
 *                   Mitglied genannt), Ausdünnen (kein Mitglied genannt),
 *                   Webhook ohne Kanal. Die Seite zeigt dann „vermutlich X“.
 *
 * `schluessel` teilt einen Eintrag nach den geänderten Feldern auf: Ein
 * Spitzname und ein Timeout am selben Mitglied sind zwei Einträge mit je
 * eigenem Täter. Kennt die Tabelle keinen der Schlüssel, gelten alle Arten.
 *
 * `wird` benennt die Art um, wenn erst der Audit-Eintrag sagt, was geschah:
 * Ein Kick kommt als `guildMemberRemove` an wie ein freiwilliges Verlassen.
 *
 * `buendel`: Discord zählt bei diesen Aktionen einen vorhandenen Eintrag
 * hoch, statt einen neuen anzulegen. Der zweite Fall desselben Moderators
 * kommt dann nicht als Push; `zuordner.js` fragt in genau diesem Fall nach.
 *
 * @module logging/bot/audit
 */

const { AuditLogEvent } = require('discord.js');

const t = (e) => (e.targetId ? String(e.targetId) : null);
const aenderung = (e, key) => {
    const c = (e.changes || []).find((x) => x.key === key);
    return c ? (c.new ?? c.old ?? null) : null;
};
const kanalExtra = (e) => (e.extra?.channel?.id ? String(e.extra.channel.id) : null);

/**
 * Aktion (Name aus `AuditLogEvent`) → was sie erklären kann.
 * `ziel`/`kanal` lesen aus dem Eintrag; ohne `ziel` gilt `targetId`.
 */
const TABELLE = {
    GuildUpdate: { arten: ['server.geaendert'], ziel: () => 'server' },

    ChannelCreate: { arten: ['kanal.angelegt'] },
    ChannelUpdate: {
        arten: ['kanal.geaendert', 'forum.tags_geaendert'],
        schluessel: { available_tags: ['forum.tags_geaendert'], '*': ['kanal.geaendert'] },
    },
    ChannelDelete: { arten: ['kanal.geloescht'] },
    ChannelOverwriteCreate: { arten: ['kanal.rechte'] },
    ChannelOverwriteUpdate: { arten: ['kanal.rechte'] },
    ChannelOverwriteDelete: { arten: ['kanal.rechte'] },

    MemberKick: { arten: ['mitglied.verlassen', 'bot.verlassen'], wird: 'gekickt' },
    MemberPrune: { arten: ['mitglied.verlassen'], ziel: () => null, guete: 'wahrscheinlich' },
    MemberBanAdd: { arten: ['mitglied.gebannt', 'mitglied.verlassen', 'bot.verlassen'] },
    MemberBanRemove: { arten: ['mitglied.entbannt'] },
    MemberUpdate: {
        arten: ['mitglied.spitzname', 'bot.spitzname', 'mitglied.timeout', 'mitglied.timeout_ende',
            'sprache.server_stumm', 'sprache.server_taub'],
        schluessel: {
            nick: ['mitglied.spitzname', 'bot.spitzname'],
            communication_disabled_until: ['mitglied.timeout', 'mitglied.timeout_ende'],
            mute: ['sprache.server_stumm'],
            deaf: ['sprache.server_taub'],
        },
    },
    MemberRoleUpdate: { arten: ['mitglied.rollen', 'bot.rollen'] },
    MemberMove: { arten: ['sprache.gewechselt'], ziel: () => null, kanal: kanalExtra, guete: 'wahrscheinlich', buendel: true },
    MemberDisconnect: { arten: ['sprache.verlassen'], ziel: () => null, guete: 'wahrscheinlich', buendel: true },
    BotAdd: { arten: ['bot.beigetreten'] },

    RoleCreate: { arten: ['rolle.angelegt'] },
    RoleUpdate: {
        arten: ['rolle.geaendert', 'rolle.rechte'],
        schluessel: { permissions: ['rolle.rechte'], '*': ['rolle.geaendert'] },
    },
    RoleDelete: { arten: ['rolle.geloescht'] },

    InviteDelete: { arten: ['einladung.geloescht'], ziel: (e) => aenderung(e, 'code') },

    WebhookCreate: { arten: ['webhooks.geaendert'], ziel: (e) => aenderung(e, 'channel_id') },
    WebhookUpdate: { arten: ['webhooks.geaendert'], ziel: (e) => aenderung(e, 'channel_id') },
    WebhookDelete: { arten: ['webhooks.geaendert'], ziel: (e) => aenderung(e, 'channel_id') },

    EmojiCreate: { arten: ['emoji.angelegt'] },
    EmojiUpdate: { arten: ['emoji.geaendert'] },
    EmojiDelete: { arten: ['emoji.geloescht'] },
    StickerCreate: { arten: ['sticker.angelegt'] },
    StickerUpdate: { arten: ['sticker.geaendert'] },
    StickerDelete: { arten: ['sticker.geloescht'] },

    GuildScheduledEventCreate: { arten: ['termin.angelegt'] },
    GuildScheduledEventUpdate: {
        arten: ['termin.geaendert', 'termin.gestartet', 'termin.beendet', 'termin.abgesagt'],
        schluessel: { status: ['termin.gestartet', 'termin.beendet', 'termin.abgesagt'], '*': ['termin.geaendert'] },
    },
    GuildScheduledEventDelete: { arten: ['termin.geloescht'] },

    MessageDelete: { arten: ['nachricht.geloescht'], kanal: kanalExtra, guete: 'wahrscheinlich', buendel: true },
    MessageBulkDelete: { arten: ['nachricht.massenloeschung'] },
    MessagePin: { arten: ['nachricht.angeheftet'], ziel: (e) => (e.extra?.messageId ? String(e.extra.messageId) : null) },
    MessageUnpin: { arten: ['nachricht.losgeheftet'], ziel: (e) => (e.extra?.messageId ? String(e.extra.messageId) : null) },

    ThreadCreate: { arten: ['thread.angelegt', 'forum.beitrag_angelegt'] },
    ThreadUpdate: {
        arten: ['thread.geaendert', 'thread.archiviert', 'forum.beitrag_geaendert', 'forum.beitrag_archiviert'],
        schluessel: {
            archived: ['thread.archiviert', 'forum.beitrag_archiviert'],
            '*': ['thread.geaendert', 'forum.beitrag_geaendert'],
        },
    },
    ThreadDelete: { arten: ['thread.geloescht', 'forum.beitrag_geloescht'] },
};

/** Alle Arten, zu denen ein Audit-Eintrag kommen kann. Nur auf sie wartet der Zuordner. */
const ARTEN_MIT_AUDIT = new Set(Object.values(TABELLE).flatMap((z) => z.arten));

/** Arten, deren Aktion Discord bündelt (Nachfrage beim Ablauf). Art → Aktionsnummern. */
const BUENDEL_AKTIONEN = Object.entries(TABELLE)
    .filter(([, z]) => z.buendel)
    .reduce((m, [name, z]) => {
        for (const a of z.arten) m[a] = [...(m[a] || []), AuditLogEvent[name]];
        return m;
    }, {});

/**
 * Arten aus den geänderten Feldern. Ohne Änderungsliste alle; ein Feld, das
 * die Tabelle nicht kennt, zählt zu `*`, und ohne `*` zu keiner Art (sonst
 * bekäme ein Timeout den Täter einer Avatar-Änderung).
 */
function artenVon(zeile, eintrag) {
    if (!zeile.schluessel) return zeile.arten;
    const keys = (eintrag.changes || []).map((c) => c.key);
    if (!keys.length) return zeile.arten;
    const aus = new Set();
    for (const k of keys) {
        for (const a of zeile.schluessel[k] || zeile.schluessel['*'] || []) aus.add(a);
    }
    return [...aus];
}

/**
 * Audit-Eintrag → Kandidaten.
 *
 * @param {object} eintrag `GuildAuditLogsEntry` (action, executorId, targetId, changes, extra, id)
 * @returns {Array<{aktion: number, eintragId: string, akteur: string, arten: Set<string>, ziel: string|null,
 *                  kanal: string|null, guete: string, wird: string|null, buendel: boolean, anzahl: number}>}
 */
function kandidaten(eintrag) {
    const name = AuditLogEvent[eintrag?.action];
    const zeile = TABELLE[name];
    if (!zeile || !eintrag.executorId) return [];
    return [{
        aktion: eintrag.action,
        eintragId: String(eintrag.id),
        akteur: String(eintrag.executorId),
        arten: new Set(artenVon(zeile, eintrag)),
        ziel: zeile.ziel ? zeile.ziel(eintrag) : t(eintrag),
        kanal: zeile.kanal ? zeile.kanal(eintrag) : null,
        guete: zeile.guete || 'sicher',
        wird: zeile.wird || null,
        buendel: Boolean(zeile.buendel),
        anzahl: Number(eintrag.extra?.count ?? 1) || 1,
    }];
}

/**
 * Ziel eines Ereignisses, so wie Discord es im Audit-Eintrag nennt.
 * Mitglieder und Sprache: das Mitglied; Nachrichten löschen: der Autor;
 * Massenlöschung und Webhooks: der Kanal; Einladung: der Code; sonst das Objekt.
 */
function zielVon(e) {
    const bereich = String(e?.art || '').split('.')[0];
    switch (bereich) {
        case 'mitglied': case 'bot': case 'sprache': return e.betroffen ? String(e.betroffen) : null;
        case 'server': return 'server';
        case 'webhooks': return e.kanal ? String(e.kanal) : null;
        case 'einladung': return e.objekt?.name ? String(e.objekt.name) : null;
        case 'nachricht':
            if (e.art === 'nachricht.geloescht') return e.betroffen ? String(e.betroffen) : null;
            if (e.art === 'nachricht.massenloeschung') return e.kanal ? String(e.kanal) : null;
            return e.objekt?.id ? String(e.objekt.id) : null;
        default: return e.objekt?.id ? String(e.objekt.id) : null;
    }
}

/**
 * Passt der Kandidat zum Ereignis?
 *
 * Eine gelöschte Nachricht, die der Bot nicht im Speicher hatte, kennt ihren
 * Autor nicht. Dann genügt der Kanal; die Güte ist bei Nachrichten ohnehin
 * „wahrscheinlich“.
 */
function passt(k, e) {
    if (!k?.arten?.has(e?.art)) return false;
    if (k.kanal && String(k.kanal) !== String(e.kanal || '')) return false;
    if (k.ziel == null) return true;
    const z = zielVon(e);
    if (z == null) return e.art === 'nachricht.geloescht' && Boolean(k.kanal);
    return z === String(k.ziel);
}

/** Ereignis mit Täter. Ein Kick macht aus „verlassen“ „gekickt“ und mindestens eine Warnung. */
function wende(e, k, guete = k.guete) {
    const aus = { ...e, akteur: k.akteur, zuordnung: guete };
    if (k.wird && /\.verlassen$/.test(e.art)) {
        aus.art = e.art.replace(/\.verlassen$/, `.${k.wird}`);
        if (aus.schwere === 'info') aus.schwere = 'warnung';
    }
    return aus;
}

module.exports = { TABELLE, ARTEN_MIT_AUDIT, BUENDEL_AKTIONEN, kandidaten, zielVon, passt, wende, artenVon };
