'use strict';

/**
 * Musik am Streamende beenden - Lesen, Schreiben und der Ablauf (Baustelle 128).
 *
 * Was entschieden wird, steht in `./musikendeEntscheidung.js`; hier wird nur
 * zusammengesetzt. Bauform wie der Zusatz „Streamserver" (`./serverstopp.js`):
 *
 *   Streamende        vormerken()        Auftrag `musikende` fuer die
 *                                        Heim-Guild, faellig nach dem Nachlauf
 *   Stream beginnt    beiStreambeginn()  wartende Auftraege dieser Guild abbrechen
 *   faellig           ausfuehren()       neu entscheiden, dann `musik.beenden`
 *
 * **Zwei Stellen rufen `vormerken`** (`beendet()` und `nachStreamende()` in
 * `takt.js`), wie beim Streamserver. Ein schon wartender Auftrag wird nicht
 * doppelt angelegt.
 *
 * **Beendet wird ueber `musikwunsch.beenden`** - dieselbe Wirkung wie `!stop`
 * und der Knopf auf der Musikseite: Wiedergabe aus, Liste von vorn, die
 * Warteschlange bleibt. Kein eigener Weg.
 *
 * @module streaming/kern/musikende
 */

const { ServiceManager } = require('dunebot-core');
const entscheidung = require('./musikendeEntscheidung');

const PLUGIN = 'streaming';
const SCHLUESSEL_AN = 'MUSIK_STREAMENDE';
const SCHLUESSEL_NACHLAUF = 'MUSIK_NACHLAUF_MIN';

/** @returns {Object} Datenbankdienst */
const db = () => ServiceManager.get('dbService');

/** @returns {Object} Logger */
const log = () => ServiceManager.get('Logger');

/** Erst beim Gebrauch geladen - die Pruefskripte des Ausgangs laden dieses Modul ohne Musik. */
const musik = () => require('../../shared/musikwunsch');

// =====================================================
// Lesen und Schreiben
// =====================================================

/**
 * @param {string} guildId Guild
 * @returns {Promise<{an: boolean, nachlaufMin: number}>}
 */
async function einstellung(guildId) {
    const [an, nachlauf] = await Promise.all([
        db().getConfig(PLUGIN, SCHLUESSEL_AN, 'shared', guildId),
        db().getConfig(PLUGIN, SCHLUESSEL_NACHLAUF, 'shared', guildId)
    ]);
    return entscheidung.einstellungLesen(an, nachlauf);
}

/**
 * @param {string} guildId Guild
 * @param {{an: boolean, nachlaufMin: number}} werte Gepruefte Werte
 * @returns {Promise<void>}
 */
async function speichern(guildId, werte) {
    await db().setConfig(PLUGIN, SCHLUESSEL_AN, werte.an ? '1' : '0', 'shared', guildId, false);
    await db().setConfig(PLUGIN, SCHLUESSEL_NACHLAUF, String(werte.nachlaufMin), 'shared', guildId, false);
    log().info(`[Streaming/Musikende] Guild ${guildId}: an=${werte.an}, nachlauf=${werte.nachlaufMin} min`);
}

/**
 * Wie viele Kanaele mit dieser Heim-Guild sind gerade live?
 *
 * @param {string} guildId Heim-Guild
 * @returns {Promise<number>}
 */
async function liveInHeim(guildId) {
    const zeilen = await db().query(`
        SELECT COUNT(*) AS anzahl
          FROM streaming_streamers s
          JOIN streaming_state z ON z.streamer_id = s.id
         WHERE s.heim_guild_id = ? AND z.ist_live = 1
    `, [guildId]);
    return Number(zeilen?.[0]?.anzahl || 0);
}

/**
 * Laeuft Musik? Liest nur - `musikwunsch.zustand` legte eine Zeile an.
 *
 * @param {string} guildId Guild
 * @returns {Promise<boolean>}
 */
async function musikAktiv(guildId) {
    const zeilen = await db().query(
        'SELECT aktiv FROM streaming_music_state WHERE guild_id = ? LIMIT 1', [guildId]);
    return Number(zeilen?.[0]?.aktiv || 0) === 1;
}

/**
 * Der letzte Auftrag dieser Guild - fuer die Zeile „Zuletzt" auf der Musikseite.
 *
 * @param {string} guildId Guild
 * @returns {Promise<Object|null>}
 */
async function letzter(guildId) {
    const zeilen = await db().query(`
        SELECT id, zustand, fehlertext, faellig_ab, erledigt_am
          FROM streaming_outbox
         WHERE aktion = 'musikende' AND guild_id = ?
         ORDER BY id DESC LIMIT 1
    `, [guildId]);
    return zeilen?.[0] || null;
}

/**
 * @param {number} streamerId Streamer
 * @returns {Promise<{login: string|null, guildId: string|null}>}
 */
async function heimVon(streamerId) {
    const zeilen = await db().query(
        'SELECT id, login, heim_guild_id FROM streaming_streamers WHERE id = ?', [streamerId]);
    const s = zeilen?.[0];
    return { login: s?.login || null, guildId: s?.heim_guild_id ? String(s.heim_guild_id) : null };
}

// =====================================================
// Der Ablauf
// =====================================================

/**
 * Nach einem Streamende: das Beenden der Musik in der Heim-Guild vormerken.
 *
 * @param {number} streamerId Streamer, dessen Stream endete
 * @returns {Promise<number>} 1 wenn vorgemerkt, sonst 0
 */
async function vormerken(streamerId) {
    const { login, guildId } = await heimVon(streamerId);
    if (!guildId) return 0;

    const [e, live, aktiv] = await Promise.all([einstellung(guildId), liveInHeim(guildId), musikAktiv(guildId)]);
    const wahl = entscheidung.beimStreamende({ heimGuild: guildId, einstellung: e, liveInHeim: live, musikAktiv: aktiv });
    if (!wahl.vormerken) return 0;

    const wartend = await db().query(`
        SELECT id FROM streaming_outbox
         WHERE aktion = 'musikende' AND zustand = 'offen' AND guild_id = ?
         LIMIT 1
    `, [guildId]);
    if (wartend && wartend.length) return 0;

    await db().query(`
        INSERT INTO streaming_outbox (target_id, guild_id, aktion, nutzlast, faellig_ab)
        VALUES (NULL, ?, 'musikende', ?, DATE_ADD(NOW(3), INTERVAL ? MINUTE))
    `, [guildId, JSON.stringify({ streamer_id: Number(streamerId), login, nachlauf_min: e.nachlaufMin }), e.nachlaufMin]);

    log().info(`[Streaming/Musikende] Guild ${guildId}: ${login} offline, Musik endet in ${e.nachlaufMin} min`);
    return 1;
}

/**
 * Ein Kanal dieser Heim-Guild ist wieder live: wartendes Beenden abbrechen.
 *
 * Die Entscheidung beim Faelligwerden faende ihn ohnehin live - der Abbruch
 * steht hier, damit „Zuletzt" auf der Musikseite nicht bis zum Ablauf
 * „wartet" behauptet.
 *
 * @param {number} streamerId Streamer, der live ging
 * @returns {Promise<number>} Anzahl abgebrochener Auftraege
 */
async function beiStreambeginn(streamerId) {
    const { login, guildId } = await heimVon(streamerId);
    if (!guildId) return 0;

    const ergebnis = await db().query(`
        UPDATE streaming_outbox
           SET zustand = 'fertig', erledigt_am = NOW(3), fehlertext = ?
         WHERE aktion = 'musikende' AND zustand = 'offen' AND guild_id = ?
    `, [`Abgebrochen: ${login || 'ein Kanal'} ist wieder live`, guildId]);

    const anzahl = Number(ergebnis?.affectedRows || 0);
    if (anzahl) log().info(`[Streaming/Musikende] Guild ${guildId}: abgebrochen, ${login} ist wieder live`);
    return anzahl;
}

/**
 * Faelliges Beenden ausfuehren - fuer den Ausgang (`ausgabe/drossel.js`).
 *
 * @param {Object} auftrag Zeile aus streaming_outbox
 * @returns {Promise<{ok: boolean, fehler: string|null, endgueltig: boolean, hinweis: string}>}
 */
async function ausfuehren(auftrag) {
    const guildId = String(auftrag.guild_id);
    const [e, live, aktiv] = await Promise.all([einstellung(guildId), liveInHeim(guildId), musikAktiv(guildId)]);
    const wahl = entscheidung.beimFaelligwerden({ einstellung: e, liveInHeim: live, musikAktiv: aktiv });
    const klartext = entscheidung.grundKlartext(wahl.grund);

    if (wahl.handlung === 'beenden') {
        await musik().beenden(guildId);
        log().info(`[Streaming/Musikende] Guild ${guildId}: Musik beendet — ${klartext}`);
        return { ok: true, fehler: null, endgueltig: true, hinweis: `Beendet: ${klartext}` };
    }

    log().info(`[Streaming/Musikende] Guild ${guildId}: nicht beendet — ${klartext}`);
    return { ok: true, fehler: null, endgueltig: true, hinweis: `Abgebrochen: ${klartext}` };
}

module.exports = {
    SCHLUESSEL_AN, SCHLUESSEL_NACHLAUF,
    einstellung, speichern, letzter,
    vormerken, beiStreambeginn, ausfuehren
};
