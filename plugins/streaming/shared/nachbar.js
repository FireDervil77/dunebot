'use strict';

/**
 * Ist ein Nachbar-Plugin in **dieser Guild** an?
 *
 * # Warum es diese Datei gibt
 *
 * Streaming haengt an drei anderen Plugins: Verlosungen (`giveaway`), Musik
 * (`music`) und Gameserver (`gameserver`). Jedes traegt sich beim Laden in eine
 * Registry des SDK ein - und dieser Eintrag steht im **ganzen Prozess**, sobald
 * das Plugin in irgendeiner Guild geladen ist. Ob es in der Guild an ist, um
 * die es gerade geht, sagt er nicht.
 *
 * Bis zum 2026-11-10 fragten Mitmachen-Seite, Musikablage und Streamserver nur
 * den Eintrag (K367, K368, K369). Eine Guild mit abgeschaltetem Musik-Plugin
 * bekam trotzdem Titel nachgelegt; eine mit abgeschaltetem Gameserver-Plugin
 * bekam Server gestoppt. Nur die Chat-Befehle fragten die Guild
 * (`befehle.verfuegbar`) - mit eigenem Code.
 *
 * Jetzt fragen alle hier. Eine Antwort, nicht vier.
 *
 * # Was die Antwort heisst
 *
 * `pruefbar: false` heisst: Es gibt keinen `pluginManager` (Tests, Bot ohne
 * Dashboard). Dann **nicht raten** - "an" waere die bequeme Annahme und die
 * falsche: Der Befehl liefe ins Leere, der Server wuerde gestoppt.
 *
 * @module streaming/shared/nachbar
 */

const { ServiceManager } = require('dunebot-core');

/**
 * @param {string} plugin Name des Nachbar-Plugins
 * @param {string} guildId Guild
 * @returns {Promise<{an: boolean, pruefbar: boolean}>} Stand
 */
async function pluginAn(plugin, guildId) {
    // **`has` und nicht `get`.** `ServiceManager.get` wirft bei einem
    // unbekannten Dienst, es gibt kein `null` zurueck.
    if (!ServiceManager.has('pluginManager')) return { an: false, pruefbar: false };
    if (!guildId) return { an: false, pruefbar: true };

    const an = await ServiceManager.get('pluginManager').isPluginEnabledForGuild(plugin, guildId);
    return { an: Boolean(an), pruefbar: true };
}

module.exports = { pluginAn };
