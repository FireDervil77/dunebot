'use strict';

/**
 * Discord-Kanaltypen als schlichte Zahlen.
 *
 * Warum hier und nicht aus `discord.js`: Das Dashboard braucht dieselben Werte
 * wie der Bot, soll dafür aber nicht `discord.js` laden. Die Zahlen sind Teil
 * der Discord-API und liegen fest — sie ändern sich nicht, es kommen höchstens
 * neue dazu.
 *
 * Angelegt am 2026-08-09, als auffiel, dass `GET_GUILD_CHANNELS` fest auf
 * `type === 0` (Textkanäle) stand und sich deshalb ein Sprachkanal nicht von
 * AutoMod ausnehmen liess — obwohl dessen Chat sehr wohl überwacht wird.
 *
 * @see apps/bot/ipc/GET_GUILD_CHANNELS.js
 */

/** Einzelne Typen, benannt wie in der Discord-API. */
const KANAL = {
    TEXT: 0,
    DM: 1,
    VOICE: 2,
    GRUPPEN_DM: 3,
    KATEGORIE: 4,
    ANKUENDIGUNG: 5,
    ANKUENDIGUNGS_THREAD: 10,
    OEFFENTLICHER_THREAD: 11,
    PRIVATER_THREAD: 12,
    BUEHNE: 13,
    VERZEICHNIS: 14,
    FORUM: 15,
    MEDIEN: 16
};

/**
 * Alles, worin Nachrichten entstehen — also alles, was AutoMod überwacht und
 * was sich folglich auch ausnehmen lassen muss.
 *
 * Foren und Medienkanäle stehen mit drin: sie selbst tragen keine Nachrichten,
 * aber ihre Beiträge sind Threads unter ihnen. Wer das Forum ausnimmt, meint
 * dessen Beiträge.
 *
 * Threads fehlen bewusst. Sie kommen und gehen; eine Auswahlliste voller
 * Threads wäre unbrauchbar. Stattdessen prüft die Moderation zusätzlich den
 * Elternkanal — wer den ausnimmt, nimmt seine Threads mit aus.
 */
const MODERIERBARE_TYPEN = [
    KANAL.TEXT,
    KANAL.VOICE,
    KANAL.ANKUENDIGUNG,
    KANAL.BUEHNE,
    KANAL.FORUM,
    KANAL.MEDIEN
];

/**
 * Kanäle, in die der Bot schreiben kann — für Zielfelder wie den Log-Kanal.
 *
 * Bühnenkanäle fehlen: dort schreibt niemand hin. Foren und Medienkanäle
 * ebenfalls, dort müsste man einen Beitrag eröffnen statt zu schreiben.
 */
const BESCHREIBBARE_TYPEN = [
    KANAL.TEXT,
    KANAL.VOICE,
    KANAL.ANKUENDIGUNG
];

/** Sprechende Kurznamen für die Oberfläche (Symbol- und Gruppenwahl). */
const TYP_NAMEN = {
    [KANAL.TEXT]: 'text',
    [KANAL.VOICE]: 'voice',
    [KANAL.ANKUENDIGUNG]: 'announcement',
    [KANAL.BUEHNE]: 'stage',
    [KANAL.FORUM]: 'forum',
    [KANAL.MEDIEN]: 'media'
};

module.exports = { KANAL, MODERIERBARE_TYPEN, BESCHREIBBARE_TYPEN, TYP_NAMEN };
