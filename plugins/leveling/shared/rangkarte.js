'use strict';

/**
 * Leveling: Rangkarte (LV-1g, LV-1f, 2026-11-15).
 *
 * Gezeichnet wird die Schablone des Kerns `kern:rangkarte` (G-10) über
 * `Bildkarte.zeichneNutzung('leveling', 'kern:rangkarte', …)`. Aussehen
 * (Schablone, Hintergrundbild) stellt die Guild nur im Kern-Bereich
 * „Bildkarten“ ein (G-22); erklärt in der package.json unter `bildkarten`
 * samt drei eigenen Schablonen (`plugins/leveling/bildkarten/rang-*.json`,
 * LV-2a). Gibt die Guild es frei, wählen Mitglieder Schablone und
 * Akzentfarbe ihrer eigenen Karte (LV-2b, `/levels style`, Profilseite);
 * `zeichneNutzung` beachtet das von selbst. Hier stehen nur die Laufzeitwerte.
 *
 * `/rank` und die Level-up-Nachricht (mit „Rangkarte anhängen“) zeichnen
 * dieselbe Karte.
 *
 * @module leveling/shared/rangkarte
 */

const { KENNUNG } = require('./vorgaben');

const KARTE = 'kern:rangkarte';

/**
 * Laufzeitwerte der Karte aus einem Stand (`Fortschritt.stand` oder
 * `Fortschritt.buche`). Der Balken zeigt den Weg von der erreichten zur
 * nächsten Stufe; auf der höchsten Stufe ist er voll.
 *
 * @param {{xp: number, level: number, stufe: object|null, naechste: object|null}} s
 * @param {{platz?: number|null, system: string}} a
 * @returns {Object<string, string|string[]>}
 */
function werte(s, { platz = null, system }) {
    const xp = Number(s?.xp || 0);
    const ab = Number(s?.stufe?.schwelle || 0);
    const bis = s?.naechste ? Number(s.naechste.schwelle) : null;
    const imLevel = Math.max(0, xp - ab);
    const spanne = bis == null ? Math.max(imLevel, 1) : Math.max(bis - ab, 1);
    return {
        system: String(system || ''),
        level: String(Number(s?.level || 0)),
        position: platz == null ? '–' : String(platz),
        xp_level: String(bis == null ? spanne : imLevel),
        xp_level_max: String(spanne),
        xp_gesamt: String(xp),
        abzeichen: [],
    };
}

/**
 * Für den Kern-Bereich „Bildkarten“ (G-21): Die Karte ist an, wo Leveling an
 * ist (`/rank` nutzt sie immer). Keine Laufzeitwerte, die Seite zeigt die
 * Beispielwerte der Schablone.
 *
 * @param {string} guildId
 * @returns {Promise<{an: boolean, werte: null}>}
 */
async function stand(guildId) {
    const { ServiceManager } = require('dunebot-core');
    const zeilen = await ServiceManager.get('dbService').query(
        "SELECT 1 FROM guild_plugins WHERE guild_id = ? AND plugin_name = 'leveling' AND is_enabled = 1 LIMIT 1", [guildId]);
    return { an: Boolean(zeilen?.length), werte: null };
}

module.exports = { KARTE, KENNUNG, werte, stand };
