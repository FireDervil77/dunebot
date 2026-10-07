'use strict';

/**
 * Schritte aus einem geöffneten Paket: Zustand `uebernommen` (2026-10-07).
 *
 * Die Werkbank öffnet seit heute fertige Pakete (Sitzungen.paketOeffnen). Deren
 * Installationsschritte gehören zum Entwurf, sind im Volume der neuen Sitzung
 * aber nie gelaufen. `ok` wäre gelogen (es heisst „lief hier durch"), und ohne
 * eigenen Zustand liesse sich nicht sagen, welche Schritte noch auszuführen
 * sind, bevor ein Probestart Sinn hat.
 *
 * Nur der Wertebereich wächst; vorhandene Zeilen bleiben, wie sie sind.
 */
module.exports = {
    description: 'werkbank_schritte.status kennt uebernommen (Schritt aus einem geöffneten Paket)',

    async up(db) {
        await db.query(`
            ALTER TABLE werkbank_schritte
                MODIFY COLUMN status ENUM('laeuft','ok','fehler','herausgenommen','uebernommen') NOT NULL DEFAULT 'laeuft'
        `);
    },

    async down(db) {
        // Erst die Zeilen umetikettieren — sonst kürzt MariaDB den unbekannten
        // Wert still auf '' und die Schritte fallen aus jedem Entwurf.
        await db.query("UPDATE werkbank_schritte SET status = 'herausgenommen' WHERE status = 'uebernommen'");
        await db.query(`
            ALTER TABLE werkbank_schritte
                MODIFY COLUMN status ENUM('laeuft','ok','fehler','herausgenommen') NOT NULL DEFAULT 'laeuft'
        `);
    }
};
