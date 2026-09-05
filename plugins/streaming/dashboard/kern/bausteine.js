'use strict';

/**
 * Eigene Textbausteine - `{discord}` einmal setzen, ueberall benutzen.
 *
 * ## Warum das hier steht und nicht in `parsePlaceholders`
 *
 * `dunebot-core/lib/PlaceholderParser` kann diese Ersetzung bereits: Sein
 * `extra`-Teil bildet Namen auf Werte ab und maskiert die Namen korrekt fuer
 * den regulaeren Ausdruck. Nachgesehen, bevor hier etwas entstand.
 *
 * Benutzt wird es trotzdem nicht, und zwar aus einem Grund, der genannt
 * gehoert: Die **Reihenfolge** der Ersetzung ist im Befehlsweg eine
 * Sicherheitsfrage (siehe `kern/befehle.fuellen`). `parsePlaceholders` setzt
 * `extra` an einer festen Stelle ein und wandelt ausserdem `\\n` in echte
 * Zeilenumbrueche - beides waere hier fremdbestimmt. Eine Funktion, deren
 * Reihenfolge eine Zusage traegt, darf ihre Schritte nicht auslagern.
 *
 * Was uebernommen wurde, ist die Maskierung: Ein Name landet als Muster in
 * einem regulaeren Ausdruck, und ein `.` darin duerfte nicht "irgendein
 * Zeichen" heissen.
 *
 * ## Wo die Werte gelten
 *
 * In Befehlsantworten und in Ansagen - ueberall dort, wo der Streamer Text
 * schreibt, der in seinen Chat geht. `streamer_id IS NULL` heisst "gilt fuer
 * jeden Kanal dieser Guild"; die Zeile mit Kanal gewinnt.
 *
 * @module streaming/kern/bausteine
 */

const { ServiceManager } = require('dunebot-core');

/** Wie ein Name aussehen darf - dieselbe Form wie ein Befehlswort. */
const NAME_FORM = /^[a-z0-9_-]{1,32}$/;

/** Twitchs Grenze, und damit auch die eines Bausteins. */
const WERT_MAX = 500;

/** @returns {Object} Datenbankdienst */
function db() {
    return ServiceManager.get('dbService');
}

/**
 * Die Namen, die schon vergeben sind.
 *
 * **Aus der Liste des Befehlsmoduls, nicht danebengeschrieben.** Ein eigener
 * Baustein `{spiel}` wuerde den eingebauten verdecken - und weil die eigenen
 * ZUERST eingesetzt werden, waere der eingebaute danach nicht mehr da. Der
 * Streamer saehe seine Kategorie nie wieder und faende den Grund nicht.
 *
 * `{2}`..`{9}` stehen nicht in `PLATZHALTER` (neun Bausteine nebeneinander
 * waeren eine Wand), sind aber genauso vergeben - deshalb hier dazu.
 *
 * @returns {Set<string>} Namen ohne Klammern
 */
function vergebeneNamen() {
    const { PLATZHALTER } = require('./befehle');
    const namen = new Set(PLATZHALTER.map(p => p.name.slice(1, -1).toLowerCase()));
    for (let i = 1; i <= 9; i++) namen.add(String(i));
    return namen;
}

/**
 * Einen Baustein pruefen, bevor er gespeichert wird.
 *
 * @param {Object} felder `{ name, wert }`
 * @returns {string|null} Grund oder null
 */
function pruefe(felder) {
    // Die Klammern gehoeren der Schreibweise, nicht dem Namen. Wer `{discord}`
    // eintippt, meint `discord` - das abzuweisen waere Kleinlichkeit.
    const name = String(felder?.name || '').trim().replace(/^\{|\}$/g, '').toLowerCase();
    if (!NAME_FORM.test(name)) return 'name';
    if (vergebeneNamen().has(name)) return 'belegt';

    if (String(felder?.art || 'text') === 'zaehler') {
        // **Ein Zaehler hat keinen Text, sondern einen Startwert.** Ihn hier
        // wie einen Baustein auf "nicht leer" zu pruefen wuerde `0` abweisen -
        // und `0` ist der uebliche Anfang.
        const zahl = Number(felder?.zahl ?? 0);
        if (!Number.isFinite(zahl) || !Number.isInteger(zahl)) return 'zahl';
        if (zahl < 0 || zahl > 1_000_000_000) return 'zahl';
        return null;
    }

    const wert = String(felder?.wert || '').trim();
    if (!wert) return 'wert';
    if (wert.length > WERT_MAX) return 'zu_lang';

    return null;
}

/**
 * Den Namen so herrichten, wie er gespeichert wird.
 *
 * @param {string} roh Eingabe
 * @returns {string} Name ohne Klammern, klein
 */
function nameHerrichten(roh) {
    return String(roh || '').trim().replace(/^\{|\}$/g, '').toLowerCase();
}

/**
 * Welche Namen in einem Text sind KEINE eingebauten?
 *
 * Damit spart sich der Auswerter die Abfrage, wenn ohnehin nur eingebaute
 * Platzhalter vorkommen - und das ist der Normalfall. Eine Abfrage je
 * Chatnachricht waere der Preis dafuer, dass jemand `!regeln` tippt.
 *
 * @param {string} text Vorlage
 * @returns {Array<string>} Namen ohne Klammern
 */
function fremdeNamenIn(text) {
    const vergeben = vergebeneNamen();
    const gefunden = String(text || '').match(/\{[a-z0-9_-]{1,32}\}/gi) || [];
    return [...new Set(gefunden
        .map(g => g.slice(1, -1).toLowerCase())
        .filter(n => !vergeben.has(n)))];
}

/**
 * Die Werte fuer einen Kanal holen.
 *
 * **Die Zeile mit Kanal gewinnt.** `ORDER BY streamer_id IS NULL ASC` bringt
 * sie zuerst; die `Map` behaelt danach den ersten Eintrag je Namen.
 *
 * @param {string} guildId Guild
 * @param {number} streamerId Kanal
 * @param {Array<string>} [namen] Nur diese - leer heisst alle
 * @returns {Promise<Map<string, string>>} Name auf Wert
 */
async function werteFuer(guildId, streamerId, namen = null) {
    let sql = `SELECT name, art, wert, zahl, streamer_id
                 FROM streaming_variables
                WHERE guild_id = ? AND (streamer_id = ? OR streamer_id IS NULL)`;
    const werte = [String(guildId), Number(streamerId)];

    if (namen && namen.length) {
        sql += ` AND name IN (${namen.map(() => '?').join(',')})`;
        werte.push(...namen);
    }
    sql += ' ORDER BY streamer_id IS NULL ASC';

    const zeilen = await db().query(sql, werte);
    const karte = new Map();
    for (const z of zeilen) {
        // Ein Zaehler wird zu seiner Zahl, ein Baustein zu seinem Text. Nach
        // aussen ist beides dasselbe: ein Name, der zu einer Zeichenkette wird.
        if (!karte.has(z.name)) {
            karte.set(z.name, z.art === 'zaehler' ? String(Number(z.zahl) || 0) : z.wert);
        }
    }
    return karte;
}

/**
 * Einen Zaehler um eins erhoehen.
 *
 * **Die Datenbank rechnet, nicht wir.** Ein `SELECT` gefolgt von `zahl + 1`
 * verloere jeden zweiten Klick, wenn zwei Zuschauer den Befehl gleichzeitig
 * tippen - der zweite schriebe den Wert des ersten zurueck. `zahl = zahl + 1`
 * ist eine einzige Anweisung und kann das nicht.
 *
 * `ORDER BY streamer_id IS NULL ASC LIMIT 1` trifft dieselbe Zeile, die auch
 * `werteFuer` gewinnen laesst: die des Kanals vor der der ganzen Guild.
 *
 * @param {string} guildId Guild
 * @param {number} streamerId Kanal
 * @param {string} name Zaehlername ohne Klammern
 * @returns {Promise<boolean>} ob einer getroffen wurde
 */
async function hochzaehlen(guildId, streamerId, name) {
    const ergebnis = await db().query(`
        UPDATE streaming_variables
           SET zahl = zahl + 1
         WHERE guild_id = ? AND name = ? AND art = 'zaehler'
           AND (streamer_id = ? OR streamer_id IS NULL)
         ORDER BY streamer_id IS NULL ASC
         LIMIT 1
    `, [String(guildId), String(name).toLowerCase(), Number(streamerId)]);
    return Boolean(ergebnis?.affectedRows);
}

/**
 * Die Bausteine einer Guild, fuer die Seite.
 *
 * @param {string} guildId Guild
 * @returns {Promise<Array<Object>>} Zeilen
 */
async function alleFuerGuild(guildId) {
    return await db().query(`
        SELECT id, streamer_id, name, art, wert, zahl, angelegt_am, geaendert_am
          FROM streaming_variables
         WHERE guild_id = ?
         ORDER BY name ASC
    `, [String(guildId)]);
}

/**
 * Einen Baustein anlegen.
 *
 * @param {string} guildId Guild
 * @param {number} streamerId Kanal
 * @param {Object} felder Eingaben
 * @param {string|null} [von] Wer
 * @returns {Promise<{ok: boolean, grund?: string}>} Ergebnis
 */
async function anlegen(guildId, streamerId, felder, von = null) {
    const grund = pruefe(felder);
    if (grund) return { ok: false, grund };

    try {
        const art = String(felder.art || 'text') === 'zaehler' ? 'zaehler' : 'text';
        await db().query(`
            INSERT INTO streaming_variables
                   (guild_id, streamer_id, name, art, wert, zahl, angelegt_von)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [String(guildId), Number(streamerId), nameHerrichten(felder.name), art,
            art === 'zaehler' ? '' : String(felder.wert).trim(),
            art === 'zaehler' ? Number(felder.zahl ?? 0) : 0, von]);
        return { ok: true };
    } catch (fehler) {
        // **Am Schluessel, nicht an einer Vorabfrage.** Zwischen "gibt es
        // schon?" und dem Einfuegen liegt Zeit; der eindeutige Schluessel ist
        // der einzige Punkt, an dem die Frage sicher beantwortet ist.
        if (fehler?.code === 'ER_DUP_ENTRY') return { ok: false, grund: 'doppelt' };
        throw fehler;
    }
}

/**
 * Einen Baustein aendern - nur den Wert. Der Name bleibt.
 *
 * **Warum der Name nicht aenderbar ist:** Er steht in Befehlen und Ansagen,
 * die diese Tabelle nicht kennt. Ihn umzubenennen liesse ueberall `{alt}`
 * stehen - woertlich im Chat, ohne dass jemand den Zusammenhang sieht.
 * Umbenennen heisst hier: neu anlegen und die Texte nachziehen.
 *
 * @param {number} id Baustein
 * @param {string} guildId Guild
 * @param {Object} felder Eingaben
 * @returns {Promise<{ok: boolean, grund?: string}>} Ergebnis
 */
async function aendern(id, guildId, felder) {
    // **Die Art kommt aus der Zeile, nicht aus dem Formular.** Sonst koennte
    // ein manipuliertes Formular aus einem Zaehler einen Baustein machen - und
    // der Stand waere weg, ohne dass es jemand wollte.
    const zeilen = await db().query(
        'SELECT art FROM streaming_variables WHERE id = ? AND guild_id = ?',
        [Number(id), String(guildId)]);
    if (!zeilen.length) return { ok: false, grund: 'weg' };

    if (zeilen[0].art === 'zaehler') {
        const zahl = Number(felder?.zahl);
        if (!Number.isInteger(zahl) || zahl < 0 || zahl > 1_000_000_000) {
            return { ok: false, grund: 'zahl' };
        }
        const ergebnis = await db().query(
            'UPDATE streaming_variables SET zahl = ? WHERE id = ? AND guild_id = ?',
            [zahl, Number(id), String(guildId)]);
        return { ok: Boolean(ergebnis?.affectedRows) };
    }

    const wert = String(felder?.wert || '').trim();
    if (!wert) return { ok: false, grund: 'wert' };
    if (wert.length > WERT_MAX) return { ok: false, grund: 'zu_lang' };

    const ergebnis = await db().query(
        'UPDATE streaming_variables SET wert = ? WHERE id = ? AND guild_id = ?',
        [wert, Number(id), String(guildId)]);

    return { ok: Boolean(ergebnis?.affectedRows) };
}

/**
 * Einen Baustein entfernen.
 *
 * @param {number} id Baustein
 * @param {string} guildId Guild
 * @returns {Promise<boolean>} ob etwas entfernt wurde
 */
async function entfernen(id, guildId) {
    const ergebnis = await db().query(
        'DELETE FROM streaming_variables WHERE id = ? AND guild_id = ?',
        [Number(id), String(guildId)]);
    return Boolean(ergebnis?.affectedRows);
}

module.exports = {
    NAME_FORM, WERT_MAX,
    pruefe, nameHerrichten, vergebeneNamen, fremdeNamenIn,
    werteFuer, hochzaehlen, alleFuerGuild, anlegen, aendern, entfernen
};
