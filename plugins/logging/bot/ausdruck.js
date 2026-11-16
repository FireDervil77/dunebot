'use strict';

/**
 * Logging: Emojis und Sticker (3.8; LG-1b Teil 2, K382, 2026-11-16).
 *
 * Name, Rollen-Beschränkung und Merkmale eines Emojis; Name, Beschreibung,
 * Tags und Format eines Stickers. Das sind Einstellungen der Guild, kein Text
 * eines Mitglieds. Wer hochlud, kennt discord.js nur nach einer Abfrage je
 * Emoji (`fetchAuthor`); das macht LG-1c über den Audit-Eintrag.
 *
 * @module logging/bot/ausdruck
 */

const { erfasse } = require('./erfasser');
const V = require('../shared/vergleich');

const EMOJI_FELDER = ['name', 'animiert', 'rollen', 'verwaltet'];
const STICKER_FELDER = ['name', 'beschreibung', 'tags', 'format'];

function emojiWerte(e) {
    const rollen = e?.roles?.cache ? [...e.roles.cache.keys()].map(String).sort() : [];
    return { name: e?.name ?? null, animiert: e?.animated ?? null, rollen, verwaltet: e?.managed ?? null };
}

function stickerWerte(s) {
    return { name: s?.name ?? null, beschreibung: s?.description ?? null, tags: s?.tags ?? null, format: s?.format ?? null };
}

const emojiObjekt = (e) => ({ typ: 'emoji', id: e.id, name: e.name });
const stickerObjekt = (s) => ({ typ: 'sticker', id: s.id, name: s.name });

function emojiAngelegt(e) {
    return [{ art: 'emoji.angelegt', schwere: 'info', objekt: emojiObjekt(e), nachher: emojiWerte(e) }];
}
function emojiGeloescht(e) {
    return [{ art: 'emoji.geloescht', schwere: 'info', objekt: emojiObjekt(e), vorher: emojiWerte(e) }];
}
function emojiGeaendert(alt, neu) {
    const d = V.unterschied(emojiWerte(alt), emojiWerte(neu), EMOJI_FELDER);
    return d ? [{ art: 'emoji.geaendert', schwere: 'info', objekt: emojiObjekt(neu), ...d }] : [];
}
function stickerAngelegt(s) {
    return [{ art: 'sticker.angelegt', schwere: 'info', objekt: stickerObjekt(s), nachher: stickerWerte(s) }];
}
function stickerGeloescht(s) {
    return [{ art: 'sticker.geloescht', schwere: 'info', objekt: stickerObjekt(s), vorher: stickerWerte(s) }];
}
function stickerGeaendert(alt, neu) {
    const d = V.unterschied(stickerWerte(alt), stickerWerte(neu), STICKER_FELDER);
    return d ? [{ art: 'sticker.geaendert', schwere: 'info', objekt: stickerObjekt(neu), ...d }] : [];
}

async function melde(guildId, ereignisse) {
    for (const e of ereignisse) await erfasse(guildId, e, {});
}

module.exports = { emojiAngelegt, emojiGeloescht, emojiGeaendert, stickerAngelegt, stickerGeloescht, stickerGeaendert, melde };
