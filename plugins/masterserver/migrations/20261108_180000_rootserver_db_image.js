'use strict';

/**
 * Image-Stand des Datenbank-Containers je Rootserver (K318, 2026-11-08).
 *
 * Der Daemon (ab 1.1.20) holt `fb/mariadb:latest` bei jeder Anmeldung und
 * meldet, auf welchem Image `fb-datenbank` läuft und ob ein neueres
 * bereitliegt. Gewechselt wird nur auf Knopfdruck am Rootserver — beim Wechsel
 * sind die Spiele mit Datenbank einige Sekunden ohne sie.
 *
 *   db_image      worauf der Container läuft (12 Zeichen der Image-ID)
 *   db_image_neu  das neuere `latest`, NULL wenn keines bereitliegt
 *   db_wechsel    wie der letzte Wechsel ausging, NULL wenn er gelang
 */
module.exports = {
    description: 'masterserver-rootserver-db-image',

    async up(db) {
        await db.query(`ALTER TABLE rootserver
            ADD COLUMN IF NOT EXISTS db_image VARCHAR(16) DEFAULT NULL
                COMMENT 'Befund: Image-ID (kurz), auf der fb-datenbank laeuft',
            ADD COLUMN IF NOT EXISTS db_image_neu VARCHAR(16) DEFAULT NULL
                COMMENT 'Befund: neueres fb/mariadb:latest auf der Maschine, NULL = keines',
            ADD COLUMN IF NOT EXISTS db_wechsel VARCHAR(500) DEFAULT NULL
                COMMENT 'Befund: Satz zum letzten gescheiterten Image-Wechsel'`);
    },

    async down(db) {
        await db.query(`ALTER TABLE rootserver
            DROP COLUMN IF EXISTS db_image,
            DROP COLUMN IF EXISTS db_image_neu,
            DROP COLUMN IF EXISTS db_wechsel`);
    }
};
