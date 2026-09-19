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
 * @returns {Object} Protokoll
 */
function log() {
    return ServiceManager.get('Logger');
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
 * Gerufen vom taeglichen Lauf (`dashboard/kern/aufraeumen.js`). Bis zum
 * 2026-09-19 rief sie niemand, und mit ihr lief auch die Frist nie, die die
 * Twitch-Kennung und den Namen eines Teilnehmers wieder loescht
 * (Baustelle 142).
 *
 * @returns {Promise<{geloescht: number, aelter_als_tage: number}>} Ergebnis
 */
async function aufraeumen() {
    const ergebnis = await db().query(
        'DELETE FROM streaming_lose WHERE angelegt_am < DATE_SUB(NOW(), INTERVAL ? DAY)',
        [AUFBEWAHRUNG_TAGE]);
    return { geloescht: Number(ergebnis?.affectedRows || 0), aelter_als_tage: AUFBEWAHRUNG_TAGE };
}

/**
 * Twitchs Stufen, wie sie wirklich ankommen.
 *
 * Gemessen am 2026-09-07 in `streaming_subscribers`: `stufe` haelt Twitchs
 * Tier-Zeichenkette, nicht 1/2/3. Der Betreiber waehlt die kleine Zahl, wir
 * rechnen sie hier um - eine `1000` im Formular waere zum Raten.
 */
const STUFEN = { 1: 1000, 2: 2000, 3: 3000 };

/**
 * Was dieser Weg pruefen kann.
 *
 * **Nur was ohne Rueckfrage bei Twitch geht.** „Nur Follower" fehlt mit
 * Absicht: Follower fuehren wir als Zahl, nicht als Liste; die Bedingung
 * waere ein Helix-Aufruf je Teilnehmer und braeuchte die Zusage des
 * Kanalinhabers. Sie hier anzubieten hiesse, eine Bedingung zu versprechen,
 * die im Ernstfall an einer fehlenden Zusage scheitert.
 *
 * @returns {Array<Object>} Bedingungsarten
 */
function bedingungen() {
    return [
        {
            art: 'twitch_abonnent',
            label: 'Nur Abonnenten des Kanals',
            eingabe: 'keine',
            hinweis: 'Das Abzeichen kommt mit jeder Chatnachricht mit — dafuer wird nichts abgefragt.'
        },
        {
            art: 'twitch_stufe',
            label: 'Mindestens Abo-Stufe',
            eingabe: 'zahl',
            hinweis: 'Stufe 1, 2 oder 3. Braucht die Abonnentenliste: Ist ein Abonnent dort nicht '
                   + 'vermerkt, ist seine Stufe unbekannt und die Bedingung greift nicht.'
        }
    ];
}

/**
 * Die Bedingungen des Stream-Wegs pruefen.
 *
 * **Unbekannt heisst nein, und das steht im Grund.** Eine Stufe, die wir
 * nicht kennen, als „passt schon" durchzulassen machte die Bedingung
 * wertlos; sie wortlos abzulehnen liesse den Zuschauer raten. Beides ist
 * schlechter als ein Satz.
 *
 * @param {Array<Object>} liste Bedingungen aus der Verlosung
 * @param {Object} kontext { kontoId, istAbonnent, streamerId }
 * @returns {Promise<{ok: boolean, grund: string|null}>} Ergebnis
 */
async function pruefen(liste, kontext) {
    for (const b of liste || []) {
        if (b.art === 'twitch_abonnent') {
            if (!kontext.istAbonnent) {
                return { ok: false, grund: 'Bei diesem Gewinnspiel machen nur Abonnenten mit.' };
            }
            continue;
        }

        if (b.art === 'twitch_stufe') {
            const verlangt = STUFEN[Number(b.wert)] || 0;
            if (!verlangt) continue;   // unbrauchbarer Wert: die Bedingung faellt weg, statt alle zu sperren

            const zeilen = await db().query(
                'SELECT stufe FROM streaming_subscribers WHERE streamer_id = ? AND konto_id = ?',
                [Number(kontext.streamerId), String(kontext.kontoId)]);

            const hat = Number(zeilen[0]?.stufe || 0);

            // **Dieser Zweig ist fuers Ergebnis redundant und fuer die
            // Auskunft nicht.** `0 < verlangt` lehnt ohnehin ab; der
            // Unterschied ist der Satz, den der Zuschauer liest. "Deine Stufe
            // ist hier nicht hinterlegt" schickt ihn zum Streamer, "du
            // brauchst Stufe 2" schickt ihn zum Abo-Knopf - und im zweiten
            // Fall hat er vielleicht laengst Stufe 3.
            if (!hat) {
                return { ok: false, grund: `Für dieses Gewinnspiel braucht es Abo-Stufe ${b.wert} — deine Stufe ist hier nicht hinterlegt.` };
            }
            if (hat < verlangt) {
                return { ok: false, grund: `Für dieses Gewinnspiel braucht es mindestens Abo-Stufe ${b.wert}.` };
            }
            continue;
        }

        // Eine Bedingung, die wir nicht kennen, wird NICHT uebergangen: Sie
        // stand in der Verlosung, jemand hat sie gewollt. Sie stillschweigend
        // zu ignorieren machte aus einer engen Verlosung eine offene.
        log().warn(`[Streaming] unbekannte Bedingung "${b.art}" — Teilnahme abgelehnt`);
        return { ok: false, grund: 'Dieses Gewinnspiel hat eine Bedingung, die ich hier nicht prüfen kann.' };
    }

    return { ok: true, grund: null };
}

/**
 * Die Losquelle, wie die Verlosung sie sieht.
 *
 * @type {Object}
 */
const quelle = {
    label: 'Twitch-Chat',
    bedingungen,
    pruefen,

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
    QUELLE, AUFBEWAHRUNG_TAGE, STUFEN,
    eintragen, fuerVerlosung, zaehlen, ansageEinreihen, aufraeumen,
    bedingungen, pruefen, quelle, anmelden, abmelden
};
