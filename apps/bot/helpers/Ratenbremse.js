'use strict';

/**
 * Discords Ratenbremse hoerbar machen.
 *
 * **Warum das ein eigenes Stueck ist.** Bis zum 2026-08-26 hoerte im ganzen
 * Bot niemand auf `rateLimited` — nachgesehen mit einem `grep` ueber
 * `apps/bot/` und `packages/dunebot-sdk/lib/`, kein Treffer. Das faellt
 * deshalb nicht auf, weil eine Bremse **kein Fehler** ist:
 * `@discordjs/rest` wartet die geforderte Zeit still ab, der Aufruf gelingt
 * danach, und niemand erfaehrt, dass 20 Minuten vergangen sind. Ein Auftrag,
 * der so lange braucht, sieht hinterher aus wie einer, der eben lange
 * dauerte — genau die Sackgasse, in der die Ursachensuche zu Baustelle 76
 * stecken blieb.
 *
 * Es liegt als eigene Datei und nicht als Rumpf in `bot.js`, damit ein
 * Pruefskript **dieselbe** Funktion benutzen kann, statt sie nachzubauen. Eine
 * Meldung, die nur im Quelltext geprueft wird, ist keine.
 *
 * @module bot/helpers/Ratenbremse
 */

/**
 * Eine Bremse in eine Protokollzeile uebersetzen.
 *
 * Getrennt vom Anmelden, weil sich nur so pruefen laesst, **was** gemeldet
 * wird — ohne ein Protokoll abzufangen.
 *
 * @param {Object} info Angaben aus `rateLimited` (`RateLimitData`)
 * @returns {{stufe: 'error'|'warn', text: string}} Stufe und Klartext
 */
function alsMeldung(info = {}) {
    const text = `[Discord/Ratenbremse] ${info.method} ${info.route} wartet `
        + `${Math.round(Number(info.retryAfter) || 0)} ms (${info.scope}, `
        + `Eimer ${info.limit}, Bereich ${info.majorParameter})`;

    // `global` heisst nicht "diese Route ist gebremst", sondern "jeder Aufruf
    // dieses Bots steht". Das ist eine andere Lage und gehoert eine Stufe
    // lauter - sonst geht sie zwischen einzelnen gebremsten Routen unter.
    return info.global
        ? { stufe: 'error', text: `${text} — GLOBAL, betrifft jeden Aufruf dieses Bots` }
        : { stufe: 'warn', text };
}

/**
 * Zuhoeren beginnen.
 *
 * @param {Object} rest `client.rest` (ein `REST` aus `@discordjs/rest`)
 * @param {Object} logger Logger mit `warn` und `error`
 * @returns {Function} der angemeldete Zuhoerer - zum Abmelden in Tests
 */
function anmelden(rest, logger) {
    const zuhoerer = (info) => {
        const { stufe, text } = alsMeldung(info);
        logger[stufe](text);
    };

    rest.on('rateLimited', zuhoerer);
    return zuhoerer;
}

module.exports = { anmelden, alsMeldung };
