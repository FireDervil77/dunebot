'use strict';

/**
 * Lose, die aus dem Twitch-Chat kommen.
 *
 * Liegt in `shared/`, weil beide Vorgaenge daran muessen und aus
 * verschiedenen Richtungen: Das **Dashboard** schreibt (dort kommt `!los` an),
 * der **Bot** liest (dort laeuft die Ziehung). Beide reden mit derselben
 * Datenbank; eine Leitung zwischen ihnen braucht es dafuer nicht.
 *
 * Die Verbindung zur Verlosung ist `verlosung_id` - eine Zahl, sonst nichts.
 * **Kein JOIN nach `giveaways`**: Deren Tabellen sind `utf8mb4_unicode_ci`,
 * die `streaming_*`-Tabellen `utf8mb4_general_ci`, und ein JOIN ueber eine
 * Zeichenkette zwischen beiden wirft. Gemessen am 2026-09-07.
 *
 * @module streaming/shared/lose
 */

const { ServiceManager } = require('dunebot-core');
const { LosquellenRegistry } = require('dunebot-sdk');

/** Name, unter dem sich dieses Plugin bei der Verlosung eintraegt. */
const QUELLE = 'streaming';

/**
 * Wie lange ein Los aufgehoben wird.
 *
 * Es gibt keinen Fremdschluessel auf `giveaways` - der wuerde zwei Schemata
 * koppeln, die getrennt installiert werden. Der Preis sind verwaiste Zeilen,
 * wenn eine Verlosung geloescht wird, und die raeumt diese Frist ab. 30 Tage
 * sind laenger als jede Verlosung, die jemand im Stream ansagt.
 */
const AUFBEWAHRUNG_TAGE = 30;

/**
 * @returns {Object} Datenbankdienst
 */
function db() {
    return ServiceManager.get('dbService');
}

/**
 * Ein Los eintragen.
 *
 * @param {Object} p Angaben
 * @param {number} p.verlosungId Verlosung
 * @param {string} p.guildId Guild
 * @param {number} p.streamerId Kanal
 * @param {string} p.kontoId Twitch-Kennung des Zuschauers
 * @param {string|null} p.kontoName Anzeigename
 * @returns {Promise<{ok: boolean, schon: boolean}>} Ergebnis
 */
async function eintragen({ verlosungId, guildId, streamerId, kontoId, kontoName }) {
    try {
        await db().query(`
            INSERT INTO streaming_lose (verlosung_id, guild_id, streamer_id, konto_id, konto_name)
            VALUES (?, ?, ?, ?, ?)
        `, [Number(verlosungId), String(guildId), Number(streamerId), String(kontoId), kontoName || null]);
        return { ok: true, schon: false };
    } catch (e) {
        // **Zweimal `!los` ist kein Fehler, sondern die Regel.** Der eindeutige
        // Schluessel ist die Regel selbst - ein Zuschauer bekommt ein Los, nicht
        // eins pro Tastendruck. Ohne diesen Zweig meldete der Chat eine
        // Stoerung, wo er "du bist schon dabei" sagen soll.
        if (e.code === 'ER_DUP_ENTRY') return { ok: true, schon: true };
        throw e;
    }
}

/**
 * Die Lose einer Verlosung.
 *
 * @param {number} verlosungId Verlosung
 * @returns {Promise<Array<{kennung: string, name: string|null, anzahl: number}>>} Lose
 */
async function fuerVerlosung(verlosungId) {
    const zeilen = await db().query(
        'SELECT konto_id, konto_name FROM streaming_lose WHERE verlosung_id = ?',
        [Number(verlosungId)]);

    // **Ein Los je Zuschauer, immer.** Die Verlosung kennt Mehrfachlose
    // (`entry_count`), im Chat gibt es dafuer aber keinen Erwerbsweg - und
    // eine Zahl, die nie etwas anderes als 1 wird, waere ein Feld, das eine
    // Moeglichkeit vortaeuscht.
    return zeilen.map(z => ({ kennung: String(z.konto_id), name: z.konto_name || null, anzahl: 1 }));
}

/**
 * Wie viele Lose eine Verlosung aus dem Chat hat.
 *
 * @param {number} verlosungId Verlosung
 * @returns {Promise<number>} Anzahl
 */
async function zaehlen(verlosungId) {
    const [zeile] = await db().query(
        'SELECT COUNT(*) AS n FROM streaming_lose WHERE verlosung_id = ?', [Number(verlosungId)]);
    return Number(zeile?.n || 0);
}

/**
 * Eine Zeile in den Twitch-Chat einreihen.
 *
 * **Ueber den Ausgang, nicht direkt.** Aufgerufen wird das aus dem Bot - dort
 * laeuft die Ziehung. Der Weg zu Twitch liegt aber im Dashboard, samt
 * Schluessel des Kanalinhabers. Der Ausgang ist die Bruecke, die es dafuer
 * schon gibt; eine zweite waere eine zweite Wahrheit.
 *
 * @param {string} guildId Guild
 * @param {number} streamerId Kanal
 * @param {string} text Fertiger Satz
 * @returns {Promise<void>}
 */
async function ansageEinreihen(guildId, streamerId, text) {
    await db().query(`
        INSERT INTO streaming_outbox (target_id, guild_id, aktion, nutzlast, faellig_ab)
        VALUES (NULL, ?, 'chat_ansage', ?, NOW(3))
    `, [String(guildId), JSON.stringify({ streamer_id: Number(streamerId), text: String(text) })]);
}

/**
 * Verwaiste und alte Lose wegraeumen.
 *
 * @returns {Promise<{geloescht: number}>} Ergebnis
 */
async function aufraeumen() {
    const ergebnis = await db().query(
        'DELETE FROM streaming_lose WHERE angelegt_am < DATE_SUB(NOW(), INTERVAL ? DAY)',
        [AUFBEWAHRUNG_TAGE]);
    return { geloescht: Number(ergebnis?.affectedRows || 0) };
}

/**
 * Die Losquelle, wie die Verlosung sie sieht.
 *
 * @type {Object}
 */
const quelle = {
    label: 'Twitch-Chat',

    /**
     * @param {Object} verlosung Die Verlosung
     * @returns {Promise<Array<Object>>} Lose
     */
    lose: (verlosung) => fuerVerlosung(verlosung.id),

    /**
     * **Nie eine Discord-Erwaehnung.** Ein `<@…>` auf eine Twitch-Kennung
     * zeigt entweder ins Leere oder auf ein unbeteiligtes Mitglied.
     *
     * @param {Object} los Das Los
     * @returns {string} Anzeige
     */
    nennung: (los) => `${los.name || los.kennung} (Twitch)`,

    /**
     * Den Gewinner im Twitch-Chat nennen.
     *
     * Der Kanal steht am Los und nicht am Aufrufer: Die Verlosung weiss
     * nichts von Streamern, und sie soll auch nichts davon wissen muessen.
     *
     * @param {Object} verlosung Die Verlosung
     * @param {Object} los Das Gewinnerlos
     * @returns {Promise<void>}
     */
    verkuenden: async (verlosung, los) => {
        const zeilen = await db().query(
            'SELECT guild_id, streamer_id, konto_name FROM streaming_lose WHERE verlosung_id = ? AND konto_id = ?',
            [Number(verlosung.id), String(los.kennung)]);

        const zeile = zeilen[0];
        if (!zeile) return;   // Los weg, seit gezogen wurde - dann gibt es niemanden zu nennen

        const wer = zeile.konto_name || los.name || los.kennung;
        await ansageEinreihen(zeile.guild_id, zeile.streamer_id,
            `@${wer} hat gewonnen: ${verlosung.prize}`);
    }
};

/**
 * Sich bei der Verlosung eintragen.
 *
 * @returns {boolean} true, wenn eingetragen
 */
function anmelden() {
    return LosquellenRegistry.register(QUELLE, quelle);
}

/**
 * Eintrag zuruecknehmen.
 *
 * @returns {boolean} true, wenn entfernt
 */
function abmelden() {
    return LosquellenRegistry.unregister(QUELLE);
}

module.exports = {
    QUELLE, AUFBEWAHRUNG_TAGE,
    eintragen, fuerVerlosung, zaehlen, ansageEinreihen, aufraeumen,
    quelle, anmelden, abmelden
};
