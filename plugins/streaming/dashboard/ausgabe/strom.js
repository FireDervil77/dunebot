'use strict';

/**
 * Streaming - der Ausgang zum Browser.
 *
 * Die Zustandsseite war bis zum 2026-08-26 **einmal gezeichnet und dann tot**.
 * Sie pollte nicht - sie stand einfach. Wer sie offen liess, sah eine halbe
 * Stunde spaeter dieselben Zahlen und hatte keinen Anhalt, dass sie alt sind.
 * Das ist schlimmer als eine leere Seite: Sie behauptet "offline" mit
 * derselben Bestimmtheit, ob die Angabe zwei Sekunden oder zwei Stunden alt
 * ist.
 *
 * Hier haengt der hausinterne Signalweg (`shared/signale`) am `SSEManager` des
 * Dashboards. **Nicht neu gebaut, sondern angedockt** - nachgesehen am
 * 2026-08-26: `apps/dashboard/helpers/SSEManager.js` gibt es seit langem, mit
 * Herzschlag, Abmeldung und Statistik, und `masterserver` benutzt ihn bereits.
 * Ein zweiter Strommechanismus waere die Sorte Doppelbau, die man drei Monate
 * spaeter beim Aufraeumen findet.
 *
 * **Ein Signal traegt keine Daten.** Es sagt nur "hier hat sich etwas
 * geaendert"; der Browser holt sich den Stand danach selbst ueber eine Route
 * mit Rechtepruefung. Das ist bewusst umstaendlicher als die Daten gleich
 * mitzuschicken - aber es gibt keine zweite Stelle, an der man den Rechteweg
 * vergessen kann, und ein Fehler hier kaeme sonst als fremde Daten im falschen
 * Browser heraus.
 *
 * @module streaming/dashboard/ausgabe/strom
 */

const { ServiceManager } = require('dunebot-core');
const { signale, ZUSTAND } = require('../../shared/signale');

/**
 * Der Name, unter dem der Browser lauscht. Muss mit der Ansicht
 * uebereinstimmen - `streaming-zustand.ejs` haengt an genau diesem Wort.
 */
const KANAL = 'streaming';

/**
 * Sammelzeit, bevor gesendet wird.
 *
 * Geht ein Streamer live, den zwoelf Guilds beobachten, laufen in wenigen
 * Millisekunden ein Dutzend Signale ein. Ohne Sammeln wuerde jeder offene
 * Browser ein Dutzend Mal nachladen - fuer denselben Stand. 300 ms sind
 * unterhalb der Wahrnehmung und fassen den ganzen Schwall zusammen.
 */
const SAMMELN_MS = 300;

let angemeldet = false;
let zuhoerer = null;

/** @type {Map<string, NodeJS.Timeout>} guildId -> laufender Sammeltimer */
const wartend = new Map();

/**
 * @returns {Object} Datenbankdienst
 */
function db() {
    return ServiceManager.get('dbService');
}

/**
 * @returns {Object} Logger
 */
function log() {
    return ServiceManager.get('Logger');
}

/**
 * Welche Guilds gehen einen Streamer etwas an?
 *
 * Genau die, die ein Ziel darauf haben - nicht alle. Ein Streamer ist global;
 * wer das Signal an alle schickte, verriete jeder Guild, welche Kanaele andere
 * beobachten. Das faellt nie als Fehler auf, weil das Signal ja "leer" ist -
 * aber der Zeitpunkt allein sagt schon, dass dieser Kanal gerade live ging.
 *
 * @param {number} streamerId Streamer
 * @returns {Promise<Array<string>>} Guild-IDs
 */
async function betroffeneGuilds(streamerId) {
    const zeilen = await db().query(
        'SELECT DISTINCT guild_id FROM streaming_targets WHERE streamer_id = ?', [streamerId]);
    return zeilen.map(z => String(z.guild_id));
}

/**
 * Eine Guild anstupsen - hoechstens alle SAMMELN_MS.
 *
 * @param {string} guildId Guild
 * @param {string} grund Kurzwort fuers Protokoll
 */
function anstupsen(guildId, grund) {
    if (wartend.has(guildId)) return;

    wartend.set(guildId, setTimeout(() => {
        wartend.delete(guildId);
        try {
            const sse = ServiceManager.get('sseManager');
            // Kein Dienst, kein Strom - aber auch kein Fehler. Das Dashboard
            // laeuft auch ohne, die Seite ist dann eben so alt wie frueher.
            if (!sse) return;

            sse.broadcast(guildId, KANAL, { grund, zeit: Date.now() });
        } catch (error) {
            log().error('[Streaming] Strom: Anstupsen fehlgeschlagen:', error);
        }
    }, SAMMELN_MS));
}

/**
 * Ein Signal in offene Browser weiterreichen.
 *
 * @param {Object} was Signal
 * @returns {Promise<void>}
 */
async function weiterreichen(was = {}) {
    try {
        const grund = was.grund || 'aenderung';

        if (was.guildId) {
            anstupsen(String(was.guildId), grund);
            return;
        }

        if (!was.streamerId) return;

        for (const guildId of await betroffeneGuilds(was.streamerId)) {
            anstupsen(guildId, grund);
        }
    } catch (error) {
        // Ein misslungenes Anstupsen darf nie den Melder stoeren - der steckt
        // mitten in der Verarbeitung eines echten Ereignisses.
        log().error('[Streaming] Strom: Signal nicht zustellbar:', error);
    }
}

/**
 * Zuhoeren beginnen.
 *
 * Mehrfachaufruf ist harmlos: Ohne die Sperre haenge nach jedem
 * Plugin-Neustart ein weiterer Zuhoerer am selben Emitter, und jedes Signal
 * kaeme doppelt, dreifach, vierfach an. Genau so entsteht der Fehler, den man
 * erst nach dem fuenften Neustart sieht.
 */
function starten() {
    if (angemeldet) return;

    zuhoerer = (was) => { weiterreichen(was); };
    signale.on(ZUSTAND, zuhoerer);
    angemeldet = true;

    log().info('[Streaming] Strom zum Browser angemeldet');
}

/**
 * Zuhoeren beenden und wartende Sammeltimer abraeumen.
 */
function anhalten() {
    if (zuhoerer) signale.off(ZUSTAND, zuhoerer);
    zuhoerer = null;
    angemeldet = false;

    for (const timer of wartend.values()) clearTimeout(timer);
    wartend.clear();
}

module.exports = { starten, anhalten, weiterreichen, betroffeneGuilds, KANAL, SAMMELN_MS };
