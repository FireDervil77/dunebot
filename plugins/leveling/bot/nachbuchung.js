'use strict';

/**
 * Leveling: was nach einer Buchung oder einem Storno im Bot folgt
 * (LV-1b, LV-1d, LV-1e, 2026-11-15). Chat- und Sprach-XP nehmen denselben Weg.
 *
 *   Aufstieg  → `leveling.level.erreicht` (Schlüssel an der Buchung) und
 *               Level-up-Nachricht (`ausgabe.js`, LV-1f)
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
const Ausgabe = require('./ausgabe');

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
 * @param {string|null} [a.kanal] wo die XP entstanden (für „Kanal der Nachricht“, LV-1f)
 */
async function nachBuchung({ guildId, mitglied, ergebnis, guild = null, kanal = null }) {
    if (!ergebnis?.wechsel) return null;
    if (ergebnis.aufstieg && ergebnis.buchung_id) {
        await meldeAufstieg(guildId, mitglied, ergebnis);
        // Level-up-Nachricht nur im Bot; sie darf ausfallen und wirft nie.
        if (guild) await Ausgabe.beiAufstieg({ guild, mitglied, ergebnis, kanal });
    }
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
