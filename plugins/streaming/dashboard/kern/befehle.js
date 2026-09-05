'use strict';

/**
 * Der Befehlsbaukasten (Stufe 15).
 *
 * ## Was hier passiert — und was ausdruecklich nicht
 *
 * Der Auswerter bekommt eine Chatnachricht, sieht nach, ob sie mit einem
 * bekannten Wort beginnt, und schickt eine Antwort. **Er speichert nichts
 * davon.** Weder Text noch Absender verlassen diesen Aufruf; `streaming_commands`
 * hat fuer beides keine Spalte. Was bleibt, ist eine Summe ohne Person
 * (`benutzt_anzahl`) — sie beantwortet „lohnt der Befehl?", nicht „wer hat
 * gefragt?".
 *
 * Damit erledigt sich die Sperre, die auf der Entwurfsseite stand („erst die
 * Rechtsfrage"): Zwischen Twitch und dem Streamer besteht die Autorisierung
 * bereits, und die Frage, die die Sperre wirklich schuetzte — das Aufbewahren —
 * stellt sich hier nicht.
 *
 * ## Zwei Sorten, und die Grenze dazwischen ist scharf
 *
 * **Fertige Befehle** beantwortet die Anlage aus dem, was sie ohnehin weiss:
 * wie lange der Stream laeuft, was gespielt wird, welche Befehle es gibt. Sie
 * brauchen keine Eingabe.
 *
 * **Eigene Befehle** antworten mit dem Text des Streamers.
 *
 * `!discord` ist bewusst KEIN fertiger Befehl, obwohl er auf jeder Liste
 * steht: Die Anlage kennt die Einladungsadresse einer Guild nicht, und sie zu
 * erfinden waere schlimmer als sie wegzulassen. Er ist ein eigener Befehl mit
 * vorgeschlagenem Wort — der Streamer setzt seinen Link ein. „Alles andere
 * kommt vom Streamer."
 *
 * @module streaming/kern/befehle
 */

const { ServiceManager } = require('dunebot-core');

/** Genau ein Zeichen, und es steht hier statt in jeder Zeile. */
const PRAEFIX = '!';

/**
 * Die fertigen Befehle.
 *
 * Der Schluessel ist das Wort, `antwort` eine Funktion ueber den Zustand.
 * Wer einen neuen fertigen Befehl will, schreibt ihn hier hin — und
 * `scripts/check-streaming-befehle.js` haelt Liste und Ansicht zusammen.
 */
const FERTIG = {
    uptime: {
        beschreibung: 'Wie lange der Stream schon läuft.',
        antwort: (k) => k.live
            ? `${k.streamer} ist seit ${dauerText(k.seitMs)} live.`
            : `${k.streamer} ist gerade nicht live.`
    },
    spiel: {
        beschreibung: 'Titel und Kategorie des laufenden Streams.',
        antwort: (k) => !k.live ? `${k.streamer} ist gerade nicht live.`
            : (k.kategorie ? `${k.kategorie} — ${k.titel || 'ohne Titel'}`
                           : (k.titel || 'Titel und Kategorie sind nicht gesetzt.'))
    },
    befehle: {
        beschreibung: 'Zählt auf, welche Befehle es hier gibt.',
        antwort: (k) => k.woerter.length
            ? `Verfügbar: ${k.woerter.map(w => PRAEFIX + w).join(' ')}`
            : 'Hier sind noch keine Befehle eingerichtet.'
    }
};

/** Wer einen Befehl benutzen darf — von eng nach weit. */
const RANG = { inhaber: 3, moderator: 2, abonnent: 1, alle: 0 };

/**
 * Abkuehlung im Arbeitsspeicher, je Befehlszeile.
 *
 * **Nicht in der Datenbank.** Eine Abkuehlung von fuenf Sekunden ist keine
 * Auskunft, die einen Neustart ueberleben muss — und ein Schreibvorgang je
 * Chatnachricht waere der teuerste Weg, den billigsten Wert zu merken.
 */
const zuletzt = new Map();

/** @returns {Object} Datenbankdienst */
function db() {
    return ServiceManager.get('dbService');
}

/** @returns {Object} Protokoll */
function log() {
    return ServiceManager.get('Logger');
}

/**
 * Eine Dauer als Satzteil.
 *
 * @param {number} ms Millisekunden
 * @returns {string} etwa "2 Stunden 14 Minuten"
 */
function dauerText(ms) {
    const min = Math.max(0, Math.floor(Number(ms) / 60000));
    const std = Math.floor(min / 60);
    const rest = min % 60;
    if (std && rest) return `${std} Stunde${std === 1 ? '' : 'n'} ${rest} Minute${rest === 1 ? '' : 'n'}`;
    if (std) return `${std} Stunde${std === 1 ? '' : 'n'}`;
    return `${rest} Minute${rest === 1 ? '' : 'n'}`;
}

/**
 * Das Wort aus einer Nachricht holen.
 *
 * Gibt `null` zurueck, wenn es keiner ist — der haeufigste Fall, und er muss
 * billig sein: Bei jeder Chatnachricht laeuft diese Funktion.
 *
 * @param {string} text Nachrichtentext
 * @returns {{wort: string, rest: string}|null} Wort ohne Praefix
 */
function zerlegen(text) {
    const roh = String(text || '').trim();
    if (!roh.startsWith(PRAEFIX) || roh.length < 2) return null;

    const ohne = roh.slice(PRAEFIX.length);
    const luecke = ohne.search(/\s/);
    const wort = (luecke === -1 ? ohne : ohne.slice(0, luecke)).toLowerCase();

    // Ein Wort aus Sonderzeichen ist keines. Ohne diese Pruefung wuerde "!!!"
    // zu einer Suche nach dem Befehl "!!".
    if (!/^[a-z0-9_-]{1,32}$/.test(wort)) return null;

    return { wort, rest: luecke === -1 ? '' : ohne.slice(luecke).trim() };
}

/**
 * Darf dieser Absender den Befehl benutzen?
 *
 * @param {string} wer Verlangter Rang
 * @param {Object} kanal Uebersetzte Chatnachricht
 * @returns {boolean} true, wenn erlaubt
 */
function darf(wer, kanal) {
    const verlangt = RANG[String(wer || 'alle')] ?? 0;
    if (verlangt === 0) return true;

    // Der Kanalinhaber darf immer alles — er ist der Rang darueber, nicht ein
    // Sonderfall daneben.
    const hat = kanal.istInhaber ? RANG.inhaber
        : kanal.istModerator ? RANG.moderator
        : kanal.istAbonnent ? RANG.abonnent
        : RANG.alle;
    return hat >= verlangt;
}

/**
 * Platzhalter in einer eigenen Antwort fuellen.
 *
 * Unbekannte Platzhalter bleiben **stehen**. Sie leer zu ersetzen saehe aus wie
 * ein Tippfehler des Streamers — so sieht er, dass er einen erfunden hat.
 *
 * @param {string} vorlage Text des Streamers
 * @param {Object} k Kontext
 * @returns {string} gefuellter Text
 */
function fuellen(vorlage, k) {
    // **Was nur waehrend des Streams gilt, verschwindet danach.** `{spiel}` und
    // `{titel}` kamen bis zum 2026-09-05 unbesehen aus `streaming_state` - und
    // die Tabelle behaelt den letzten Stand, sie leert ihn nicht. Wer offline
    // einen Befehl tippte, las die Kategorie von gestern als die von jetzt.
    //
    // Das ist die Sorte Auskunft, die schlimmer ist als keine: Sie sieht
    // richtig aus. Der fertige `!spiel` fragt `live` seit jeher ab, `{uptime}`
    // auch - nur diese beiden nicht. Zwei Wege, eine Frage, verschiedene
    // Antwort; dieselbe Naht wie zwischen `gewuenschteArten` und `zieleFuer`.
    //
    // Leer statt falsch: Ein `Ich spiele {spiel}` liest sich offline dann
    // unfertig. Das sieht der Streamer und kann es aendern - eine erfundene
    // Kategorie sieht niemand.
    const imStream = (wert) => (k.live ? (wert || '') : '');

    return String(vorlage || '')
        .replace(/\{streamer\}/g, k.streamer || '')
        .replace(/\{absender\}/g, k.absender || '')
        .replace(/\{spiel\}/g,    imStream(k.kategorie))
        .replace(/\{titel\}/g,    imStream(k.titel))
        .replace(/\{uptime\}/g,   imStream(dauerText(k.seitMs)));
}

/**
 * Die Befehle eines Kanals holen.
 *
 * `streamer_id IS NULL` heisst „gilt fuer jeden Kanal dieser Guild" — die
 * Zeile mit Kanal gewinnt, wenn es beide gibt.
 *
 * @param {string} guildId Discord-Guild-ID
 * @param {number} streamerId Streamer
 * @returns {Promise<Array<Object>>} Zeilen
 */
async function befehleFuer(guildId, streamerId) {
    return await db().query(`
        SELECT id, wort, art, antwort, wer, abkuehlung_s
          FROM streaming_commands
         WHERE guild_id = ? AND aktiv = 1 AND (streamer_id = ? OR streamer_id IS NULL)
         ORDER BY streamer_id IS NULL ASC
    `, [guildId, streamerId]);
}

/**
 * Eine Chatnachricht auswerten und, wenn es ein Befehl war, antworten.
 *
 * **Der Rueckgabewert ist eine Auskunft, kein Erfolg.** Wer hier `null`
 * bekommt, hat keine Nachricht verpasst — es war schlicht kein Befehl. Alles
 * andere ist ein Satz fuer das Protokoll.
 *
 * @param {Object} kanal Uebersetzte Chatnachricht aus `twitch.chatAus`
 * @returns {Promise<string|null>} Was geschah, oder null
 */
async function auswerten(kanal) {
    if (!kanal || !kanal.text) return null;

    const zerlegt = zerlegen(kanal.text);
    if (!zerlegt) return null;

    // Erst jetzt wird die Datenbank gefragt. Bei jeder Chatnachricht eine
    // Abfrage waere der Preis dafuer, dass jemand "hallo" schreibt.
    const streamer = (await db().query(
        // `s.plattform` sieht ueberfluessig aus - der Chat kommt schliesslich
        // von Twitch. Es ist aber der Parameter, mit dem `kanalInhaber` sucht,
        // und eine fehlende Spalte ist in JS kein Fehler, sondern `undefined`.
        // Am 2026-09-05 hat mysql2 daran den ersten echten `!uptime` zerlegt.
        `SELECT s.id, s.plattform, s.login, s.anzeigename, s.kanal_id, s.heim_guild_id,
                z.ist_live, z.titel, z.kategorie, z.begonnen_am
           FROM streaming_streamers s
           LEFT JOIN streaming_state z ON z.streamer_id = s.id
          WHERE s.kanal_id = ?`, [String(kanal.kanalId)]))[0];

    if (!streamer) return null;
    if (!streamer.heim_guild_id) {
        // Ohne Heim-Guild gibt es keinen Ort, an dem Befehle eingerichtet
        // waeren. Das ist kein Fehler, sondern ein Kanal, der das nicht nutzt.
        return null;
    }

    const zeilen = await befehleFuer(String(streamer.heim_guild_id), streamer.id);
    const zeile = zeilen.find(z => z.wort === zerlegt.wort);
    if (!zeile) return null;

    if (!darf(zeile.wer, kanal)) {
        // **Keine Antwort im Chat.** Wer nicht darf, bekommt keine Belehrung —
        // das ist die Bauform aller Chatbots, und sie verhindert, dass ein
        // Fremder den Chat mit Absagen fluten kann.
        return `${PRAEFIX}${zeile.wort}: nicht erlaubt fuer diesen Absender`;
    }

    const jetzt = Date.now();
    const letzte = zuletzt.get(zeile.id) || 0;
    const kuehl = Math.max(0, Number(zeile.abkuehlung_s) || 0) * 1000;
    if (jetzt - letzte < kuehl) return `${PRAEFIX}${zeile.wort}: noch in der Abkuehlung`;

    const kontext = {
        streamer: streamer.anzeigename || streamer.login,
        absender: kanal.absender,
        live: Boolean(streamer.ist_live),
        titel: streamer.titel,
        kategorie: streamer.kategorie,
        seitMs: streamer.begonnen_am ? jetzt - new Date(streamer.begonnen_am).getTime() : 0,
        woerter: zeilen.map(z => z.wort)
    };

    const text = zeile.art === 'fertig'
        ? (FERTIG[zeile.wort] ? FERTIG[zeile.wort].antwort(kontext) : null)
        : fuellen(zeile.antwort, kontext);

    // Ein leerer Satz ist kein Satz — dieselbe Regel wie bei der Live-Ansage.
    // Twitch wiese ihn ab, und der Fehlertext waere kryptisch.
    if (!text || !String(text).trim()) {
        return `${PRAEFIX}${zeile.wort}: die Antwort ist leer`;
    }

    // Die Abkuehlung greift ab dem Versuch, nicht ab dem Erfolg. Sonst
    // koennte ein dauerhaft fehlschlagender Befehl beliebig oft anlaufen.
    zuletzt.set(zeile.id, jetzt);

    const gesendet = await senden(streamer, String(text).slice(0, 500));

    // Summe ohne Person. Sie steht bewusst NACH dem Senden: Ein Befehl, der
    // nicht hinausging, wurde nicht benutzt.
    if (gesendet.ok) {
        await db().query(
            `UPDATE streaming_commands
                SET benutzt_anzahl = benutzt_anzahl + 1, benutzt_am = NOW(3)
              WHERE id = ?`, [zeile.id]);
    }

    return `${PRAEFIX}${zeile.wort}: ${gesendet.ok ? 'beantwortet' : gesendet.grund}`;
}

/**
 * Die Antwort unter dem Namen des Streamers in seinen Chat schreiben.
 *
 * Derselbe Weg wie die Live-Ansage: Der Schluessel gehoert dem Kanalinhaber,
 * `mitZugang` entschluesselt, erneuert bei 401 und vermerkt einen Widerruf.
 *
 * @param {Object} streamer Zeile aus `streaming_streamers`
 * @param {string} text Antwort
 * @returns {Promise<{ok: boolean, grund: string|null}>} Ergebnis
 */
async function senden(streamer, text) {
    const twitch = require('../plattformen/twitch');
    const abonnenten = require('./abonnenten');
    const Verbindungsspeicher = require('../../../../apps/dashboard/helpers/Verbindungsspeicher');

    const inhaber = await abonnenten.kanalInhaber(streamer);
    if (!inhaber) return { ok: false, grund: 'kein verknuepfter Kanalinhaber' };

    const ergebnis = await Verbindungsspeicher.mitZugang(
        { userId: inhaber, plattform: 'twitch' },
        (zugang) => twitch.chatSenden(streamer.kanal_id, text, zugang));

    // `null` heisst: gar keine Zusage mehr. Das ist ein Widerruf und liest sich
    // als Entscheidung des Streamers, nicht als Stoerung.
    if (!ergebnis) return { ok: false, grund: 'Schreiben unter dem eigenen Namen ist nicht (mehr) erlaubt' };
    if (!ergebnis.ok) return { ok: false, grund: ergebnis.grund || 'Twitch hat abgelehnt' };
    return { ok: true, grund: null };
}

// =====================================================
// Verwaltung — was die Seite braucht
// =====================================================
//
// **Die Guild-Kennung steht in JEDER Abfrage**, auch bei `id`-Zugriffen. Eine
// Kennung aus der Adresse ist eine Behauptung des Aufrufers; ohne das `AND
// guild_id = ?` koennte eine Guild die Befehle einer anderen aendern, und die
// Rechtepruefung am Router saehe trotzdem richtig aus.

/**
 * Alle Befehle einer Guild — auch die abgeschalteten.
 *
 * @param {string} guildId Discord-Guild-ID
 * @returns {Promise<Array<Object>>} Zeilen
 */
async function alleFuerGuild(guildId) {
    return await db().query(
        `SELECT id, streamer_id, wort, art, antwort, wer, abkuehlung_s, aktiv,
                benutzt_anzahl, benutzt_am
           FROM streaming_commands
          WHERE guild_id = ?
          ORDER BY art DESC, wort ASC`, [guildId]);
}

/**
 * Einen eigenen Befehl anlegen.
 *
 * @param {string} guildId Discord-Guild-ID
 * @param {number|null} streamerId Kanal, oder null fuer alle der Guild
 * @param {Object} f Felder
 * @param {string} userId Wer ihn anlegt
 * @returns {Promise<{ok: boolean, grund: string|null}>} Ergebnis
 */
async function anlegen(guildId, streamerId, f, userId) {
    const wort = String(f.wort || '').trim().replace(/^!+/, '').toLowerCase();
    if (!/^[a-z0-9_-]{1,32}$/.test(wort)) {
        return { ok: false, grund: 'wort' };
    }
    if (FERTIG[wort]) {
        // Ein eigener Befehl darf nicht heissen wie ein fertiger — sonst
        // entschiede die Sortierung, welcher antwortet.
        return { ok: false, grund: 'belegt' };
    }
    if (!String(f.antwort || '').trim()) return { ok: false, grund: 'antwort' };

    try {
        await db().query(
            `INSERT INTO streaming_commands
               (guild_id, streamer_id, wort, art, antwort, wer, abkuehlung_s, angelegt_von)
             VALUES (?, ?, ?, 'eigen', ?, ?, ?, ?)`,
            [guildId, streamerId, wort, String(f.antwort).slice(0, 500),
             RANG[f.wer] === undefined ? 'alle' : f.wer,
             Math.max(0, Math.min(3600, Number(f.abkuehlung_s) || 0)), userId || null]);
        return { ok: true, grund: null };
    } catch (err) {
        // Der eindeutige Schluessel ist die Wahrheit, nicht eine Vorabfrage:
        // Zwischen "gibt es schon?" und `INSERT` passt ein zweiter Aufruf.
        if (String(err?.code) === 'ER_DUP_ENTRY') return { ok: false, grund: 'doppelt' };
        throw err;
    }
}

/**
 * Einen Befehl aendern.
 *
 * Das Wort bleibt, wie es ist — es umzubenennen waere ein anderer Befehl, und
 * die Zuschauer haetten den alten im Kopf. Wer ihn anders nennen will, legt
 * einen neuen an.
 *
 * @param {number} id Befehl
 * @param {string} guildId Discord-Guild-ID
 * @param {Object} f Felder
 * @returns {Promise<boolean>} true, wenn eine Zeile getroffen wurde
 */
async function aendern(id, guildId, f) {
    const ergebnis = await db().query(
        `UPDATE streaming_commands
            SET antwort = ?, wer = ?, abkuehlung_s = ?, aktiv = ?
          WHERE id = ? AND guild_id = ?`,
        [f.antwort === undefined ? null : String(f.antwort).slice(0, 500),
         RANG[f.wer] === undefined ? 'alle' : f.wer,
         Math.max(0, Math.min(3600, Number(f.abkuehlung_s) || 0)),
         f.aktiv ? 1 : 0, Number(id), guildId]);
    return Boolean(ergebnis?.affectedRows);
}

/**
 * Einen Befehl entfernen.
 *
 * @param {number} id Befehl
 * @param {string} guildId Discord-Guild-ID
 * @returns {Promise<boolean>} true, wenn eine Zeile getroffen wurde
 */
async function entfernen(id, guildId) {
    const ergebnis = await db().query(
        'DELETE FROM streaming_commands WHERE id = ? AND guild_id = ?', [Number(id), guildId]);
    return Boolean(ergebnis?.affectedRows);
}

/**
 * Die fertigen Befehle einer Guild auf eine Auswahl bringen.
 *
 * **Abwaehlen schaltet ab, es loescht nicht.** Ein fertiger Befehl traegt keine
 * Eingabe des Streamers, aber seine Benutzungszahl — und die ist eine Auskunft,
 * die beim Wiedereinschalten nicht bei null anfangen soll.
 *
 * @param {string} guildId Discord-Guild-ID
 * @param {number|null} streamerId Kanal
 * @param {Array<string>} gewaehlt Worte
 * @returns {Promise<void>}
 */
async function fertigSetzen(guildId, streamerId, gewaehlt) {
    const will = new Set((gewaehlt || []).filter(w => FERTIG[w]));

    for (const wort of Object.keys(FERTIG)) {
        const an = will.has(wort) ? 1 : 0;
        await db().query(
            `INSERT INTO streaming_commands (guild_id, streamer_id, wort, art, aktiv)
             VALUES (?, ?, ?, 'fertig', ?)
             ON DUPLICATE KEY UPDATE aktiv = VALUES(aktiv), art = 'fertig'`,
            [guildId, streamerId, wort, an]);
    }
}

module.exports = {
    PRAEFIX, FERTIG, RANG,
    alleFuerGuild, anlegen, aendern, entfernen, fertigSetzen,
    zerlegen, darf, fuellen, dauerText,
    befehleFuer, auswerten
};
