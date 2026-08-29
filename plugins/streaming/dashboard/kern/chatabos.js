'use strict';

/**
 * Streaming - die Chat-Abonnements (Stufe 13a).
 *
 * **Warum das nicht in `abos.js` steht.** Die Abos dort haengen an einem Ziel
 * einer Guild, kommen ueber den Webhook, tragen ein Geheimnis und stehen in
 * `streaming_subscriptions`. Ein Chat-Abo hat nichts davon: Es haengt am
 * **Kanal** (F-18: der Chat gehoert dem Kanalinhaber), kommt ueber den
 * Conduit und hat kein Geheimnis.
 *
 * **Und es wird nirgends gespeichert.** Zwei Gruende, jeder ausreichend:
 *
 *   1. `streaming_subscriptions.geheimnis` ist `NOT NULL`. Ein Chat-Abo dort
 *      abzulegen hiesse, eine Spalte etwas behaupten zu lassen, das es nicht
 *      gibt - genau die Sorte Auskunft, die spaeter jemanden in die Irre
 *      fuehrt.
 *   2. **Twitch ist ohnehin die Wahrheit.** Ein eigener Bestand kann von ihm
 *      abweichen, und dann glaubt man dem falschen. Die Liste kommt bei jedem
 *      Abgleich frisch.
 *
 * **Die Tuer ist der Mod-Status**, nicht eine Einstellung bei uns. Twitch
 * verlangt fuer `channel.chat.message` entweder `channel:bot` vom Streamer
 * oder Moderatorenstatus - und Letzteren vergibt allein der Kanalinhaber mit
 * `/mod`. Wer den Bot nicht will, nimmt ihm den Mod-Status; der naechste
 * Abgleich bestellt das Abo dann ab. **Wir fragen dafuer nichts bei ihm ab
 * und speichern keine Zustimmung** - der Mod-Status IST die Zustimmung.
 *
 * @module streaming/dashboard/kern/chatabos
 */

const { ServiceManager } = require('dunebot-core');
const Verbindungsspeicher = require('../../../../apps/dashboard/helpers/Verbindungsspeicher');
const twitch = require('../plattformen/twitch');
const conduit = require('../eingang/conduit');

/** Unter diesem Schluessel liegt der letzte Bericht - die Seite liest ihn. */
const BERICHT_SCHLUESSEL = 'CHATABO_BERICHT';

/** @returns {Object} Datenbankdienst */
const db = () => ServiceManager.get('dbService');
/** @returns {Object} Logger */
const log = () => ServiceManager.get('Logger');

/**
 * Welche Kanaele sollen ein Chat-Abo haben?
 *
 * Der Schnitt aus drei Mengen, und jede ist noetig:
 *
 *   Heim gewaehlt   der Kanalinhaber hat eine `heim_guild_id` gesetzt
 *   moderiert       unser Bot-Konto ist dort Moderator
 *   ausfuehrbar     diese Heim-Guild laeuft noch und hat das Plugin an
 *
 * **Die erste Bedingung ist der Schnitt aus TEIL C**, und sie ersetzt die, die
 * hier vorher stand. Der Entwurf vom 2026-08-28 nahm *jeden beobachteten*
 * Kanal - also auch fremde Streamer, die in irgendeiner Guild nur verfolgt
 * werden. Das ist genau die Vermischung, die Stufe 14 aufloest:
 *
 *     Verfolgung   beliebig viele Guilds   -> geht den Chat nichts an
 *     Chatbot      GENAU EINE Guild        -> nur hier wird abonniert
 *
 * Wer kein Heim gewaehlt hat, hat keinen Chatbot bestellt. Ihm den Bot in den
 * Chat zu setzen, weil ein Dritter seinen Kanal ankuendigt, waere ein Zugriff
 * ohne Auftrag - und niemand haette einen Ort, an dem er ihn wieder abstellt.
 *
 * **"Beobachtet" steht nicht mehr dabei, weil es darin steckt:** Eine
 * `heim_guild_id` laesst sich nur auf eine Guild setzen, die diesen Kanal
 * verfolgt (`heimguild.moeglicheGuilds`), und ein Streamer ohne jedes Ziel
 * wird vom Aufraeumer geloescht. Eine vierte Bedingung waere eine zweite
 * Wahrheit ueber dieselbe Sache.
 *
 * **Die dritte Bedingung ist keine Formalie.** Eine Guild kann das Plugin
 * abschalten oder den Bot hinauswerfen, nachdem sie zum Heim gewaehlt wurde.
 * Dann bliebe der Bot im fremden Chat sitzen, waehrend die einzige Stelle,
 * an der man ihn bedienen koennte, gar nicht mehr erreichbar ist.
 *
 * **Warum die Guilds getrennt abgefragt werden und nicht per JOIN:** Die
 * Kennungen stehen beiderseits der Kollationsgrenze
 * (`streaming_*` ist `utf8mb4_general_ci`, der Kern `utf8mb4_unicode_ci`).
 * Ein Join darueber wirft - am 2026-08-29 gegen die echte Datenbank gemessen,
 * nachdem er gegen eine Attrappe anstandslos lief. Dieselbe Begruendung im
 * Langen steht in `heimguild.moeglicheGuilds`.
 *
 * @param {Array<{kontoId: string}>} moderiert Kanaele mit Mod-Status
 * @returns {Promise<Array<{kanal_id: string, kanal_name: string, heim_guild_id: string}>>} Schnittmenge
 */
async function gewuenscht(moderiert) {
    const modIds = new Set((moderiert || []).map(k => String(k.kontoId)));
    if (!modIds.size) return [];

    // `kanal_id` ist `NOT NULL` (am Schema nachgesehen, 2026-08-29) - eine
    // Pruefung darauf waere eine Bedingung, die nie greift.
    const zeilen = await db().query(
        `SELECT kanal_id, COALESCE(anzeigename, login) AS kanal_name, heim_guild_id
           FROM streaming_streamers
          WHERE plattform = 'twitch'
            AND heim_guild_id IS NOT NULL`) || [];

    const imChat = zeilen.filter(z => modIds.has(String(z.kanal_id)));
    if (!imChat.length) return [];

    const kennungen = [...new Set(imChat.map(z => String(z.heim_guild_id)))];
    const platzhalter = kennungen.map(() => '?').join(',');
    const laufend = await db().query(
        `SELECT g._id AS guild_id
           FROM guilds g
           JOIN guild_plugins p ON p.guild_id = g._id
                               AND p.plugin_name = 'streaming'
                               AND p.is_enabled = 1
          WHERE g._id IN (${platzhalter})
            AND g.left_at IS NULL`, kennungen) || [];
    const daheim = new Set(laufend.map(g => String(g.guild_id)));

    return imChat
        .filter(z => daheim.has(String(z.heim_guild_id)))
        .map(z => ({
            kanal_id:      String(z.kanal_id),
            kanal_name:    z.kanal_name || String(z.kanal_id),
            heim_guild_id: String(z.heim_guild_id)
        }));
}

/**
 * Die Chat-Abos, die bei Twitch wirklich stehen.
 *
 * @returns {Promise<{abos: Array<Object>, vollstaendig: boolean}>} Bestand
 */
async function vorhanden() {
    const { abos, vollstaendig } = await twitch.abosAuflisten();
    return {
        abos: (abos || []).filter(a => a.ereignis === twitch.EREIGNIS_CHAT.typ),
        vollstaendig
    };
}

/**
 * Laeuft gerade ein Abgleich?
 *
 * **Ohne diesen Riegel bestellt sich der Bot doppelt ein.** Drei Stellen rufen
 * an: der Tageslauf, die Wahl der Heim-Guild und der Knopf auf der
 * Chatbot-Seite. Zwei davon zugleich lesen denselben Ist-Zustand, sehen
 * beide "fehlt" und schicken beide eine Bestellung.
 */
let laeuft = false;

/**
 * Soll- und Ist-Zustand angleichen.
 *
 * **Bricht ab, wenn die Liste unvollstaendig ist.** Eine halbe Liste sieht aus
 * wie „die Haelfte der Abos ist weg" - und ein Abgleich, der darauf handelt,
 * bestellt sie nach. Dieselbe Klemme wie in `abosSichern`, und aus demselben
 * Grund.
 *
 * **Jeder Abbruch wird berichtet, nicht verschwiegen.** Der Bericht wird auch
 * dann gespeichert, wenn nichts getan wurde - sonst zeigte die Seite den
 * Stand von gestern und niemand saehe, dass der heutige Lauf nichts konnte.
 *
 * @returns {Promise<Object>} Bericht ueber den Lauf
 */
async function abgleichen() {
    const bericht = {
        gelaufen_am: new Date().toISOString(),
        abgebrochen: null,
        gewuenscht: 0, vorhanden: 0,
        kanaele: [],
        bestellt: [], abbestellt: [], fehler: []
    };

    if (laeuft) {
        bericht.abgebrochen = 'Es laeuft schon ein Abgleich';
        return bericht;
    }
    laeuft = true;

    try {
        return await lauf(bericht);
    } finally {
        laeuft = false;
    }
}

/**
 * Der eigentliche Lauf - getrennt, damit der Riegel oben nur einen Ausgang hat.
 *
 * @param {Object} bericht Der Bericht, der gefuellt wird
 * @returns {Promise<Object>} derselbe Bericht
 */
async function lauf(bericht) {
    /**
     * @param {string} grund Warum nichts getan wurde
     * @returns {Promise<Object>} der Bericht
     */
    const abbrechen = async (grund) => {
        bericht.abgebrochen = grund;
        await berichtSichern(bericht);
        return bericht;
    };

    const stand = conduit.zustand();
    if (!stand.conduitId) {
        // Ohne Conduit kein Ziel fuer die Zustellung. Ein Abo darauf zu
        // bestellen ginge nicht - und das ist kein Fehler, sondern die
        // Reihenfolge: Der Eingang kommt zuerst.
        return abbrechen('Kein Conduit - der Eingang laeuft noch nicht');
    }

    const zusage = await Verbindungsspeicher.betreiberZusageLesen('twitch', 'chatbot');
    if (!zusage?.konto_id) {
        return abbrechen('Das Bot-Konto der Anlage ist nicht zugelassen');
    }

    // Wer moderiert uns? Eine Anfrage fuer alle Kanaele.
    const mod = await Verbindungsspeicher.mitBetreiberZugang(
        { plattform: 'twitch', zweck: 'chatbot' },
        (zugang) => twitch.moderierteKanaele(zusage.konto_id, zugang));

    if (!mod || !mod.ok) {
        // **Nicht als „nirgends Mod" lesen.** Sonst bestellte dieser Lauf
        // saemtliche Chat-Abos ab, weil eine Abfrage klemmte.
        return abbrechen(mod?.abgelehnt
            ? 'Der Schluessel des Bot-Kontos wird abgelehnt'
            : 'Mod-Status nicht abfragbar');
    }

    const soll = await gewuenscht(mod.kanaele);
    const ist = await vorhanden();
    bericht.gewuenscht = soll.length;
    bericht.vorhanden = ist.abos.length;

    if (!ist.vollstaendig) {
        return abbrechen('Abo-Liste unvollstaendig - es wird nichts abbestellt');
    }

    const habenWir = new Map(ist.abos.map(a => [String(a.kanal_id), a]));
    const wollenWir = new Set(soll.map(k => k.kanal_id));

    // Fehlende bestellen
    for (const kanal of soll) {
        const da = habenWir.get(kanal.kanal_id);
        if (da) {
            bericht.kanaele.push({ ...kanal, zustand: da.zustand || 'unbekannt', fehler: null });
            continue;
        }
        const r = await twitch.chatAbonnieren(kanal.kanal_id, zusage.konto_id, stand.conduitId);
        if (r.ok) {
            bericht.bestellt.push(kanal.kanal_name);
            bericht.kanaele.push({ ...kanal, zustand: r.zustand || 'unbekannt', fehler: null });
            log().success(`[Streaming/Chat] Chat abonniert: ${kanal.kanal_name} (${r.zustand}, Kosten ${r.kosten})`);
        } else {
            bericht.fehler.push(`${kanal.kanal_name}: ${r.fehler}`);
            // **Der Kanal bleibt in der Liste, mit seinem Fehler.** Ihn
            // wegzulassen hiesse, die Seite zeigte ihn gar nicht mehr - und
            // ein Kanal, der verschwindet, sieht aus wie einer, der in Ordnung
            // ist.
            bericht.kanaele.push({ ...kanal, zustand: null, fehler: r.fehler });
            log().error(`[Streaming/Chat] Chat-Abo abgelehnt fuer ${kanal.kanal_name}: ${r.fehler}`);
        }
    }

    // Ueberzaehlige abbestellen - der Kanal hat kein Heim mehr, die Heim-Guild
    // fuehrt das Plugin nicht mehr aus, oder der Bot ist dort nicht mehr Mod.
    for (const [kanalId, abo] of habenWir) {
        if (wollenWir.has(kanalId)) continue;
        const weg = await twitch.abbestellen(abo.anbieter_abo_id);
        if (weg) {
            bericht.abbestellt.push(kanalId);
            log().info(`[Streaming/Chat] Chat-Abo entfernt: ${kanalId}`);
        } else {
            bericht.fehler.push(`${kanalId}: konnte nicht abbestellt werden`);
        }
    }

    await berichtSichern(bericht);
    return bericht;
}

/**
 * Den Bericht ablegen.
 *
 * **Faellt nicht durch.** Ein Bericht, der nicht gespeichert werden kann, ist
 * ein Schoenheitsfehler; ein Abgleich, der deshalb als gescheitert gilt, waere
 * einer.
 *
 * @param {Object} bericht Der Bericht
 * @returns {Promise<void>} nichts
 */
async function berichtSichern(bericht) {
    try {
        await db().setConfig('streaming', BERICHT_SCHLUESSEL, bericht, 'shared', '', true);
    } catch (err) {
        log().warn(`[Streaming/Chat] Bericht nicht speicherbar: ${err.message}`);
    }
}

/**
 * Den letzten Bericht lesen.
 *
 * @returns {Promise<Object|null>} Bericht oder null
 */
async function letzterBericht() {
    const wert = await db().getConfig('streaming', BERICHT_SCHLUESSEL, 'shared', null);
    return wert && typeof wert === 'object' ? wert : null;
}

module.exports = { abgleichen, gewuenscht, vorhanden, letzterBericht };
