'use strict';

/**
 * Auto-Update wird wieder ein Schalter am Server (2026-10-15).
 *
 * Seit dem 2026-09-10 entschied die Paketeinstellung `auto_update` (in
 * `paket_werte`), die Spalte `gameservers.auto_update` las niemand mehr — sie
 * blieb aber der Schalter auf der Bearbeiten-Seite. Gemessen am 2026-10-15:
 * nur Astro Colony trug die Einstellung noch, Enshrouded (Server 219, Spalte 1)
 * zog kein Update, Valheim (186) seit Paket 1.1.2 auch nicht mehr.
 *
 * Ab jetzt gilt die Spalte (StartPayload.AUTO_UPDATE). Wer seinen Wert bisher
 * auf der Einstellungskarte gesetzt hatte, behält ihn: Er wandert aus
 * `paket_werte` in die Spalte und verschwindet dort, damit kein zweiter Wert
 * herumliegt, der wie ein Schalter aussieht. Server ohne den Schlüssel bleiben
 * unberührt — ihre Spalte ist das, was auf der Bearbeiten-Seite steht.
 */

/** Dieselbe Lesart wie StartPayload.istWahr. */
function istWahr(wert) {
    if (wert === true) return true;
    if (wert === false || wert === null || wert === undefined) return false;
    const v = String(wert).trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'on' || v === 'yes';
}

module.exports = {
    description: 'Auto-Update: Wert aus paket_werte in die Spalte gameservers.auto_update',

    async up(db) {
        const server = await db.query(`
            SELECT id, paket_werte
              FROM gameservers
             WHERE paket_werte IS NOT NULL
               AND JSON_CONTAINS_PATH(paket_werte, 'one', '$.auto_update')`);
        for (const s of server) {
            const werte = typeof s.paket_werte === 'string' ? JSON.parse(s.paket_werte) : s.paket_werte;
            const an = istWahr(werte?.auto_update);
            await db.query(`
                UPDATE gameservers
                   SET auto_update = ?, paket_werte = JSON_REMOVE(paket_werte, '$.auto_update')
                 WHERE id = ?`, [an ? 1 : 0, s.id]);
        }
    },

    async down() {
        // Bewusst nichts: Der alte Weg las `paket_werte` nur bei Paketen, die
        // die Einstellung tragen — zurückschreiben hiesse, einen Wert zu
        // erfinden, den niemand gesetzt hat.
    },
};
