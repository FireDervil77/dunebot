'use strict';

/**
 * Installationsschritt: welche Dateien er angelegt und geändert hat (W1, 2026-10-01).
 *
 * Betreiber: Das Verzeichnis „kann man in diesem Schritt nicht sehen". Der
 * Daemon schickt den Vergleich mit dem Ende des Schritts (`fertig.dateien`,
 * `fehlgeschlagen.dateien`) — wie beim Probestart (werkbank_laeufe.dateien).
 */
module.exports = {
    description: 'Werkbank: Dateivergleich eines Installationsschritts',

    async up(db) {
        await db.query(`
            ALTER TABLE werkbank_schritte
              ADD COLUMN IF NOT EXISTS dateien LONGTEXT DEFAULT NULL
                COMMENT 'JSON {neu, geaendert, weg, anzahl_*} — game/ und data/, vor gegen nach dem Schritt'
                AFTER bytes
        `);
    },

    async down(db) {
        await db.query('ALTER TABLE werkbank_schritte DROP COLUMN IF EXISTS dateien');
    }
};
