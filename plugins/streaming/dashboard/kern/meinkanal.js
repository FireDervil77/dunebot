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
 * Ohne diesen Scope kann der Bot nicht unter dem Namen des Streamers schreiben.
 *
 * **Er gehoert IHM, nicht der Anlage** - das ist der Unterschied zu `SCOPE`
 * darueber. Deshalb wird er am Schluessel des Benutzers nachgesehen und nicht
 * an dem des Betreibers.
 */
const SCHREIB_SCOPE = 'user:write:chat';

/**
 * Der Name der Zusage, die diesen Scope erteilt.
 *
 * Steht hier, damit die Chatbot-Seite den Weg dorthin nennen kann, ohne ihn
 * abzuschreiben. Wer ihn in `dashboard/index.js` umbenennt, sieht hier, dass
 * eine zweite Stelle mithaengt (`scripts/check-chatansage.js` misst es).
 */
const SCHREIB_ZUSAGE = 'chatschreiben';

/**
 * Darf der Chatbot unter dem Namen dieses Menschen schreiben? (Stufe 13c)
 *
 * **Am Schluessel nachgesehen, nicht an der Absicht.** Die Spalte `scopes`
 * traegt, was Twitch zuletzt bestaetigt hat - die stuendliche Pflichtpruefung
 * schreibt sie fort. Ein eigenes "hat zugestimmt"-Kaestchen daneben wuerde
 * behaupten, was der Schluessel laengst widerlegt hat.
 *
 * **Dreiwertig wie alles hier**: Wer nicht nachsehen konnte, meldet
 * `'unbekannt'`. Ein falsches `'nein'` schickte den Streamer in einen Dialog,
 * den er schon durchlaufen hat.
 *
 * @param {string|null} userId Discord-Benutzer, dem der Kanal gehoert
 * @returns {Promise<{zustand: string, grund: string|null}>} Auskunft
 */
async function darfSchreiben(userId) {
    if (!userId) return { zustand: 'nein', grund: 'Zu diesem Kanal ist kein Konto verknuepft.' };

    let zusage;
    try {
        zusage = await Verbindungsspeicher.zusageLesen(userId, 'twitch');
    } catch (err) {
        return { zustand: 'unbekannt', grund: `Die Berechtigungen sind gerade nicht lesbar (${err.message}).` };
    }

    if (!zusage) return { zustand: 'nein', grund: null };

    const scopes = String(zusage.scopes || '').split(' ').filter(Boolean);
    return { zustand: scopes.includes(SCHREIB_SCOPE) ? 'ja' : 'nein', grund: null };
}

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
 * Schreibt der Chatbot unter deinem Namen - und darf er es? (Stufe 13c)
 *
 * **Diese Zeile ist eine Zusage, keine Auskunft.** 17.5 verlangt, dass es
 * dasteht: *Der Chatbot schreibt unter deinem Namen.* Sie erscheint deshalb
 * auch dann, wenn nichts eingeschaltet ist - gerade dann. Wer erst nach dem
 * Erlauben erfaehrt, was er erlaubt hat, hat nichts erfahren.
 *
 * @param {Object} streamer Zeile aus `streaming_streamers`, oder null
 * @param {string|null} userId Discord-Benutzer
 * @returns {Promise<Object|null>} Zeile fuer den Profil-Abschnitt
 */
async function schreibZeile(streamer, userId) {
    if (!streamer) return null;

    const darf = await darfSchreiben(userId);
    const an = Number(streamer.chat_ansage_an) === 1;

    if (darf.zustand === 'unbekannt') {
        return {
            label: 'Chatbot schreibt unter meinem Namen',
            zustand: 'unbekannt',
            text: 'Laesst sich gerade nicht feststellen.',
            hinweis: darf.grund
        };
    }

    if (darf.zustand !== 'ja') {
        return {
            label: 'Chatbot schreibt unter meinem Namen',
            zustand: 'nein',
            text: 'Noch nicht erlaubt. Der Bot sagt in deinem Chat nichts.',
            // Der Weg dorthin steht direkt darueber auf derselben Seite - ein
            // Link waere ein Umweg zu sich selbst.
            hinweis: darf.grund
                || 'Unter „Berechtigungen" kannst du es erlauben. Alles, was der Bot '
                 + 'dann sagt, erscheint unter deinem Namen — nicht unter einem Botnamen.'
        };
    }

    return {
        label: 'Chatbot schreibt unter meinem Namen',
        zustand: 'ja',
        text: an
            ? 'Erlaubt, und die Live-Ansage ist eingeschaltet.'
            : 'Erlaubt. Eingeschaltet ist zurzeit nichts.',
        hinweis: 'Zurueckziehen kannst du das jederzeit mit „Berechtigungen zuruecknehmen" — '
               + 'der Bot schweigt dann sofort.'
    };
}

/**
 * Der ganze Abschnitt: Mod-Status, Heim-Guild und die Stimme.
 *
 * @param {Object} ctx `{ userId, kontoId, kontoName }`
 * @returns {Promise<Array<Object>>} Zeilen
 */
async function zeilen(ctx) {
    const teile = await modZeile(ctx);
    const streamer = await heimguild.streamerZuKonto('twitch', ctx?.kontoId);
    const heim = await heimZeile(streamer);
    const stimme = await schreibZeile(streamer, ctx?.userId);

    return [...teile, heim, stimme].filter(Boolean);
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

module.exports = {
    modZeile, zeilen, heimZeile, schreibZeile, darfSchreiben, wahl,
    SCOPE, SCHREIB_SCOPE, SCHREIB_ZUSAGE
};
