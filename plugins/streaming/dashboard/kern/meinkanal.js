'use strict';

/**
 * "Mein Kanal" - was der Streamer ueber seinen eigenen Twitch-Kanal erfaehrt.
 *
 * Angemeldet als `einstellungen` am Anbieter `twitch` (Stufe 13a, 2026-08-28).
 * Der Abschnitt erscheint im Profil, nicht im Plugin-Menue: Chat-Einstellungen
 * gehoeren dem Kanalinhaber (F-18), und im Profil ist die Tuer der Nachweis
 * selbst - den kann keine Serverleitung vergeben oder entziehen. Die
 * Begruendung im Langen steht im Kopf von `VerbindungsRegistry`.
 *
 * **Heute steht hier genau eine Zeile, und sie ist eine Auskunft, kein
 * Schalter.** 13a schliesst an und hoert zu; der Bot sagt noch nichts. Ein
 * Schalter "Begruessung an/aus" waere an dieser Stelle vorhanden und
 * wirkungslos - genau das Muster, das dieses Projekt an anderen bemaengelt. Er
 * kommt mit 13c, zusammen mit der Stimme.
 *
 * @module streaming/kern/meinkanal
 */

const Verbindungsspeicher = require('../../../../apps/dashboard/helpers/Verbindungsspeicher');
const twitch = require('../plattformen/twitch');

/** Ohne diesen Scope kann das Bot-Konto seine eigene Moderatorenrolle nicht abfragen. */
const SCOPE = 'user:read:moderated_channels';

/**
 * Eine Zeile "unbekannt" bauen.
 *
 * **Warum es diese Abkuerzung gibt:** Alle Abbruchgruende dieser Datei enden
 * hier, und keiner endet bei `'nein'`. Wer nicht fragen konnte, weiss es nicht
 * - und ein Streamer, dem die Seite faelschlich "der Bot ist nicht in deinem
 * Chat" sagt, sucht den Fehler bei sich und tippt `/mod` ein zweites Mal.
 *
 * @param {string} grund Was gerade nicht ging, in seiner Sprache
 * @returns {Array<Object>} eine Zeile
 */
function unbekannt(grund) {
    return [{
        label: 'Bot in meinem Chat',
        zustand: 'unbekannt',
        text: 'Laesst sich gerade nicht feststellen.',
        hinweis: grund,
        tat: null
    }];
}

/**
 * Steht unser Bot-Konto als Moderator im Kanal dieses Benutzers?
 *
 * Gefragt wird mit dem Schluessel der **Anlage**, nicht dem des Streamers -
 * siehe `twitch.moderierteKanaele`. Der Streamer erteilt dafuer nichts.
 *
 * @param {Object} ctx `{ userId, kontoId, kontoName }` aus dem Nachweis
 * @returns {Promise<Array<Object>>} Zeilen fuer den Profil-Abschnitt
 */
async function modZeile({ kontoId } = {}) {
    if (!kontoId) return [];

    const zusage = await Verbindungsspeicher.betreiberZusageLesen('twitch', 'chatbot');
    if (!zusage) {
        // Kein Vorwurf an den Streamer, und keine Handlungsanweisung an ihn:
        // Das liegt beim Betreiber, und er sieht es unter /admin.
        return unbekannt('Das Bot-Konto der Anlage ist noch nicht zugelassen.');
    }

    // **Am Schluessel nachsehen, nicht an der Absicht.** Die Spalte `scopes`
    // traegt, was Twitch zuletzt bestaetigt hat (seit ce64ed0 wird sie nicht
    // mehr verschmolzen). Steht der Scope nicht drin, wuerde der Abruf mit 401
    // enden - dann lieber gleich sagen, woran es liegt.
    const scopes = String(zusage.scopes || '').split(' ').filter(Boolean);
    if (!scopes.includes(SCOPE)) {
        return unbekannt('Dem Bot-Konto fehlt die Berechtigung, seine Moderatorenrolle abzufragen.');
    }

    const ergebnis = await Verbindungsspeicher.mitBetreiberZugang(
        { plattform: 'twitch', zweck: 'chatbot' },
        (zugang) => twitch.moderierteKanaele(zusage.konto_id, zugang));

    if (!ergebnis) return unbekannt('Das Bot-Konto der Anlage ist noch nicht zugelassen.');
    if (ergebnis.abgelehnt) return unbekannt('Der Schluessel des Bot-Kontos wird von Twitch abgelehnt.');
    if (!ergebnis.ok) return unbekannt('Twitch hat auf die Anfrage nicht geantwortet.');

    const botName = zusage.konto_name || null;
    const drin = (ergebnis.kanaele || []).some(k => String(k.kontoId) === String(kontoId));

    if (drin) {
        return [{
            label: 'Bot in meinem Chat',
            zustand: 'ja',
            text: botName
                ? `${botName} ist Moderator in deinem Kanal.`
                : 'Das Bot-Konto ist Moderator in deinem Kanal.',
            hinweis: null,
            tat: null
        }];
    }

    return [{
        label: 'Bot in meinem Chat',
        zustand: 'nein',
        text: botName
            ? `${botName} ist noch kein Moderator in deinem Kanal.`
            : 'Das Bot-Konto ist noch kein Moderator in deinem Kanal.',
        // **Das entscheidet der Kanalinhaber, nicht wir.** Twitch verlangt fuer
        // `channel.chat.message` entweder Moderatorenstatus oder `channel:bot`
        // vom Streamer. Beides kann nur er geben - deshalb steht hier der
        // Befehl und keine Schaltflaeche, die es fuer ihn zu tun verspricht.
        hinweis: 'Ohne Moderatorenstatus darf der Bot in deinem Chat weder mitlesen noch etwas sagen.',
        tat: botName ? `/mod ${botName}` : null
    }];
}

module.exports = { modZeile, SCOPE };
