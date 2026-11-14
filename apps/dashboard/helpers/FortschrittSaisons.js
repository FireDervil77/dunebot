'use strict';

/**
 * Saisons der Fortschritts-Bibliothek beenden (G-20, K382, 2026-11-14).
 *
 * Alle fünf Minuten (`core:fortschritt-saisons`, nachgeholt nach einem
 * Neustart, unter /admin/zeitplan auch von Hand) beendet das Dashboard jede
 * Saison, deren Ende erreicht ist, und wendet ihre Regel an: `archivieren`
 * lässt den Saisonstand lesbar, `zuruecksetzen` löscht ihn. Gebucht wird in
 * eine Saison ohnehin nur bis zu ihrem Ende (`Fortschritt.buche` prüft die
 * Zeit selbst); der Takt entscheidet nur, wann die Regel greift.
 *
 * Melden tut das Plugin, dem die Kennung gehört (`leveling.saison.gewechselt`),
 * sobald es Saisons anbietet (Leveling LV-3b).
 *
 * @module apps/dashboard/helpers/FortschrittSaisons
 */

const { Fortschritt } = require('dunebot-sdk');
const Zeitplan = require('./Zeitplan');

const TAKT = '*/5 * * * *';

/** @returns {Promise<string>} Bericht für den Zeitplan */
async function beenden() {
    const r = await Fortschritt.beendeFaellige();
    if (!r.length) return 'keine Saison fällig';
    return `${r.length} Saison(s) beendet: ` + r.map((s) => `#${s.id} ${s.kennung} in ${s.guild_id} (${s.regel}${s.geloescht ? `, ${s.geloescht} Stand gelöscht` : ''})`).join('; ');
}

function starten() {
    Zeitplan.eintragen('core:fortschritt-saisons', TAKT, beenden);
}

module.exports = { starten, beenden, TAKT };
