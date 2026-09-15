'use strict';

/**
 * Zusatz „Streamserver" - die Entscheidungen, ohne Datenbank und ohne Discord.
 *
 * Baustelle 118, Bauplan `docs/streamer-plugin/17-Streamserver.md`. Vorbild ist
 * `entscheidung.js`: Die schwierigen Faelle - ein Streamer kommt zurueck, die
 * Spielerzahl ist unbekannt, der Server steht schon - lassen sich an einer
 * laufenden Anlage kaum herstellen. Hier dauern sie Millisekunden
 * (`scripts/check-streaming-serverstopp.js`).
 *
 * **Die Reihenfolge der Abbrueche ist die Sicherheit.** Gestoppt wird nur, wenn
 * JEDE Pruefung durchkommt, und nur im Modus `stoppen` - ein unbekannter Modus
 * meldet bloss. `spieler === null` heisst unbekannt und ist nie "leer".
 *
 * @module streaming/kern/serverstoppEntscheidung
 */

const MODI = ['melden', 'stoppen'];

/** Mehr als die Karenz (Vorgabe 2 Minuten), sonst stuende der Stopp vor dem Aufraeumen. */
const NACHLAUF_MIN = 3;
const NACHLAUF_MAX = 240;
const NACHLAUF_VORGABE = 15;

/**
 * Soll nach einem Streamende ein Stopp vorgemerkt werden?
 *
 * **Abgeschaltet wird nur, was waehrend des Streams lief.** Ist der Server beim
 * Streamende aus, gibt es nichts zu stoppen - und ohne diese Regel stuende ein
 * Auftrag bereit, der einen danach von Hand gestarteten Server (Vorbereitung,
 * niemand streamt) beim Faelligwerden abschaltet. Dazu gehoert
 * `startBeimVormerken` in `beimFaelligwerden`.
 *
 * @param {Object|null} einstellung { aktiv }
 * @param {number} liveInAuswahl Ausgewaehlte Streamer, die jetzt noch live sind
 * @param {Object} [lage]
 * @param {boolean} [lage.anbieterDa] Ist ein Anbieter eingetragen?
 * @param {Object|null} [lage.server] { status } vom Anbieter
 * @returns {{vormerken: boolean, grund: string}}
 */
function beimStreamende(einstellung, liveInAuswahl, { anbieterDa, server } = {}) {
    if (!einstellung || !Number(einstellung.aktiv)) return { vormerken: false, grund: 'aus' };
    if (Number(liveInAuswahl) > 0) return { vormerken: false, grund: 'noch_live' };
    if (!anbieterDa) return { vormerken: false, grund: 'kein_anbieter' };
    if (!server) return { vormerken: false, grund: 'server_fehlt' };
    if (server.status !== 'online') return { vormerken: false, grund: 'nicht_online' };
    return { vormerken: true, grund: 'letzter_offline' };
}

/**
 * Ein Startzeitpunkt als Zahl, damit `Date`, ISO-Text und Millisekunden
 * gleich verglichen werden. Unlesbares wird `null`.
 *
 * @param {Date|string|number|null|undefined} wert
 * @returns {number|null}
 */
function zeitpunkt(wert) {
    if (wert === null || wert === undefined || wert === '') return null;
    const ms = typeof wert === 'number' ? wert : new Date(wert).getTime();
    return Number.isFinite(ms) ? ms : null;
}

/** @param {string} grund @returns {{handlung: string, grund: string}} */
const abbruch = (grund) => ({ handlung: 'abbrechen', grund });

/**
 * Beim Faelligwerden: stoppen, nur melden oder abbrechen?
 *
 * @param {Object} lage
 * @param {boolean} lage.anbieterDa Ist ein Anbieter eingetragen?
 * @param {Object|null} lage.einstellung { aktiv, modus }
 * @param {number} lage.liveInAuswahl Ausgewaehlte Streamer, die live sind
 * @param {Object|null} lage.server { status, spieler, gestartet_am } vom Anbieter
 * @param {*} [lage.startBeimVormerken] `gestartet_am` des Servers beim Streamende.
 *        Weicht der Wert jetzt ab, wurde der Server dazwischen gestartet - von
 *        Hand, per Cronjob oder nach einem Absturz - und er bleibt an.
 *        `undefined` heisst: nicht erfasst (Auftrag von vor dieser Regel).
 * @returns {{handlung: 'stoppen'|'wuerde_stoppen'|'abbrechen', grund: string}}
 */
function beimFaelligwerden({ anbieterDa, einstellung, liveInAuswahl, server, startBeimVormerken } = {}) {
    if (!anbieterDa) return abbruch('kein_anbieter');
    if (!einstellung || !Number(einstellung.aktiv)) return abbruch('aus');
    if (Number(liveInAuswahl) > 0) return abbruch('wieder_live');
    if (!server) return abbruch('server_fehlt');
    if (server.status !== 'online') return abbruch('nicht_online');
    if (startBeimVormerken !== undefined
        && zeitpunkt(server.gestartet_am) !== zeitpunkt(startBeimVormerken)) {
        return abbruch('neu_gestartet');
    }

    if (server.spieler === null || server.spieler === undefined || server.spieler === '') {
        return abbruch('spieler_unbekannt');
    }
    const spieler = Number(server.spieler);
    if (!Number.isInteger(spieler) || spieler < 0) return abbruch('spieler_unbekannt');
    if (spieler > 0) return abbruch('spieler_da');

    return einstellung.modus === 'stoppen'
        ? { handlung: 'stoppen', grund: 'leer_und_offline' }
        : { handlung: 'wuerde_stoppen', grund: 'leer_und_offline' };
}

/**
 * Formular pruefen. **Unbekanntes wird abgelehnt, nicht still entfernt** - ein
 * Streamer, der beim Speichern wegfaellt, faellt sonst erst auf, wenn der
 * Server nicht stoppt.
 *
 * @param {Object} roh req.body
 * @param {Array<number>} erlaubteStreamer Kennungen, die auswaehlbar sind
 * @returns {{ok: boolean, fehler?: string, werte?: {aktiv: boolean, modus: string, nachlaufMin: number, streamerIds: number[]}}}
 */
function eingabePruefen(roh = {}, erlaubteStreamer = []) {
    const aktiv = ['1', 'on', 'true', true, 1].includes(roh.aktiv);

    const modus = String(roh.modus || '');
    if (!MODI.includes(modus)) return { ok: false, fehler: 'modus' };

    const nachlaufMin = Number(roh.nachlauf_min);
    if (!Number.isInteger(nachlaufMin) || nachlaufMin < NACHLAUF_MIN || nachlaufMin > NACHLAUF_MAX) {
        return { ok: false, fehler: 'nachlauf' };
    }

    const erlaubt = new Set((erlaubteStreamer || []).map(Number));
    const liste = roh.streamer === undefined ? [] : [].concat(roh.streamer);
    const streamerIds = [];
    for (const wert of liste) {
        const id = Number(wert);
        if (!Number.isInteger(id) || !erlaubt.has(id)) return { ok: false, fehler: 'streamer' };
        if (!streamerIds.includes(id)) streamerIds.push(id);
    }

    if (aktiv && !streamerIds.length) return { ok: false, fehler: 'leer' };

    return { ok: true, werte: { aktiv, modus, nachlaufMin, streamerIds } };
}

/** Klartext je Grund - fuer Protokoll, Seite und Discord. */
const GRUENDE = {
    kein_anbieter: 'das Gameserver-Plugin ist nicht aktiv',
    aus: 'der Zusatz ist ausgeschaltet',
    wieder_live: 'ein ausgewählter Streamer ist wieder live',
    server_fehlt: 'den Server gibt es nicht mehr',
    nicht_online: 'der Server läuft nicht',
    neu_gestartet: 'der Server wurde nach dem Streamende neu gestartet',
    spieler_unbekannt: 'die Spielerzahl ist unbekannt',
    spieler_da: 'es ist noch jemand auf dem Server',
    leer_und_offline: 'niemand live, niemand auf dem Server'
};

/**
 * @param {string} grund Kennung
 * @returns {string} Klartext
 */
function grundKlartext(grund) {
    return GRUENDE[grund] || String(grund || 'unbekannter Grund');
}

/** Markdown-Zeichen aus Namen nehmen - ein Servername ist keine Formatierung. */
const ohneMarkdown = (text) => String(text || '').replace(/[*_`~|>]/g, '');

/**
 * Die Nachricht im Ankuendigungskanal (nur im Modus `stoppen`).
 *
 * @param {Object} nutzlast { art: 'angekuendigt'|'abgebrochen'|'gestoppt', server_name, nachlauf_min, grund, login }
 * @returns {string} Nachricht
 */
function hinweisText(nutzlast = {}) {
    const server = `**${ohneMarkdown(nutzlast.server_name) || 'Der Server'}**`;

    if (nutzlast.art === 'angekuendigt') {
        return `🎮 ${server} wird in ${Number(nutzlast.nachlauf_min) || NACHLAUF_VORGABE} Minuten gestoppt — `
             + 'der letzte Streamer ist offline. Geht jemand wieder live oder ist noch jemand '
             + 'auf dem Server, bleibt er an.';
    }
    if (nutzlast.art === 'gestoppt') {
        return `🎮 ${server} wird jetzt gestoppt.`;
    }

    const grund = nutzlast.grund === 'wieder_live' && nutzlast.login
        ? `${ohneMarkdown(nutzlast.login)} ist wieder live`
        : grundKlartext(nutzlast.grund);
    return `🎮 Der Stopp von ${server} ist abgebrochen — ${grund}.`;
}

module.exports = {
    MODI, NACHLAUF_MIN, NACHLAUF_MAX, NACHLAUF_VORGABE,
    beimStreamende, beimFaelligwerden, eingabePruefen, grundKlartext, hinweisText, zeitpunkt
};
