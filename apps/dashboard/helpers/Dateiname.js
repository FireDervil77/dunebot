'use strict';

/**
 * Hochgeladene Dateinamen richtigstellen.
 *
 * ## Der Befund (2026-09-07)
 *
 * In `music_files` stand `LÃVI - virtual love 2001.mp3`, hochgeladen wurde
 * `LÄVI - ...`. Kein Einzelfall und kein Zufall: **Browser schicken den
 * Dateinamen im mehrteiligen Formular als UTF-8, multer/busboy liest ihn aber
 * als latin1.** Jedes Zeichen ueber ASCII kommt dadurch als zwei falsche an -
 * aus `Ä` (UTF-8: C3 84) wird `Ã` plus ein unsichtbares Steuerzeichen.
 *
 * Das faellt nie auf, solange niemand Umlaute benutzt, und danach ueberall:
 * in der Dateiliste, in der Warteschlange, im Twitch-Chat.
 *
 * ## Warum das hier steht und nicht im Musik-Plugin
 *
 * Es betrifft **jeden** Upload-Weg - `guild/media`, die Musikablage, den
 * Dateimanager des Gameservers. Ein Fix an einer Stelle waere der Anfang von
 * drei verschiedenen Fixen.
 *
 * ## Warum nicht einfach immer umwandeln
 *
 * Weil die Annahme auch falsch sein kann. Liefert eine Bibliothek den Namen
 * schon richtig, macht der Umweg ihn kaputt - aus `Ä` wuerde Muell. Deshalb
 * wird das Ergebnis geprueft und im Zweifel das Original behalten:
 *
 *   - Ist der Name reines ASCII, gibt es nichts zu tun.
 *   - Enthaelt das Ergebnis ein Ersetzungszeichen (U+FFFD), war die Annahme
 *     falsch: Die Bytes ergaben keine gueltige UTF-8-Folge.
 *
 * **Der Fix wirkt nur nach vorn.** Schon gespeicherte Namen bleiben, wie sie
 * sind; sie umzuschreiben ist eine Datenaenderung und gehoert in eine
 * Migration, nicht in einen Helfer.
 *
 * @module helpers/Dateiname
 */

/** Zeichen ueber ASCII - nur dann ist ueberhaupt etwas zu pruefen. */
const UEBER_ASCII = /[-ÿ]/;

/**
 * Einen hochgeladenen Dateinamen richtigstellen.
 *
 * @param {string} roh Der Name, wie multer ihn liefert
 * @returns {string} Der richtiggestellte Name, oder der urspruengliche
 */
function richtigstellen(roh) {
    const name = String(roh || '');
    if (!name || !UEBER_ASCII.test(name)) return name;

    let versuch;
    try {
        versuch = Buffer.from(name, 'latin1').toString('utf8');
    } catch {
        return name;
    }

    // U+FFFD heisst: Die Bytes waren keine gueltige UTF-8-Folge, der Name kam
    // also schon richtig an.
    if (versuch.includes('�')) return name;

    return versuch;
}

module.exports = { richtigstellen };
