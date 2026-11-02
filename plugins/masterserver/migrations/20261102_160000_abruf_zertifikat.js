'use strict';

/**
 * Das Zertifikat des Abrufs, vom Daemon bei der Anmeldung gemeldet (FireBus Etappe 2).
 *
 * `/datei` und `/sicherung` laufen seither über TLS mit dem eigenen Zertifikat jedes
 * Daemons, und das Dashboard vertraut genau diesem einen. NULL heißt: Der Daemon ist
 * zu alt oder sein Abruf läuft nicht.
 */
module.exports = {
    description: 'rootserver.abruf_zertifikat — Zertifikat des Abrufs, vom Daemon gemeldet',

    async up(db) {
        await db.query(`
            ALTER TABLE rootserver
                ADD COLUMN IF NOT EXISTS abruf_zertifikat TEXT DEFAULT NULL
                    COMMENT 'PEM des Abrufs auf der Maschine. NULL = kein gesicherter Abruf.'
        `);
    },

    async down(db) {
        await db.query('ALTER TABLE rootserver DROP COLUMN IF EXISTS abruf_zertifikat');
    }
};
