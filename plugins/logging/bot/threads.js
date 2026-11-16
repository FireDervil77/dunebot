'use strict';

/**
 * Logging: Threads und Foren (3.9, 3.10; LG-1b Teil 2, K382, 2026-11-16).
 *
 * Ein Forenbeitrag ist für Discord ein Thread in einem Forenkanal (oder
 * Medienkanal). Deshalb ein Modul: Liegt der Thread in einem Forum, heißt
 * die Art `forum.beitrag_*` und fällt unter „Foren“, sonst `thread.*` unter
 * „Threads“. Die Tags des Beitrags stehen mit Namen im Vorher/Nachher; die
 * Tags, die ein Forum anbietet, ändert `channelUpdate` (`forum.tags_geaendert`).
 *
 * Der Titel eines Threads gilt als Kanalname (Metadatum), nicht als Text
 * eines Mitglieds; den ersten Beitrag eines Forums erfasst Logging nicht.
 *
 * Archivieren: Discord archiviert Threads nach Ruhe selbst. Ändert sich nur
 * „archiviert“, ist das eine eigene Art, ohne Zeile aus. Mitglieder eines
 * Threads (dazu/weg) ebenso.
 *
 * @module logging/bot/threads
 */

const { ChannelType } = require('discord.js');
const { erfasse } = require('./erfasser');
const { ketteVon } = require('./nachrichten');
const V = require('../shared/vergleich');

const FELDER = ['name', 'typ', 'archiviert', 'gesperrt', 'auto_archiv_min', 'langsam_s', 'einladbar', 'tags'];
const FORUM = new Set([ChannelType.GuildForum, ChannelType.GuildMedia]);

function imForum(t) {
    return FORUM.has(t?.parent?.type);
}

/** Tag-IDs → Namen aus dem Forum; unbekannte bleiben als ID. */
function tagNamen(t) {
    const verfuegbar = new Map((t?.parent?.availableTags || []).map((x) => [String(x.id), x.name]));
    return (t?.appliedTags || []).map((id) => verfuegbar.get(String(id)) || String(id)).sort();
}

function werte(t) {
    return {
        name: t?.name ?? null, typ: t?.type ?? null, archiviert: t?.archived ?? null, gesperrt: t?.locked ?? null,
        auto_archiv_min: t?.autoArchiveDuration ?? null, langsam_s: t?.rateLimitPerUser ?? null,
        einladbar: t?.type === ChannelType.PrivateThread ? (t?.invitable ?? null) : null,
        tags: imForum(t) ? tagNamen(t) : null,
    };
}

const art = (t, was) => (imForum(t) ? `forum.beitrag_${was}` : `thread.${was}`);
const objekt = (t) => ({ typ: 'thread', id: t.id, name: t.name });

/** Nur neu angelegte: `threadCreate` kommt auch, wenn der Bot einen bestehenden Thread zum ersten Mal sieht. */
function angelegt(t, neuAngelegt) {
    if (!neuAngelegt) return [];
    return [{ art: art(t, 'angelegt'), schwere: 'info', akteur: t.ownerId || null, zuordnung: 'sicher',
        kanal: t.parentId, objekt: objekt(t), nachher: werte(t) }];
}

function geloescht(t) {
    return [{ art: art(t, 'geloescht'), schwere: 'info', kanal: t.parentId, objekt: objekt(t), vorher: werte(t) }];
}

function geaendert(alt, neu) {
    if (!alt) return [];
    const d = V.unterschied(werte(alt), werte(neu), FELDER);
    if (!d) return [];
    const nurArchiv = Object.keys(d.nachher).every((f) => f === 'archiviert');
    return [{ art: art(neu, nurArchiv ? 'archiviert' : 'geaendert'), schwere: 'info', kanal: neu.parentId, objekt: objekt(neu), ...d }];
}

/**
 * @param {Map<string, {id: string}>} dazu ThreadMember (auch als Partial mit `id`)
 * @param {Map<string, {id: string}>} weg
 * @param {object} t Thread
 */
function mitglieder(dazu, weg, t) {
    const aus = [];
    for (const [liste, was] of [[dazu, 'mitglied_dazu'], [weg, 'mitglied_weg']]) {
        for (const m of liste?.values?.() || []) {
            if (!m?.id) continue;
            aus.push({ art: `thread.${was}`, schwere: 'info', betroffen: m.id, kanal: t.parentId, objekt: objekt(t) });
        }
    }
    return aus;
}

/** Tags, die ein Forum anbietet (aus `channelUpdate`). */
function forumTags(alt, neu) {
    if (!FORUM.has(neu?.type)) return [];
    const namen = (k) => (k?.availableTags || []).map((x) => x.name).sort();
    const d = V.unterschied({ tags: namen(alt) }, { tags: namen(neu) }, ['tags']);
    return d ? [{ art: 'forum.tags_geaendert', schwere: 'info', kanal: neu.id, objekt: { typ: 'kanal', id: neu.id, name: neu.name }, ...d }] : [];
}

async function melde(guildId, ereignisse, t) {
    const kontext = { kanaele: ketteVon(t) };
    for (const e of ereignisse) await erfasse(guildId, e, kontext);
}

module.exports = { angelegt, geloescht, geaendert, mitglieder, forumTags, imForum, melde };
