'use strict';

/**
 * Die Statistik-Seite (P7) - was Twitch fuehrt und dem Kanalinhaber gibt.
 *
 * ## Die Linie, die traegt
 *
 * Nicht zwischen Zahl und Name, sondern zwischen zwei Herkuenften:
 *
 *   Was Twitch fuehrt      Follower, Abonnenten, Bits-Rangliste. Twitch hat den
 *                          Zweck und die Beziehung zum Zuschauer, wir sind das
 *                          Fenster.
 *   Was erst durch UNSER   wie oft jemand da war, wer wie viel geschrieben hat,
 *   Mitschreiben entstuende  Watch Streaks. Das fuehrt Twitch nicht.
 *
 * Diese Datei holt ausschliesslich das Erste.
 *
 * ## Per Request, keine Kopie
 *
 * Entschieden vom Betreiber am 2026-09-03: „die Frage nach den Daten wuerde ich
 * per Request machen, also dann wenn man sie braucht."
 *
 * **Hier wird deshalb nichts gespeichert.** Kein `INSERT`, kein `UPDATE`, kein
 * Zwischenspeicher. Das kostet Kontingent und Wartezeit bei jedem Aufruf und
 * spart die Frage, wie lange etwas bei uns liegt - fuer eine Seite, die man
 * nach dem Stream aufschlaegt, ist das der richtige Tausch.
 *
 * ⚠ **Die Abonnentenliste in `streaming_subscribers` bleibt davon unberuehrt.**
 * Dort ist die Kopie kein Zwischenspeicher aus Bequemlichkeit, sondern die
 * Grundlage des Rollenabgleichs - ein verlorenes `channel.subscription.end`
 * fiele sonst nie auf, und die Rolle bliebe fuer immer. Diese Seite liest sie
 * nicht; sie fragt Twitch frisch.
 *
 * ## Jede Quelle antwortet fuer sich
 *
 * Drei Abfragen, drei Zusagen, drei Arten zu scheitern. Ein gemeinsames
 * „hat nicht geklappt" waere die halbe Auskunft: Der Streamer saehe nicht, dass
 * seine Follower da sind und nur die Bits fehlen, weil er `bits:read` nie
 * erteilt hat.
 *
 * @module streaming/kern/statistik
 */

const { ServiceManager } = require('dunebot-core');

/**
 * Datenbankdienst - **zum Lesen, nie zum Schreiben.**
 *
 * Ein frueherer Entwurf dieser Datei hatte gar keinen Zugang, mit dem Hinweis,
 * die Zusage stehe damit „in der Bauform". Das war zu weit gefasst: „Keine
 * Kopie" heisst, nichts von Twitch bei uns abzulegen - nicht, unsere eigene
 * Zustandszeile nicht lesen zu duerfen. `streaming_state` fuehren wir ohnehin,
 * fuer die Live-Ansage; sie hier zu lesen legt nichts Neues an.
 *
 * Die Zusage wird deshalb dort geprueft, wo sie messbar ist:
 * `scripts/check-streaming-statistik.js` faellt, sobald in dieser Datei ein
 * `INSERT` oder `UPDATE` steht.
 *
 * @returns {Object} Datenbankdienst
 */
function db() {
    return ServiceManager.get('dbService');
}

/** @returns {Object} Protokoll */
function log() {
    return ServiceManager.get('Logger');
}

/**
 * Ein Zustand je Quelle - und was er dem Streamer sagt.
 *
 * `abgelehnt` ist ausdruecklich NICHT `fehler`: Es heisst, dass die Zusage
 * fehlt oder widerrufen wurde, und das ist eine Entscheidung des Streamers,
 * keine Stoerung (17.5, Punkt 3).
 */
const ZUSTAND = {
    OK:         'ok',
    ABGELEHNT:  'abgelehnt',
    FEHLER:     'fehler',
    KEIN_KANAL: 'kein_kanal'
};

/**
 * Alles holen, was die Seite zeigt.
 *
 * **Die drei Abfragen laufen nebeneinander.** Nacheinander waere die Seite so
 * langsam wie ihre Summe; Twitch zaehlt sie ohnehin einzeln gegen das
 * Kontingent.
 *
 * @param {string} guildId Discord-Guild-ID (die Heim-Guild)
 * @returns {Promise<Object>} Bericht, siehe Modulkopf
 */
async function holen(guildId) {
    const heimguild = require('./heimguild');
    const abonnenten = require('./abonnenten');
    const twitch = require('../plattformen/twitch');
    const Verbindungsspeicher = require('../../../../apps/dashboard/helpers/Verbindungsspeicher');

    const bericht = {
        geholt_am: new Date(),
        kanal:  null,
        letzterStream: null,
        folger: { zustand: ZUSTAND.KEIN_KANAL, gesamt: 0, liste: [] },
        bits:   { zustand: ZUSTAND.KEIN_KANAL, plaetze: [] },
        abos:   { zustand: ZUSTAND.KEIN_KANAL, gesamt: 0, liste: [] }
    };

    const kanaele = await heimguild.kanaeleDerGuild(guildId);
    if (!kanaele.length) return bericht;

    // Heute gibt es genau einen Heim-Kanal je Guild - dieselbe Annahme wie
    // `heimKanalId` im Router, und sie steht dort schon so.
    const kanal = kanaele[0];
    bericht.kanal = {
        id: kanal.id,
        kanal_id: String(kanal.kanal_id),
        login: kanal.login,
        name: kanal.anzeigename || kanal.login
    };

    const inhaber = await abonnenten.kanalInhaber(kanal);
    if (!inhaber) {
        // Kein verknuepftes Konto heisst: Es gibt keinen Schluessel, mit dem
        // wir fragen duerften. Das ist kein Fehler, sondern ein Kanal, der
        // seine Zahlen nicht freigegeben hat.
        for (const teil of ['folger', 'bits', 'abos']) bericht[teil].zustand = ZUSTAND.ABGELEHNT;
        return bericht;
    }

    /**
     * Eine Abfrage mit dem Schluessel des Kanalinhabers.
     *
     * `mitZugang` entschluesselt, erneuert bei 401 und vermerkt einen Widerruf.
     * `null` heisst: gar keine Zusage mehr.
     *
     * @param {Function} tun Was mit dem Schluessel geschehen soll
     * @returns {Promise<Object|null>} Ergebnis oder null
     */
    const mitSchluessel = (tun) => Verbindungsspeicher.mitZugang(
        { userId: inhaber, plattform: 'twitch' }, tun);

    const [folger, bits, abos] = await Promise.all([
        mitSchluessel(z => twitch.folgerLesen(bericht.kanal.kanal_id, z))
            .catch(err => { log().error('[Streaming/Statistik] Follower', err); return null; }),
        mitSchluessel(z => twitch.bitsRanglisteLesen(z))
            .catch(err => { log().error('[Streaming/Statistik] Bits', err); return null; }),
        mitSchluessel(z => twitch.abonnentenLesen(bericht.kanal.kanal_id, z))
            .catch(err => { log().error('[Streaming/Statistik] Abonnenten', err); return null; })
    ]);

    bericht.folger = deuten(folger, e => ({ gesamt: e.gesamt, liste: e.folger }),
        { gesamt: 0, liste: [] });
    bericht.bits = deuten(bits, e => ({ plaetze: e.plaetze }), { plaetze: [] });

    // **Der Kanalinhaber ist hier schon draussen.** `twitch.abonnentenLesen`
    // ueberspringt ihn selbst (`if (String(a.user_id) === String(kanalId))
    // continue;`) - Twitch liefert ihn naemlich in `data` aus, obwohl `total`
    // ihn nicht zaehlt; am 2026-08-26 an `firedervil` gemessen und dort
    // ausfuehrlich vermerkt.
    //
    // Ihn hier ein zweites Mal herauszufiltern waere eine zweite Wahrheit ueber
    // dieselbe Sache: Wer den Filter dort spaeter entfernt, saehe hier nichts
    // davon - und wer ihn hier pflegt, weiss nicht, dass es ihn dort gibt.
    bericht.abos = deuten(abos, e => ({
        gesamt: (e.abonnenten || []).length,
        liste: e.abonnenten || []
    }), { gesamt: 0, liste: [] });

    // **Der letzte Stream - aus unserer eigenen Zeile, nicht von Twitch.**
    // Twitch beantwortet „wie lief der letzte Stream" nicht; `streaming_state`
    // haelt Beginn, Ende, Titel, Kategorie und die zuletzt gemeldete
    // Zuschauerzahl, weil die Live-Ansage sie ohnehin braucht.
    //
    // ⚠ Es ist EIN Stream, kein Verlauf. Die Zeile wird beim naechsten Start
    // ueberschrieben - eine Tabelle je Sendung gibt es nicht. Die Seite sagt
    // das auch so; „Bilanz je Stream" aus dem Entwurf braucht erst diese
    // Tabelle.
    const zustandszeilen = await db().query(
        `SELECT ist_live, begonnen_am, beendet_am, titel, kategorie, zuschauer
           FROM streaming_state WHERE streamer_id = ?`, [kanal.id]);
    bericht.letzterStream = zustandszeilen[0] || null;

    return bericht;
}

/**
 * Ein Antwortpaket in einen Zustand plus Werte uebersetzen.
 *
 * Drei Faelle, und jeder liest sich anders auf der Seite:
 *
 *   `null`            gar keine Zusage mehr - der Streamer hat widerrufen
 *   `abgelehnt`       Twitch hat den Schluessel abgewiesen (401)
 *   `!ok`             etwas anderes ging schief
 *
 * @param {Object|null} ergebnis Was die Plattform lieferte
 * @param {Function} werte Wie die Nutzlast herausgezogen wird
 * @param {Object} leer Was bei Misserfolg dasteht
 * @returns {Object} `{ zustand, …werte }`
 */
function deuten(ergebnis, werte, leer) {
    if (!ergebnis) return { zustand: ZUSTAND.ABGELEHNT, ...leer };
    if (ergebnis.abgelehnt) return { zustand: ZUSTAND.ABGELEHNT, ...leer };
    if (!ergebnis.ok) return { zustand: ZUSTAND.FEHLER, ...leer };
    return { zustand: ZUSTAND.OK, ...werte(ergebnis) };
}

module.exports = { ZUSTAND, holen, deuten };
