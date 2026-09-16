'use strict';

const languagesMeta = require("../languages-meta.json");

/**
 * Sprachwahl — welche unserer Sprachen passt zu dem, was Discord sagt?
 *
 * Discord fuehrt je Server eine „bevorzugte Sprache" (`guild.preferredLocale`).
 * Bis zum 2026-09-16 hat der Bot sie nie gelesen: jede neue Guild bekam
 * `LOCALE = de-DE` aus `guild-defaults.json`, auch eine englische.
 *
 * Wir haben genau zwei Sprachen (`languages-meta.json`). Die Zuordnung ist
 * deshalb keine Tabelle, sondern eine Entscheidung in drei Stufen:
 *
 *   1. Volltreffer auf Name, Discord-Kennung oder Alias  → diese Sprache
 *   2. Nur der Sprachteil („en-US" → „en")               → diese Sprache
 *   3. Kennen wir nicht (z. B. „fr")                     → Englisch
 *
 * **Stufe 3 ist bewusst Englisch, nicht Deutsch.** Wer seinen Server auf
 * Franzoesisch stellt, versteht mit hoeherer Wahrscheinlichkeit Englisch als
 * Deutsch. Deutsch bleibt nur die Vorgabe fuer den Fall, dass Discord uns
 * ueberhaupt nichts sagt.
 *
 * Reine Entscheidung: kein Discord, keine Datenbank, kein Logger. Geprueft
 * von `scripts/check-willkommen.js`.
 */

/** Discord sagt nichts — dann bleibt es bei der Hausvorgabe. */
const OHNE_ANGABE = "de-DE";

/** Discord sagt etwas, das wir nicht haben. */
const FREMDE_SPRACHE = "en-GB";

/**
 * Macht Sprachkennungen vergleichbar: „de_DE", „de-DE" und „De-de" sind eins.
 * @param {*} wert
 * @returns {string}
 */
function normiere(wert) {
    return String(wert ?? "").trim().toLowerCase().replace(/_/g, "-");
}

/**
 * Alle Kennungen, unter denen eine Sprache bei uns auftauchen kann.
 * @param {Object} sprache - Ein Eintrag aus languages-meta.json
 * @returns {string[]}
 */
function kennungen(sprache) {
    return [sprache.name, sprache.discord, ...(sprache.aliases || [])]
        .filter(Boolean)
        .map(normiere);
}

/**
 * Waehlt unsere Sprache zu einer Discord-Sprachkennung.
 *
 * @param {string|null|undefined} discordSprache - z. B. „de", „en-US", „fr"
 * @returns {string} Name einer Sprache aus languages-meta.json (z. B. „de-DE")
 */
function spracheAusDiscord(discordSprache) {
    const gesucht = normiere(discordSprache);
    if (!gesucht) return OHNE_ANGABE;

    // 1. Volltreffer
    for (const sprache of languagesMeta) {
        if (kennungen(sprache).includes(gesucht)) return sprache.name;
    }

    // 2. Nur der Sprachteil — Discord schickt „en-US", wir fuehren „en-GB"
    const sprachteil = gesucht.split("-")[0];
    for (const sprache of languagesMeta) {
        if (kennungen(sprache).some((k) => k.split("-")[0] === sprachteil)) {
            return sprache.name;
        }
    }

    // 3. Kennen wir nicht
    return FREMDE_SPRACHE;
}

module.exports = { spracheAusDiscord, OHNE_ANGABE, FREMDE_SPRACHE };
