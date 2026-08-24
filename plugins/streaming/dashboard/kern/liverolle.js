'use strict';

/**
 * Streaming - der Abgleich der Live-Rolle.
 *
 * **Wozu das ueberhaupt noetig ist:** Die Rolle wird beim Livegehen vergeben
 * und beim Streamende genommen. Faellt das Dashboard dazwischen aus, fehlt das
 * Nehmen — und jemand traegt „ist live", bis es jemandem auffaellt. Das ist
 * derselbe stille Fehler wie ein verlorenes `stream.offline`, nur sichtbarer:
 * Die Rolle steht in der Mitgliederliste.
 *
 * Deshalb einmal am Tag und einmal nach dem Start die Gegenfrage: **Wer traegt
 * die Rolle, und wer sollte sie tragen?**
 *
 * Die Entscheidung selbst ist eine reine Funktion (`vergleichen`), damit sie
 * ohne Discord und ohne Datenbank durchgespielt werden kann.
 *
 * **Hier steht nur das Urteil, nicht die Ausfuehrung.** Wer den Bot fragen
 * muss, gehoert in `ausgabe/` - siehe `ausgabe/liverolle.js`. Der Kern redet
 * mit niemandem.
 *
 * @module streaming/dashboard/kern/liverolle
 */

const { ServiceManager } = require('dunebot-core');

/** @returns {Object} Datenbankdienst */
function db() {
    return ServiceManager.get('dbService');
}

/** @returns {Object} Logger */
function log() {
    return ServiceManager.get('Logger');
}

/**
 * **Die Entscheidung, getrennt von der Ausfuehrung.**
 *
 * @param {Array<string>} traeger Wer die Rolle jetzt hat
 * @param {Array<string>} sollen Wer sie haben sollte
 * @returns {{geben: Array<string>, nehmen: Array<string>}} was zu tun ist
 */
function vergleichen(traeger, sollen) {
    // Ueber Mengen, nicht ueber Schleifen: Discord liefert Zeichenketten,
    // unsere Spalte auch - aber ein `Number` an einer Stelle wuerde den
    // Vergleich lautlos immer falsch machen. Deshalb ueberall `String`.
    const hat  = new Set((traeger || []).map(String));
    const soll = new Set((sollen  || []).map(String));

    return {
        geben:  [...soll].filter(id => !hat.has(id)),
        nehmen: [...hat].filter(id => !soll.has(id))
    };
}

/**
 * Welche Guilds haben eine Live-Rolle eingestellt?
 *
 * Direkt gegen `configs`, nicht je Guild einzeln gefragt: Es geht um alle auf
 * einmal, und das ist eine Abfrage statt zweihundert.
 *
 * @returns {Promise<Array<{guild_id: string, rolle_id: string}>>} Guilds mit Rolle
 */
async function guildsMitRolle() {
    const zeilen = await db().query(`
        SELECT guild_id, config_value
          FROM configs
         WHERE plugin_name = 'streaming' AND config_key = 'LIVE_ROLLE_ID'
           AND guild_id IS NOT NULL AND guild_id <> ''
           AND config_value IS NOT NULL AND config_value <> ''
    `);
    return zeilen.map(z => ({ guild_id: z.guild_id, rolle_id: String(z.config_value).trim() }))
                 .filter(z => z.rolle_id);
}

/**
 * Wer sollte in dieser Guild die Rolle tragen?
 *
 * @param {string} guildId Discord-Guild-ID
 * @returns {Promise<Array<string>>} Mitglieder-IDs
 */
async function sollTraeger(guildId) {
    const zeilen = await db().query(`
        SELECT DISTINCT t.mitglied_id
          FROM streaming_targets t
          JOIN streaming_state z ON z.streamer_id = t.streamer_id
         WHERE t.guild_id = ? AND t.aktiv = 1
           AND t.mitglied_id IS NOT NULL
           AND z.ist_live = 1
    `, [guildId]);
    return zeilen.map(z => String(z.mitglied_id));
}

module.exports = { vergleichen, guildsMitRolle, sollTraeger };
