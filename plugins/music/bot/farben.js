'use strict';

/**
 * Farben der Musik-Nachrichten (G-09, 2026-11-14).
 *
 * Die Unterbefehle bauen ihre Embeds ohne Guild. Statt einer festen Farbe
 * tragen sie eine **Rolle** (`...farbig('akzent')`): Die Vorgabe des Plugins
 * steht gleich als `color` darin, die Rolle als Symbol daneben (geht nicht mit
 * zu Discord). Eingefärbt wird an den Stellen, die senden und die Guild
 * kennen: `faerbe(nachricht, guildId)` in `commands/music.js` und
 * `managers/GuildPlayer.js`. Wer `faerbe` vergisst, sendet die Vorgabe, also
 * das Aussehen von vor G-09.
 *
 * Die Vorgaben stehen in `plugins/music/package.json` unter `farben.rollen`
 * und nur dort.
 *
 * @module music/bot/farben
 */

const { Gestaltung } = require('dunebot-sdk');

const ROLLE = Symbol('music.farbrolle');

const VORGABE = Object.fromEntries(Object.entries(Gestaltung.erklaerung('music')?.rollen || {})
    .map(([rolle, hex]) => [rolle, parseInt(hex.slice(1), 16)]));

/**
 * Bausatz für ein Embed mit Farbrolle: `{ ...farbig('akzent'), description }`.
 * @param {'akzent'|'warnung'|'gefahr'} rolle
 */
function farbig(rolle) {
    if (!(rolle in VORGABE)) throw new Error(`music: Farbrolle „${rolle}“ steht nicht in package.json farben.rollen`);
    return { [ROLLE]: rolle, color: VORGABE[rolle] };
}

/**
 * Die Embeds einer Nachricht in den Farben der Guild einfärben.
 * @param {Object} nachricht `{ embeds: [...] }`, wird verändert und zurückgegeben
 * @param {string} guildId
 * @returns {Promise<Object>}
 */
async function faerbe(nachricht, guildId) {
    for (const e of nachricht?.embeds || []) {
        if (e && e[ROLLE]) e.color = await Gestaltung.farbe(guildId, e[ROLLE], 'music');
    }
    return nachricht;
}

module.exports = { farbig, faerbe };
