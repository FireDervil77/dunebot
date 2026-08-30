'use strict';

/**
 * Streaming - wie die Live-Ansage im Twitch-Chat aussieht (Stufe 13c).
 *
 * Reine Funktionen: Werte herein, fertiger Text heraus. Kein Datenbankzugriff,
 * kein Versand - wie `nachricht.js`, und aus demselben Grund: So laesst sich
 * jeder Fall durchspielen, ohne eine Anlage zu betreiben
 * (`scripts/check-chatansage.js`).
 *
 * ## Warum eine eigene Datei und nicht eine Funktion in `nachricht.js`
 *
 * Dort entstehen **Discord-Nutzlasten**: Embeds, Farben, Knoepfe,
 * Erwaehnungen. Hier entsteht **eine Zeile Text**, die eine fremde Plattform
 * mit eigenen Grenzen annimmt. Die beiden teilen sich das Fuellen der
 * Platzhalter und sonst nichts.
 *
 * ## Der Unterschied, der alles bestimmt: eine Chatnachricht ist endgueltig
 *
 * Eine Discord-Ankuendigung wird nachgezogen, sobald die Anreicherung Titel
 * und Kategorie liefert - `streaming_messages` merkt sich dafuer die Kennung.
 * Im Twitch-Chat gibt es das nicht: Was gesagt ist, ist gesagt. Daraus folgen
 * zwei Dinge, die unten stehen und nirgends sonst:
 *
 *   1. Der Auftrag wartet, bis die Angaben da sind (siehe `takt.js`).
 *   2. Bleiben sie trotzdem leer, wird der Satz **aufgeraeumt** statt mit
 *      Luecken gesendet - `saubern()`.
 *
 * @module streaming/dashboard/ausgabe/chatansage
 */

const { parsePlaceholders } = require('dunebot-core/lib/PlaceholderParser');
const { VORGABE_CHAT, CHAT_MAX } = require('../../shared/vorlagen');

/**
 * Adresse des Kanals bei der Plattform.
 *
 * **Bewusst noch einmal hier und nicht aus `nachricht.js` geholt.** Die
 * Funktion dort ist nicht nach aussen gegeben, und sie zu oeffnen hiesse, die
 * Discord-Ausgabe zur Bibliothek der Chat-Ausgabe zu machen. Drei Zeilen
 * doppelt sind billiger als diese Abhaengigkeit.
 *
 * @param {string} plattform Plattform
 * @param {string} login Kanalname
 * @returns {string} Adresse
 */
function kanalAdresse(plattform, login) {
    switch (plattform) {
        case 'kick':    return `https://kick.com/${login}`;
        case 'youtube': return `https://youtube.com/@${login}`;
        default:        return `https://twitch.tv/${login}`;
    }
}

/**
 * Einen Satz aufraeumen, aus dem ein Platzhalter leer herausgefallen ist.
 *
 * **Warum das noetig ist.** `'Wir sind live! {titel}'` wird ohne Titel zu
 * `'Wir sind live! '`, und `'Live — {titel} ({kategorie})'` zu
 * `'Live —  ()'`. Das erste ist harmlos, das zweite sieht nach einem kaputten
 * Bot aus - und es steht unter dem **Namen des Streamers**.
 *
 * Aufgeraeumt wird nur, was sichtbar uebrig blieb:
 *
 *   - leere Klammern und Klammern mit nichts als Trennern darin
 *   - doppelte Leerzeichen
 *   - Trennzeichen am Ende (— – - : | ,) und am Anfang
 *
 * **Es wird nichts erfunden und nichts umformuliert.** Wer mehr will, schreibt
 * einen Satz, der auch ohne Titel traegt; wir raten nicht, was er gemeint hat.
 *
 * @param {string} text Gefuellter Text
 * @returns {string} aufgeraeumter Text
 */
function saubern(text) {
    return String(text || '')
        .replace(/\(\s*[-–—:|,]*\s*\)/g, '')   // "()" und "( — )"
        .replace(/\[\s*[-–—:|,]*\s*\]/g, '')
        .replace(/\s{2,}/g, ' ')
        .replace(/\s+([,.!?])/g, '$1')          // " ." nach weggefallenem Wort
        .replace(/[\s]*[-–—:|,]+[\s]*$/g, '')
        .replace(/^[\s]*[-–—:|,]+[\s]*/g, '')
        .trim();
}

/**
 * Die Ansage beim Streamstart.
 *
 * @param {Object} daten Alles, was gebraucht wird
 * @param {Object} daten.streamer { plattform, login, anzeigename }
 * @param {Object} [daten.zustand] { titel, kategorie }
 * @param {string} [daten.vorlage] Reintext mit Platzhaltern; leer = Vorgabe
 * @returns {string} die fertige Zeile, hoechstens `CHAT_MAX` Zeichen
 */
function ansage({ streamer, zustand = {}, vorlage = null }) {
    const name = streamer.anzeigename || streamer.login;

    const gefuellt = parsePlaceholders(
        String(vorlage || '').trim() || VORGABE_CHAT,
        {
            extra: {
                streamer: name,
                titel: zustand.titel || '',
                kategorie: zustand.kategorie || '',
                url: kanalAdresse(streamer.plattform, streamer.login),
                plattform: streamer.plattform === 'twitch' ? 'Twitch'
                         : streamer.plattform === 'kick' ? 'Kick' : 'YouTube'
            }
        });

    // **Gekuerzt wird hier und nicht erst bei Twitch.** Die Vorlage ist auf
    // 500 Zeichen geprueft, die gefuellten Platzhalter koennen sie aber
    // sprengen - ein langer Streamtitel genuegt. Twitch wiese die Nachricht
    // dann ganz ab; eine gekuerzte Ansage ist besser als gar keine.
    return saubern(gefuellt).slice(0, CHAT_MAX);
}

/**
 * Braucht dieser Text Angaben, die erst die Anreicherung liefert?
 *
 * Der `takt` entscheidet damit, ob die Ansage sofort hinausgeht oder kurz
 * wartet. **Gefragt wird die Vorlage, nicht der Zustand**: Wer
 * `'Wir sind live!'` schreibt, soll nicht auf einen Titel warten, den sein
 * Satz gar nicht nennt.
 *
 * @param {string|null} vorlage Reintext mit Platzhaltern; leer = Vorgabe
 * @returns {boolean} true, wenn Titel oder Kategorie vorkommen
 */
function brauchtAnreicherung(vorlage) {
    const t = String(vorlage || '').trim() || VORGABE_CHAT;
    return /\{titel\}|\{kategorie\}/i.test(t);
}

module.exports = { ansage, saubern, brauchtAnreicherung, kanalAdresse };
