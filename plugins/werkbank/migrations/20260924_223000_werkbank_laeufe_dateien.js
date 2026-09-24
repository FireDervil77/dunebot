'use strict';

/**
 * Probestart: welche Dateien das Spiel angelegt und geändert hat (2026-09-24).
 *
 * Der Daemon schickt den Vergleich mit dem Ende des Laufs (`beendet.dateien`).
 * Eine Spalte am Lauf, weil er zu genau diesem Lauf gehört. Die Tabelle ist
 * vom selben Tag und fast leer — ADD COLUMN IF NOT EXISTS (MariaDB 10.6).
 */
module.exports = {
    description: 'Werkbank: Dateivergleich eines Probestarts',

    async up(db) {
        await db.query(`
            ALTER TABLE werkbank_laeufe
              ADD COLUMN IF NOT EXISTS dateien LONGTEXT DEFAULT NULL
                COMMENT 'JSON {neu, geaendert, weg, anzahl_*} — game/ und data/, vor dem Start gegen nach dem Ende'
                AFTER luecken
        `);
    },

    async down(db) {
        await db.query('ALTER TABLE werkbank_laeufe DROP COLUMN IF EXISTS dateien');
    }
};
