'use strict';

/**
 * Streaming - der Rollenabgleich, Ausfuehrungsseite.
 *
 * Das Urteil faellt in `kern/liverolle.js`; hier wird der Bot gefragt und der
 * Ausgang beschrieben. Die Trennung ist nicht Formsache: `kern/` redet mit
 * niemandem, und `scripts/check-streaming-schichten.js` haelt das fest.
 *
 * @module streaming/dashboard/ausgabe/liverolle
 */

const { ServiceManager } = require('dunebot-core');
const urteil = require('../kern/liverolle');

/** @returns {Object} Datenbankdienst */
function db() {
    return ServiceManager.get('dbService');
}

/** @returns {Object} Logger */
function log() {
    return ServiceManager.get('Logger');
}

/**
 * Ein Lauf ueber alle Guilds mit Live-Rolle.
 *
 * @param {Object} [optionen] Optionen
 * @param {boolean} [optionen.trocken=false] nur zeigen
 * @returns {Promise<Object>} Bericht
 */
async function lauf({ trocken = false } = {}) {
    const bericht = { gelaufen_am: new Date().toISOString(), trocken, guilds: 0, geben: 0, nehmen: 0, fehler: [] };

    const guilds = await urteil.guildsMitRolle();
    bericht.guilds = guilds.length;
    if (!guilds.length) return bericht;

    const { fragBot } = require('../routes/_shared');

    for (const g of guilds) {
        let antwort;
        try {
            antwort = await fragBot('streaming:roleHolders', { guildId: g.guild_id, roleId: g.rolle_id });
        } catch (err) {
            bericht.fehler.push({ guild_id: g.guild_id, grund: err.message });
            continue;
        }

        // **Keine Antwort heisst nicht „niemand traegt die Rolle".** Wuerde man
        // das so lesen, vergaebe der Lauf die Rolle bei jedem Ausfall des Bots
        // an alle Live-Streamer neu - und naehme sie niemandem. Also
        // ueberspringen, nicht handeln.
        const nutzlast = antwort?.data ?? antwort;
        if (!nutzlast || nutzlast.success === false || !Array.isArray(nutzlast.traeger)) {
            bericht.fehler.push({ guild_id: g.guild_id, grund: nutzlast?.error || 'keine brauchbare Antwort' });
            continue;
        }

        const entscheidung = urteil.vergleichen(
            nutzlast.traeger,
            await urteil.sollTraeger(g.guild_id),
            await urteil.vergebene(g.guild_id, g.rolle_id));
        bericht.geben += entscheidung.geben.length;
        bericht.nehmen += entscheidung.nehmen.length;

        if (trocken || (!entscheidung.geben.length && !entscheidung.nehmen.length)) continue;

        for (const [richtung, ids] of [['geben', entscheidung.geben], ['nehmen', entscheidung.nehmen]]) {
            for (const mitgliedId of ids) {
                await db().query(`
                    INSERT INTO streaming_outbox (guild_id, aktion, nutzlast)
                    VALUES (?, ?, ?)
                `, [g.guild_id, `rolle_${richtung}`,
                    JSON.stringify({ mitglied_id: mitgliedId, rolle_id: g.rolle_id })]);
            }
        }

        log().info(`[Streaming/Live-Rolle] Guild ${g.guild_id}: ${entscheidung.geben.length} geben, ${entscheidung.nehmen.length} nehmen`);
    }

    return bericht;
}

module.exports = { lauf };
