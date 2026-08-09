const { Logger } = require('dunebot-sdk/utils');
const { AutoModKeywordLists } = require('../shared/models');
const { leereMusterSpeicher } = require('../shared/stichwortTreffer');

/**
 * Stichwortlisten für AutoMod.
 *
 * Seit dem 2026-08-09 gibt es **einen** Bestand je Guild, in der Datenbank.
 * Die Dateien unter `data/keyword_lists/` sind nur noch Vorlage für das erste
 * Befüllen und für den ausdrücklichen Abgleich; sie laufen nicht mehr als
 * zweite Ebene mit. Deshalb liest diese Datei sie auch nicht mehr — das tut
 * `AutoModKeywordLists.leseVorlagen()`, dort wo Vorlagen hingehören.
 *
 * ## Der Zwischenspeicher, und warum er der wunde Punkt ist
 *
 * Vorher stand hier ein Speicher ohne Verfallsdatum: `clearKeywordCache()`
 * existierte, hatte aber **keinen einzigen Aufrufer**. Eine Änderung wirkte
 * erst nach einem Neustart des Bots — und weil das Dashboard die Wörter gar
 * nicht anzeigte, fiel das niemandem auf.
 *
 * Jetzt schickt das Dashboard nach jeder Änderung ein
 * `automod:keywordsChanged`, und der Bot ruft `clearKeywordCache(guildId)`.
 * Ohne diesen Anstoss wäre die ganze Bearbeitbarkeit eine Anzeige ohne Wirkung.
 *
 * @module automod/bot/keywordLoader
 */

/** Je Guild die eingeschalteten Listen samt Einträgen. */
const guildSpeicher = new Map();

/**
 * Die eingeschalteten Listen einer Guild.
 *
 * @param {string} guildId
 * @returns {Promise<Array<{id, name, keywords: Array}>>}
 */
async function getGuildKeywordLists(guildId) {
    if (guildSpeicher.has(guildId)) return guildSpeicher.get(guildId);

    let listen;
    try {
        listen = await AutoModKeywordLists.getEnabledWithKeywords(guildId);
    } catch (err) {
        // Eine nicht erreichbare Datenbank darf die Moderation nicht anhalten.
        // Ohne Listen greifen die übrigen Filter weiter; beim nächsten Aufruf
        // wird es erneut versucht, deshalb wird hier nichts gespeichert.
        Logger.warn(`[AutoMod] Stichwortlisten für Guild ${guildId} nicht ladbar: ${err.message}`);
        return [];
    }

    guildSpeicher.set(guildId, listen || []);
    return guildSpeicher.get(guildId);
}

/**
 * Zwischenspeicher leeren.
 *
 * @param {string} [guildId] Nur diese Guild. Ohne Angabe: alle.
 */
function clearKeywordCache(guildId = null) {
    if (guildId) {
        guildSpeicher.delete(guildId);
    } else {
        guildSpeicher.clear();
    }

    // Die übersetzten Muster hängen an den Stichwörtern und müssen mit.
    leereMusterSpeicher();
}

module.exports = {
    getGuildKeywordLists,
    clearKeywordCache
};
