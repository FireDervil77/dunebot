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
 * **Zwei Zeilen und eine Wahl** (Stufe 14, 2026-08-29).
 *
 * Die Zeilen sind Auskunft: Steht der Bot in deinem Chat, und wo wird er
 * verwaltet. Die Wahl ist eine Entscheidung: in welcher Guild.
 *
 * 13a hatte hier bewusst **keinen** Schalter - er schloss an und hoerte zu,
 * der Bot sagte noch nichts, und ein Schalter "Begruessung an/aus" waere
 * vorhanden und wirkungslos gewesen. Die Wahl kommt jetzt, weil sie etwas tut:
 * Sie schaltet in der gewaehlten Guild einen Menuepunkt frei. Sie kommt also
 * mit ihrer Faehigkeit, nicht davor - dieselbe Regel wie damals, nur mit
 * anderem Ausgang.
 *
 * @module streaming/kern/meinkanal
 */

const { ServiceManager } = require('dunebot-core');
const Verbindungsspeicher = require('../../../../apps/dashboard/helpers/Verbindungsspeicher');
const twitch = require('../plattformen/twitch');
const heimguild = require('./heimguild');

/** @returns {Object} Datenbankdienst */
const db = () => ServiceManager.get('dbService');

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

/**
 * Wo wird der Chatbot dieses Kanals verwaltet?
 *
 * **Eine Auskunft, kein Versprechen.** Steht keine Heim-Guild, sagt die Zeile
 * genau das - und nicht etwa, der Chatbot sei "aus". Aus waere eine Aussage
 * ueber eine Faehigkeit; hier geht es um einen Ort, den noch niemand gewaehlt
 * hat.
 *
 * @param {Object} streamer Zeile aus `streaming_streamers`, oder null
 * @returns {Promise<Object|null>} Zeile fuer den Profil-Abschnitt
 */
async function heimZeile(streamer) {
    if (!streamer) return null;

    if (!streamer.heim_guild_id) {
        return {
            label: 'Chatbot verwaltet in',
            zustand: 'nein',
            text: 'Noch nirgends. Waehle unten einen Server — nur dort erscheint der '
                + 'Chatbot-Bereich, und nur dort koennen seine Einstellungen bedient werden.'
        };
    }

    const zeilen = await db().query(
        'SELECT guild_name FROM guilds WHERE _id = ? LIMIT 1', [streamer.heim_guild_id]);
    return {
        label: 'Chatbot verwaltet in',
        zustand: 'ja',
        // Findet sich der Name nicht, steht die Kennung da. Das ist haesslich
        // und ehrlich - besser als ein erfundener Name oder ein leeres Feld.
        text: zeilen[0]?.guild_name || String(streamer.heim_guild_id)
    };
}

/**
 * Der ganze Abschnitt: Mod-Status und Heim-Guild.
 *
 * @param {Object} ctx `{ userId, kontoId, kontoName }`
 * @returns {Promise<Array<Object>>} Zeilen
 */
async function zeilen(ctx) {
    const teile = await modZeile(ctx);
    const streamer = await heimguild.streamerZuKonto('twitch', ctx?.kontoId);
    const heim = await heimZeile(streamer);
    return heim ? [...teile, heim] : teile;
}

/**
 * Die Auswahl "wo wird mein Chatbot verwaltet".
 *
 * **`moeglich` und `setzen` fragen beide neu nach dem Streamer.** Zwischen dem
 * Aufbau der Seite und dem Klick koennen Minuten liegen; wer die Liste von
 * damals gegen die Wahl von heute prueft, prueft gegen einen alten Stand.
 */
const wahl = {
    name: 'heim_guild',
    label: 'Chatbot verwalten in',
    leerText: '— nirgends, Chatbot aus —',
    hinweis: 'Nur auf diesem Server erscheint der Chatbot-Bereich. Zur Auswahl stehen '
           + 'Server, die deinen Kanal verfolgen und auf denen das Streaming-Plugin laeuft.',

    /**
     * @param {Object} ctx `{ userId, kontoId }`
     * @returns {Promise<Array<Object>>} Optionen
     */
    async moeglich(ctx) {
        const streamer = await heimguild.streamerZuKonto('twitch', ctx?.kontoId);
        if (!streamer) return [];
        const guilds = await heimguild.moeglicheGuilds(streamer);
        return guilds.map(g => ({
            wert: String(g.guild_id),
            text: `${g.name} (${g.ziele} Ziel${Number(g.ziele) === 1 ? '' : 'e'})`,
            aktiv: String(g.guild_id) === String(streamer.heim_guild_id || '')
        }));
    },

    /**
     * @param {Object} ctx `{ userId, kontoId }`
     * @param {string} wert Guild-ID oder leer
     * @returns {Promise<{ok: boolean, grund?: string}>} Ergebnis
     */
    async setzen(ctx, wert) {
        const streamer = await heimguild.streamerZuKonto('twitch', ctx?.kontoId);
        return await heimguild.setzen(ctx?.userId, streamer, wert);
    }
};

module.exports = { modZeile, zeilen, heimZeile, wahl, SCOPE };
