'use strict';

/**
 * Registrierungsstelle fuer eine Ablage freigegebener Tondateien.
 *
 * # Warum es das gibt
 *
 * Der Musikwunsch aus dem Twitch-Chat darf ausschliesslich aus der eigenen
 * hochgeladenen Ablage spielen (`docs/musikwunsch/README.md`). Das Streaming-
 * Plugin braucht also Zugriff auf `music_files` - und der naheliegende Weg
 * waere ein `require` auf `plugins/music/shared/models` gewesen.
 *
 * **Das ist derselbe Fehler, den `LosquellenRegistry` schon einmal vermieden
 * hat**, nur in der anderen Richtung: Dort traegt sich das abhaengige Plugin
 * ein und das thematische fragt nach. Hier ist es umgekehrt, und die Regel
 * dahinter bleibt dieselbe - **wer ohne den anderen weiterlaufen muss, kennt
 * ihn nicht**. `music` erfuellt seine Aufgabe seit jeher ohne Twitch: Es
 * spielt in Discord-Sprachkanaeln und muss das weiter tun, auch wenn es das
 * Streaming-Plugin auf einer Anlage gar nicht gibt. Also traegt `music` seine
 * Ablage hier ein, ohne zu wissen, wer sie liest, und `streaming` fragt nach,
 * ohne `music` zu `require`n.
 *
 * Der Gegenentwurf steht im Bestand und zeigt, warum:
 * `plugins/gameserver/dashboard/routes/servers.js` holt sich
 * `masterserver/dashboard/models/RootServer` per hartem `require` - fehlte
 * masterserver, floege die Route beim Laden.
 *
 * # Was eine Ablage liefert
 *
 * **Nur Freigegebenes.** Die eintragende Seite ist dafuer verantwortlich, dass
 * `suchen()` und `stueck()` ausschliesslich Dateien herausgeben, die fuer den
 * Stream freigegeben sind - bei `music` ist das `MusicFiles.fuerStream()`, der
 * eine Weg, gegen den die ganze Ablage gebaut ist. Diese Stelle prueft das
 * nicht nach; sie koennte es auch nicht, ohne das fremde Schema zu kennen.
 *
 * Deshalb steht es hier so deutlich: Wer eine zweite Ablage eintraegt, die
 * ihre Freigabe nicht prueft, oeffnet genau das Loch, das der Musikwunsch
 * vermeiden soll.
 *
 * @module dunebot-sdk/MusikablageRegistry
 */

/**
 * @typedef {Object} Stueck
 * @property {number} id Kennung im Namensraum der Ablage
 * @property {string} titel Anzeigename
 * @property {number|null} dauerSek Laenge in Sekunden, soweit bekannt
 */

/**
 * @typedef {Object} Tonquelle
 * @property {string} pfad Absoluter Pfad zur Datei auf der Platte
 * @property {string} typ MIME-Typ zum Ausliefern
 * @property {number|null} groesseBytes Dateigroesse, soweit bekannt
 */

/**
 * @typedef {Object} Ablage
 * @property {string} label Klartext fuer die Oberflaeche, z. B. 'Eigene Dateien'
 * @property {Function} suchen async (guildId, begriff) => Stueck[] - NUR Freigegebenes
 * @property {Function} stueck async (guildId, id) => Stueck|null - NUR Freigegebenes
 * @property {Function} tonquelle async (guildId, id) => Tonquelle|null
 * @property {Function} [verfuegbar] async (guildId) => boolean - fuer die Oberflaeche
 */

/** Erlaubte Namen. Derselbe Zuschnitt wie bei den Losquellen. */
const NAME_MUSTER = /^[a-z][a-z0-9_-]{1,31}$/;

/** @type {Map<string, Ablage>} */
const ablagen = new Map();

/**
 * Eine Ablage eintragen.
 *
 * **Der Vertrag wird beim Eintragen geprueft, nicht beim Benutzen.** Eine
 * Ablage ohne `tonquelle` faellt sonst erst auf, wenn im Stream Stille
 * herrscht - und dann sucht niemand mehr in einer Registrierung.
 *
 * @param {string} name Name der Ablage, z. B. 'music'
 * @param {Ablage} ablage Der Vertrag
 * @returns {boolean} true bei Erfolg
 * @throws {Error} bei unzulaessigem Namen oder unvollstaendigem Vertrag
 */
function register(name, ablage) {
    if (!NAME_MUSTER.test(String(name || ''))) {
        throw new Error(`MusikablageRegistry: unzulaessiger Name "${name}" (erlaubt: ${NAME_MUSTER})`);
    }
    for (const feld of ['suchen', 'stueck', 'tonquelle']) {
        if (typeof ablage?.[feld] !== 'function') {
            throw new Error(`MusikablageRegistry: "${name}" hat keine Funktion "${feld}"`);
        }
    }
    ablagen.set(name, ablage);
    return true;
}

/**
 * Eine Ablage austragen.
 *
 * @param {string} name Name
 * @returns {boolean} true, wenn eine da war
 */
function unregister(name) {
    return ablagen.delete(name);
}

/**
 * Eine Ablage holen.
 *
 * @param {string} name Name
 * @returns {Ablage|null} Die Ablage oder null
 */
function get(name) {
    return ablagen.get(name) || null;
}

/**
 * Alle eingetragenen Ablagen.
 *
 * @returns {Array<{name: string, ablage: Ablage}>} Liste
 */
function list() {
    return [...ablagen.entries()].map(([name, ablage]) => ({ name, ablage }));
}

/**
 * Die Ablage, aus der der Stream spielt.
 *
 * **Genau eine, und heute heisst sie `music`.** Es gibt bewusst keine
 * Reihenfolge und keinen Rueckfall auf eine zweite: Ein Rueckfall waere der
 * Weg, auf dem doch wieder etwas anderes als die freigegebene Ablage im Stream
 * landet. Kommt je eine zweite dazu, ist das eine Entscheidung mit einer
 * Oberflaeche, kein stilles `|| naechste`.
 *
 * @param {string} [name] Welche - Vorgabe 'music'
 * @returns {Ablage|null} Die Ablage oder null, wenn keine eingetragen ist
 */
function fuerStream(name = 'music') {
    return ablagen.get(name) || null;
}

/**
 * Alles vergessen. Nur fuer Tests.
 *
 * @returns {void}
 */
function leeren() {
    ablagen.clear();
}

module.exports = { register, unregister, get, list, fuerStream, leeren, NAME_MUSTER };
