'use strict';

/**
 * FireBus, Etappe 1: Zählung der Haltestellen (2026-11-01).
 *
 * Seit der Daemon Befehle an Haltestellen abstellt, sagt die Belegung des
 * Lesefadens nichts mehr über ihre Dauer. `warten` ist die Zeit bis zum Beginn,
 * `arbeit` die Zeit bis zum Ende.
 */
module.exports = {
    async up(db) {
        await db.query(`
            ALTER TABLE firebus_zaehlung
            MODIFY art ENUM('ein', 'aus', 'lesefaden', 'warten', 'arbeit') NOT NULL
        `);
    },

    async down(db) {
        await db.query(`DELETE FROM firebus_zaehlung WHERE art IN ('warten', 'arbeit')`);
        await db.query(`
            ALTER TABLE firebus_zaehlung
            MODIFY art ENUM('ein', 'aus', 'lesefaden') NOT NULL
        `);
    },
};
