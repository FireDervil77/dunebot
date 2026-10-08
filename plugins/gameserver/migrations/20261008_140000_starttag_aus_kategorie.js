'use strict';

/**
 * Spiele ohne Tags bekommen ihre bisherige Kategorie als erstes Tag (2026-10-08).
 *
 * Die Kategorie eines Spiels — eine feste Liste von neun Werten, genau einer je
 * Spiel — weicht den Tags (Betreiber: „so lassen sich dann Spiele mit
 * Gemeinsamkeiten zeigen, die vielleicht so keine Gemeinsamkeiten haben").
 * Gemessen am selben Tag: fünf von acht Spielen standen auf „sandbox",
 * StarRupture auf „other", weil kein Wert passte.
 *
 * Gefiltert wird ab jetzt nach Tags. Fünf der acht Spiele hatten noch keines —
 * ohne diesen Schritt wären sie über keinen Filter mehr zu finden gewesen.
 * Deshalb: Wer KEIN Tag hat, bekommt eines aus seiner Kategorie. Wer schon
 * Tags hat, bleibt unberührt; „other" wird zu keinem Tag (es sagt nichts).
 *
 * Geschrieben wird über die Tag-Bibliothek (helpers/Tags.js): Ein Tag, das es
 * schon gibt, wird wiederverwendet und behält seine Schreibweise — „scifi"
 * landet beim vorhandenen „SCI-FI".
 *
 * Die Spalte `category` bleibt stehen (Tabellenschnitt); gelesen wird sie von
 * keiner Oberfläche mehr.
 */
const Tags = require('../../../apps/dashboard/helpers/Tags');

const START_TAG = {
    fps: 'Shooter', survival: 'Survival', sandbox: 'Sandbox', mmorpg: 'MMORPG',
    racing: 'Rennspiel', strategy: 'Strategie', horror: 'Horror', scifi: 'SCI-FI',
};

module.exports = {
    description: 'Spiele ohne Tags: die bisherige Kategorie wird ihr erstes Tag',
    START_TAG,

    async up(db) {
        const spiele = await db.query(`
            SELECT am.id, am.category
              FROM addon_marketplace am
             WHERE NOT EXISTS (SELECT 1 FROM tag_links l WHERE l.entity_type = 'spiel' AND l.entity_id = am.id)
             ORDER BY am.id`);
        for (const s of spiele) {
            const name = START_TAG[s.category];
            if (!name) continue;
            await Tags.setze(db, 'spiel', s.id, [name]);
        }
    },

    async down() {
        // Bewusst nichts: Ob ein Tag von hier stammt oder vom Betreiber gesetzt
        // wurde, ist ihm nicht anzusehen — und ein Tag zu viel schadet weniger
        // als eines, das zu Unrecht verschwindet. Entfernt wird unter /admin/addons.
    },
};
