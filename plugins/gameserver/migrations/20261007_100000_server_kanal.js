'use strict';

/**
 * Jeder Server folgt einem Kanal — `gameservers.channel` (E-2, Baustelle 172).
 *
 * Bis zum 2026-10-07 wählten sechs Abfragen die Paketfassung mit „stable
 * zuerst, sonst die neueste". Eine `stable`-Fassung gab es nie, also nahm jeder
 * Server beim nächsten Start die neueste — am 2026-10-06 an Server 208 viermal
 * an einem Vormittag (StarRupture 1.0.3 bis 1.0.6).
 *
 * Jetzt steht am Server, wem er folgt:
 *
 *   stable  die neueste FREIGEGEBENE Fassung (Vorgabe für neue Server)
 *   test    die neueste Fassung überhaupt
 *
 * ── Was mit den vorhandenen Servern geschieht ──────────────────────────────
 *
 * Sie kommen auf `test`, wenn ihr Paket keine freigegebene Fassung hat — und
 * das sind heute alle (gemessen: 74 Fassungen, 0 `stable`). Damit ändert sich
 * für sie NICHTS: Sie nehmen weiter die neueste. Auf `stable` hätten sie ab
 * dieser Migration kein Paket mehr und liessen sich nicht starten, denn einen
 * stillen Rückfall auf eine Testfassung gibt es absichtlich nicht
 * (helpers/Paketfassung.js).
 *
 * Ein Server, dessen Paket schon eine freigegebene Fassung hat, bleibt auf der
 * Vorgabe `stable` — er bekam sie nach der alten Regel ohnehin.
 */
module.exports = {
    description: 'gameservers.channel — der Kanal, dem ein Server folgt (stable/test)',

    async up(db) {
        await db.query(`
            ALTER TABLE gameservers
                ADD COLUMN IF NOT EXISTS channel ENUM('stable','test') NOT NULL DEFAULT 'stable'
                    COMMENT 'Welcher Paketfassung der Server folgt: stable = neueste freigegebene, test = neueste ueberhaupt (E-2)'
                    AFTER addon_version
        `);

        await db.query(`
            UPDATE gameservers gs
               SET gs.channel = 'test'
             WHERE NOT EXISTS (
                     SELECT 1 FROM package_versions v
                      WHERE v.package_id = gs.addon_marketplace_id
                        AND v.channel = 'stable')
        `);
    },

    async down(db) {
        await db.query('ALTER TABLE gameservers DROP COLUMN IF EXISTS channel');
    }
};
