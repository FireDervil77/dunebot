'use strict';

/**
 * Zeitplan-Register (G-06): wiederkehrende Aufgaben der Plugins.
 *
 *     const { Zeitplan } = require('dunebot-sdk');
 *     Zeitplan.eintragen('leveling:saisonwechsel', '5 0 * * *', async ({ anlass }) => { … });
 *
 * Name `plugin:aufgabe`, Takt als Cron-Ausdruck mit fünf Feldern (Europe/Berlin),
 * ein Lauf zur Zeit, Verpasstes wird nach dem Start einmal nachgeholt. Stand
 * unter /admin/zeitplan. Einzelheiten: `apps/dashboard/helpers/Zeitplan.js`.
 *
 * Nur im Dashboard. Im Bot wirft `eintragen`: Braucht der Bot einen Takt, trägt
 * das Dashboard ihn ein und lässt den Bot über IPC ausführen.
 */

function register() {
    const { ServiceManager } = require('dunebot-core');
    return ServiceManager.has('zeitplan') ? ServiceManager.get('zeitplan') : null;
}

/**
 * @param {string} name `plugin:aufgabe`
 * @param {string} takt Cron-Ausdruck, fünf Felder
 * @param {(lauf: {name: string, anlass: 'takt'|'nachgeholt'|'von_hand', start: Date}) => Promise<*>} handler
 * @param {{nachholen?: boolean, frist_min?: number}} [optionen]
 * @returns {{name: string, plugin: string}}
 */
function eintragen(name, takt, handler, optionen) {
    const r = register();
    if (!r) throw new Error(`Zeitplan.eintragen('${name}'): nur im Dashboard, dort läuft der Zeitplan`);
    return r.eintragen(name, takt, handler, optionen);
}

module.exports = { eintragen };
