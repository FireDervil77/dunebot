'use strict';

/**
 * Leveling: was nach einer Buchung oder einem Storno im Bot folgt
 * (LV-1b, LV-1d, LV-1e, 2026-11-15). Chat- und Sprach-XP nehmen denselben Weg.
 *
 *   Aufstieg  → `leveling.level.erreicht` (Schlüssel an der Buchung)
 *   Wechsel   → Belohnungen angleichen (auch beim Abstieg durch Storno)
 *
 * Scheitert die Nacharbeit, bleibt die Buchung; der Fehler steht im Log,
 * `/levels sync` holt die Rollen nach.
 *
 * @module leveling/bot/nachbuchung
 */

const { ServiceManager } = require('dunebot-core');
const { Ereignisse } = require('dunebot-sdk');
const { KENNUNG } = require('../shared/vorgaben');
const Belohnungen = require('../shared/belohnungen');

const log = () => ServiceManager.get('Logger');

/** `leveling.level.erreicht`; der Schlüssel hängt an der Buchung, die den Aufstieg brachte. */
async function meldeAufstieg(guildId, mitglied, e) {
    try {
        await Ereignisse.melde('leveling.level.erreicht', {
            guild_id: guildId,
            schluessel: `leveling:aufstieg:${e.buchung_id}`,
            akteur: 'system',
            betroffen: mitglied,
            daten: { fortschritt: KENNUNG, stufe: e.level, vorher: e.vorher.level },
        });
    } catch (error) {
        log().error('[Leveling] leveling.level.erreicht nicht gemeldet:', error);
    }
}

/**
 * @param {object} a
 * @param {string} a.guildId
 * @param {string} a.mitglied
 * @param {object} a.ergebnis aus `Fortschritt.buche` oder `Fortschritt.storniere`
 * @param {import('discord.js').Guild} [a.guild] im Bot, sonst geht `Rollen` über IPC
 */
async function nachBuchung({ guildId, mitglied, ergebnis, guild = null }) {
    if (!ergebnis?.wechsel) return null;
    if (ergebnis.aufstieg && ergebnis.buchung_id) await meldeAufstieg(guildId, mitglied, ergebnis);
    try {
        return await Belohnungen.gleicheAb({
            guildId, mitglied, level: ergebnis.level, prestige: ergebnis.prestige, guild,
            hoechste: ergebnis.hoechste,
            schluessel: ergebnis.buchung_id ? `leveling:belohnung:${ergebnis.buchung_id}` : null,
        });
    } catch (error) {
        log().error(`[Leveling] Belohnungen für ${mitglied} in ${guildId} nicht angeglichen:`, error);
        return null;
    }
}

module.exports = { nachBuchung, meldeAufstieg };
