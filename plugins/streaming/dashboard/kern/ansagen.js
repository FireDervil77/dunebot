'use strict';

/**
 * Timer-Ansagen (P6) - was der Bot von sich aus wiederholt in den Chat sagt.
 *
 * ## Was hier NICHT gebaut wurde
 *
 * Kein Zeitplan, kein Sendeweg, keine Chatzaehlung. Alle drei lagen schon, und
 * die Entwurfsseite hat das seit Wochen genau so ausgewiesen:
 *
 *     Der Zeitplan                      kern/takt.js
 *     Der Sendeweg                      twitch.chatSenden()  ueber den Ausgang
 *     Die Zaehlung "nur wenn was los"   conduit.chatGezaehlt()
 *     Es fehlt                          die Stelle dazwischen
 *
 * Diese Datei ist die Stelle dazwischen. Sie entscheidet, **ob** etwas
 * hinausgeht, und legt es in den Ausgang - gesendet wird in `ausgabe/drossel`,
 * mit demselben Weg wie die Live-Ansage. Ein zweiter Sendeweg daneben waere
 * die Naht, an der heute schon `s.plattform` und `{spiel}` haengengeblieben
 * sind.
 *
 * ## Die vier Bedingungen, und warum jede noetig ist
 *
 *   live          Eine Ansage in einen leeren Chat ist Werbung an niemanden.
 *   aktiv         Der Schalter des Streamers.
 *   faellig       `zuletzt_am` plus Intervall liegt in der Vergangenheit.
 *   genug los     Seit der letzten Ansage kamen genug Chatzeilen.
 *
 * Die vierte ist die, um die es Streamern wirklich geht: Ein Bot, der in einen
 * stillen Chat alle 25 Minuten „Komm auf meinen Discord" schreibt, sieht aus
 * wie ein Automat. Deshalb misst sie an echten Nachrichten.
 *
 * ## Warum der Vergleichswert im Speicher steht
 *
 * Der Zaehler, an dem gemessen wird, lebt im Conduit (`chatGezaehlt`) und
 * endet mit ihm. Ein Vergleichswert in der Datenbank behauptete
 * Dauerhaftigkeit, die die gemessene Zahl nicht hat: Nach einem Neustart
 * stuende dort eine Zahl ueber einen Zaehler, den es nicht mehr gibt. Also
 * liegt er dort, wo auch der Zaehler liegt. Dieselbe Entscheidung wie bei der
 * Abkuehlung in `kern/befehle` - und derselbe Preis: Nach einem Neustart
 * wartet jede Ansage einmal auf frische Zeilen. Das ist die richtige Seite des
 * Irrtums.
 *
 * @module streaming/kern/ansagen
 */

const { ServiceManager } = require('dunebot-core');
const vorlagen = require('../../shared/vorlagen');

/**
 * Wie oft der Lauf nachsieht. Eine Minute, weil das Intervall in Minuten
 * gerechnet wird - haeufiger nachzusehen koennte nichts feiner treffen.
 */
const LAUF_MS = 60 * 1000;

/**
 * Die Grenzen des Intervalls.
 *
 * **Fuenf Minuten sind kein runder Wert, sondern die Ratengrenze.** Der Bot
 * schreibt mit EINEM Konto in alle Kanaele (`firebot_mod`), und Twitch zaehlt
 * je Konto ueber alle Chats zusammen. Ein Streamer, der eine Ansage auf eine
 * Minute stellt, verbraucht das Kontingent aller anderen mit.
 */
const INTERVALL_MIN = 5;
const INTERVALL_MAX = 1440;

/** Mehr als das ist keine Bedingung mehr, sondern ein Abschalten. */
const ZEILEN_MAX = 500;

/**
 * Der Zeilenstand bei der letzten Ansage, je Ansage-Kennung.
 *
 * Siehe Kopf: Er gehoert in den Speicher, weil der gemessene Zaehler dort
 * liegt. `Map`, nicht Objekt - die Kennungen sind Zahlen.
 */
const zeilenstand = new Map();

/** @returns {Object} Datenbankdienst */
function db() {
    return ServiceManager.get('dbService');
}

/** @returns {Object} Protokoll */
function log() {
    return ServiceManager.get('Logger');
}

/**
 * Der Chatzaehler des Conduits, spaet geholt.
 *
 * `eingang/conduit` zieht die Plattform nach sich; ein `require` am Kopf
 * machte die Entscheidung von der Leitung abhaengig.
 *
 * @param {string} kanalId Twitch-Kanalkennung
 * @returns {number} Nachrichten seit dem Start der Leitung
 */
function zeilenJetzt(kanalId) {
    try {
        const stand = require('../eingang/conduit').zustand();
        const eintrag = (stand.chat || []).find(c => String(c.kanal_id) === String(kanalId));
        return Number(eintrag?.anzahl) || 0;
    } catch {
        // Keine Leitung heisst: nichts gezaehlt. Das ist eine Auskunft, kein
        // Fehler - und sie haelt jede Ansage mit Mindestzeilen zurueck.
        return 0;
    }
}

/**
 * Eine Ansage pruefen, bevor sie gespeichert wird.
 *
 * **Dieselbe Vorlagenpruefung wie die Live-Ansage** (`pruefeChatVorlage`):
 * Beides geht in denselben Chat, beides kennt dieselben Platzhalter. Eine
 * eigene Liste daneben waere die dritte im Plugin.
 *
 * Reine Rechnung: keine Datenbank, vollstaendig durchspielbar.
 *
 * @param {Object} felder `{ text, intervall_min, mindest_zeilen }`
 * @param {Array<string>} [eigeneNamen] Textbausteine dieser Guild
 * @returns {string|null} Grund oder null
 */
function pruefe(felder, eigeneNamen = []) {
    const text = String(felder?.text || '').trim();
    if (!text) return 'text';

    // `pruefeChatVorlage` kennt drei Faelle: zu_lang, platzhalter, nur_discord.
    // Sie werden durchgereicht statt zu einem zusammengefasst - der Streamer
    // soll wissen, WAS an seinem Text nicht geht.
    //
    // Die eigenen Bausteine kommen als Namen herein: Ohne sie waere
    // `{discord}` „ein Platzhalter, den es nicht gibt" - und die Ansage liesse
    // sich nicht speichern, obwohl sie funktioniert haette.
    const vorlagenfehler = vorlagen.pruefeChatVorlage(text, eigeneNamen);
    if (vorlagenfehler) return vorlagenfehler;

    const takt = Number(felder?.intervall_min);
    if (!Number.isFinite(takt) || takt < INTERVALL_MIN || takt > INTERVALL_MAX) return 'intervall';

    // `mindest_zeilen` darf 0 sein - das heisst „immer". Deshalb auf Endlichkeit
    // pruefen und nicht auf Wahrheit: `0` ist ein gueltiger Wert.
    const zeilen = Number(felder?.mindest_zeilen);
    if (!Number.isFinite(zeilen) || zeilen < 0 || zeilen > ZEILEN_MAX) return 'zeilen';

    return null;
}

/**
 * Die Namen der eigenen Textbausteine dieser Guild.
 *
 * Spaet geholt, weil `kern/bausteine` das Befehlsmodul nach sich zieht.
 *
 * @param {string} guildId Guild
 * @returns {Promise<Array<string>>} Namen ohne Klammern
 */
async function eigeneNamen(guildId) {
    const zeilen = await require('./bausteine').alleFuerGuild(guildId);
    return zeilen.map(z => z.name);
}

/**
 * Die Ansagen einer Guild, fuer die Seite.
 *
 * @param {string} guildId Discord-Guild-ID
 * @returns {Promise<Array<Object>>} Zeilen samt Kanalnamen
 */
async function alleFuerGuild(guildId) {
    return await db().query(`
        SELECT a.id, a.streamer_id, a.text, a.intervall_min, a.mindest_zeilen,
               a.aktiv, a.zuletzt_am, a.gesendet_anzahl,
               s.login, s.anzeigename
          FROM streaming_announcements a
          JOIN streaming_streamers s ON s.id = a.streamer_id
         WHERE a.guild_id = ?
         ORDER BY a.id ASC
    `, [String(guildId)]);
}

/**
 * Eine Ansage anlegen.
 *
 * @param {string} guildId Guild
 * @param {number} streamerId Kanal
 * @param {Object} felder Eingaben
 * @param {string|null} [von] Wer sie angelegt hat
 * @returns {Promise<{ok: boolean, grund?: string}>} Ergebnis
 */
async function anlegen(guildId, streamerId, felder, von = null) {
    const grund = pruefe(felder, await eigeneNamen(guildId));
    if (grund) return { ok: false, grund };

    // **Der Kanal muss zu dieser Guild gehoeren.** Die Kennung aus dem
    // Formular ist eine Behauptung; ohne diese Pruefung koennte eine Guild
    // Ansagen in den Chat eines fremden Kanals legen.
    const passt = await db().query(
        'SELECT id FROM streaming_streamers WHERE id = ? AND heim_guild_id = ?',
        [Number(streamerId), String(guildId)]);
    if (!passt.length) return { ok: false, grund: 'kanal' };

    await db().query(`
        INSERT INTO streaming_announcements
               (guild_id, streamer_id, text, intervall_min, mindest_zeilen, angelegt_von)
        VALUES (?, ?, ?, ?, ?, ?)
    `, [String(guildId), Number(streamerId), String(felder.text).trim(),
        Number(felder.intervall_min), Number(felder.mindest_zeilen), von]);

    return { ok: true };
}

/**
 * Eine Ansage aendern.
 *
 * **`AND guild_id = ?` steht in der Abfrage, nicht davor.** Die Kennung aus
 * der Adresse ist eine Behauptung - eine Vorabfrage waere ein zweiter Weg,
 * denselben Schutz zu vergessen.
 *
 * @param {number} id Ansage
 * @param {string} guildId Guild
 * @param {Object} felder Eingaben
 * @returns {Promise<{ok: boolean, grund?: string}>} Ergebnis
 */
async function aendern(id, guildId, felder) {
    const grund = pruefe(felder, await eigeneNamen(guildId));
    if (grund) return { ok: false, grund };

    const ergebnis = await db().query(`
        UPDATE streaming_announcements
           SET text = ?, intervall_min = ?, mindest_zeilen = ?, aktiv = ?
         WHERE id = ? AND guild_id = ?
    `, [String(felder.text).trim(), Number(felder.intervall_min),
        Number(felder.mindest_zeilen), felder.aktiv ? 1 : 0,
        Number(id), String(guildId)]);

    return { ok: Boolean(ergebnis?.affectedRows) };
}

/**
 * Eine Ansage entfernen.
 *
 * @param {number} id Ansage
 * @param {string} guildId Guild
 * @returns {Promise<boolean>} ob etwas entfernt wurde
 */
async function entfernen(id, guildId) {
    const ergebnis = await db().query(
        'DELETE FROM streaming_announcements WHERE id = ? AND guild_id = ?',
        [Number(id), String(guildId)]);

    // Der Vergleichswert im Speicher geht mit - sonst erbte eine spaeter
    // angelegte Ansage mit derselben Kennung einen fremden Zeilenstand.
    zeilenstand.delete(Number(id));
    return Boolean(ergebnis?.affectedRows);
}

/**
 * Welche Ansagen waeren jetzt dran?
 *
 * Die drei Bedingungen, die die Datenbank beantworten kann. Die vierte
 * („genug los") steht im Lauf, weil sie an einem Zaehler im Speicher misst.
 *
 * **Der Vergleich `s.heim_guild_id = a.guild_id` ist kein Beiwerk:** Wechselt
 * ein Kanal seine Heim-Guild, bleiben seine alten Ansagen liegen - aber sie
 * gehen nicht mit. Die Guild, in der sie eingerichtet wurden, hat den Kanal
 * nicht mehr; wer dort etwas abstellen wollte, koennte es nicht.
 *
 * @returns {Promise<Array<Object>>} faellige Ansagen
 */
async function faellige() {
    return await db().query(`
        SELECT a.id, a.guild_id, a.streamer_id, a.text,
               a.intervall_min, a.mindest_zeilen, a.zuletzt_am,
               s.kanal_id, s.login, s.anzeigename
          FROM streaming_announcements a
          JOIN streaming_streamers s ON s.id = a.streamer_id
          JOIN streaming_state z     ON z.streamer_id = s.id
         WHERE a.aktiv = 1
           AND z.ist_live = 1
           AND s.heim_guild_id = a.guild_id
           AND (a.zuletzt_am IS NULL
                OR a.zuletzt_am < DATE_SUB(NOW(3), INTERVAL a.intervall_min MINUTE))
         ORDER BY a.zuletzt_am IS NULL DESC, a.zuletzt_am ASC, a.id ASC
    `);
}

/**
 * Laufen die Heim-Guilds ueberhaupt noch?
 *
 * **Getrennt abgefragt und nicht per JOIN**, obwohl die Kollationen es seit
 * dem 2026-08-31 hergaeben: Dieselbe Bauform wie `chatabos.gewuenscht` und
 * `heimguild.moeglicheGuilds`. Eine Guild kann das Plugin abschalten oder den
 * Bot hinauswerfen, nachdem eine Ansage eingerichtet wurde - dann redet der
 * Bot weiter in einen fremden Chat, waehrend die einzige Stelle, an der man
 * ihn abstellen koennte, nicht mehr erreichbar ist.
 *
 * @param {Array<string>} kennungen Guild-Kennungen
 * @returns {Promise<Set<string>>} die, die noch laufen
 */
async function laufendeGuilds(kennungen) {
    if (!kennungen.length) return new Set();
    const platzhalter = kennungen.map(() => '?').join(',');
    const zeilen = await db().query(`
        SELECT g._id AS guild_id
          FROM guilds g
          JOIN guild_plugins p ON p.guild_id = g._id
                              AND p.plugin_name = 'streaming'
                              AND p.is_enabled = 1
         WHERE g._id IN (${platzhalter})
           AND g.left_at IS NULL
    `, kennungen) || [];
    return new Set(zeilen.map(g => String(g.guild_id)));
}

/**
 * Der Lauf: nachsehen, entscheiden, vormerken.
 *
 * **Hoechstens eine Ansage je Kanal und Lauf.** Wer drei Ansagen auf denselben
 * Takt stellt, bekommt sie sonst als Block hintereinander - im Chat sieht das
 * aus wie ein Aussetzer. Die aelteste kommt zuerst (`ORDER BY` in `faellige`),
 * die anderen im naechsten Lauf.
 *
 * @returns {Promise<{geprueft: number, vorgemerkt: number, gewartet: number}>} Bericht
 */
async function lauf() {
    const dran = await faellige();
    const bericht = { geprueft: dran.length, vorgemerkt: 0, gewartet: 0 };
    if (!dran.length) return bericht;

    const laufend = await laufendeGuilds([...new Set(dran.map(a => String(a.guild_id)))]);
    const schonDran = new Set();

    for (const a of dran) {
        if (!laufend.has(String(a.guild_id))) continue;
        if (schonDran.has(String(a.kanal_id))) continue;

        const jetzt = zeilenJetzt(a.kanal_id);
        const noetig = Number(a.mindest_zeilen) || 0;

        if (noetig > 0) {
            // **Beim ersten Sehen wird nur gemerkt, nicht gesendet.** Wie viele
            // Zeilen vor diesem Augenblick kamen, weiss niemand - der Zaehler
            // zaehlt seit dem Start der Leitung, nicht seit dieser Ansage.
            // Eine Zahl zu erfinden hiesse, die Bedingung beim ersten Mal zu
            // umgehen.
            if (!zeilenstand.has(a.id)) {
                zeilenstand.set(a.id, jetzt);
                bericht.gewartet++;
                continue;
            }

            // **Die Leitung kann abreissen** - dann faengt der Zaehler wieder
            // bei null an und steht unter dem gemerkten Wert.
            //
            // Der erste Anlauf rechnete hier `Math.max(0, jetzt - vorher)`.
            // Das verhindert die negative Zahl, setzt den Vergleichswert aber
            // nicht zurueck: Nach einem Abriss bei Stand 500 bliebe die
            // Differenz null, bis der neue Zaehler die alten 500 ueberholt -
            // die Ansage waere praktisch fuer immer stumm. Der Waechter hat
            // das gefunden, bevor es jemand im Chat gemerkt haette.
            //
            // Richtig ist, den Zaehler als neu zu erkennen und von vorne zu
            // zaehlen. Das kostet eine Wartezeit und ist die richtige Seite
            // des Irrtums.
            const vorher = Number(zeilenstand.get(a.id));
            if (jetzt < vorher) {
                zeilenstand.set(a.id, jetzt);
                bericht.gewartet++;
                continue;
            }
            if (jetzt - vorher < noetig) { bericht.gewartet++; continue; }
        }

        // **`zuletzt_am` beim Vormerken, nicht beim Erfolg.** Sonst liefe eine
        // Ansage, die Twitch ablehnt, im Minutentakt wieder an - dieselbe
        // Regel wie bei der Abkuehlung der Befehle.
        await db().query(`
            UPDATE streaming_announcements SET zuletzt_am = NOW(3) WHERE id = ?
        `, [a.id]);

        await db().query(`
            INSERT INTO streaming_outbox (target_id, guild_id, aktion, nutzlast, faellig_ab)
            VALUES (NULL, ?, 'chat_ansage', ?, NOW(3))
        `, [String(a.guild_id), JSON.stringify({ streamer_id: a.streamer_id, ansage_id: a.id })]);

        zeilenstand.set(a.id, jetzt);
        schonDran.add(String(a.kanal_id));
        bericht.vorgemerkt++;
    }

    if (bericht.vorgemerkt) {
        log().info(`[Streaming/Ansagen] ${bericht.vorgemerkt} vorgemerkt, ${bericht.gewartet} warten auf Chatzeilen`);
    }
    return bericht;
}

/**
 * Nur fuer Tests: den Speicher leeren.
 *
 * @returns {void}
 */
function vergessen() {
    zeilenstand.clear();
}

module.exports = {
    LAUF_MS, INTERVALL_MIN, INTERVALL_MAX, ZEILEN_MAX,
    pruefe, alleFuerGuild, anlegen, aendern, entfernen,
    faellige, lauf, vergessen
};
