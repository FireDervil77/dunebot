'use strict';

/**
 * `gameservers.cpu_percent` fasst die CPU in Kernen (Baustelle 211, 2026-10-29).
 *
 * Der Daemon misst seit 1.0.153 wie `docker stats`: 100 = ein voller Kern, ein
 * Server auf acht vollen Kernen meldet 800. Vorher lieferte er unter cgroup v2
 * den Anteil an der ganzen Maschine (0–100), und dafür reichte DECIMAL(5,2).
 * Gemeint war die neue Einheit von Anfang an: Der Kommentar der Spalte lautet
 * seit 2026-09-21 „in Prozent eines Kerns".
 *
 * DECIMAL(5,2) endet bei 999,99, also bei zehn Kernen. Die Buchung erlaubt bis
 * 1600 (16 Kerne). Im Strict-Modus (auf der Produktion gesetzt) wirft ein
 * Wert darüber, und mit ihm fällt das ganze UPDATE des Herzschlags aus, samt
 * RAM und Verkehr. DECIMAL(6,2) reicht bis 9999,99 und ist dieselbe Breite wie
 * `server_metrics.cpu_avg`.
 *
 * Hier und nicht im gameserver-Plugin: Die Spalte legt
 * `20260921_180000_server_registry_zurueckgezogen` dieses Plugins an. So läuft
 * die Erweiterung bei einer Neuinstallation sicher danach.
 */
module.exports = {
    description: 'gameservers.cpu_percent DECIMAL(6,2) — CPU in Prozent eines Kerns, bis 16 Kerne',

    async up(db) {
        const [spalte] = await db.query(
            `SELECT NUMERIC_PRECISION AS stellen
               FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME = 'gameservers'
                AND COLUMN_NAME = 'cpu_percent'`
        );
        if (!spalte || Number(spalte.stellen) >= 6) return;

        await db.query(`
            ALTER TABLE gameservers
                MODIFY COLUMN cpu_percent DECIMAL(6,2) NULL DEFAULT NULL
                    COMMENT 'Letzte Messung des Daemons, in Prozent eines Kerns (100 = 1 Kern)'
        `);
    },

    async down(db) {
        // Zurück auf fünf Stellen geht nur, solange kein Wert über 999,99 steht.
        await db.query(`UPDATE gameservers SET cpu_percent = 999.99 WHERE cpu_percent > 999.99`);
        await db.query(`
            ALTER TABLE gameservers
                MODIFY COLUMN cpu_percent DECIMAL(5,2) NULL DEFAULT NULL
                    COMMENT 'Letzte Messung des Daemons, in Prozent eines Kerns'
        `);
    }
};
