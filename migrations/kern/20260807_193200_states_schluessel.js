'use strict';

/**
 * `states` (OAuth-Anmeldung) hatte keinen Primaerschluessel.
 *
 * `saveState()` schreibt mit `ON DUPLICATE KEY UPDATE` und der Kommentar dort
 * nennt die Spalte ausdruecklich "als Primary Key" - den gab es aber nie. Der
 * Zweig lief also nie an. Folgenlos blieb das nur, weil der Wert zufaellig
 * erzeugt wird und sich deshalb nicht wiederholt.
 *
 * Spuerbar war die Luecke trotzdem: `getState()` sucht bei jeder Anmeldung
 * ueber die volle Tabelle, und die waechst seit dem 2025-10-16 auf 1008
 * Zeilen, weil abgebrochene Anmeldungen nie geloescht werden - nur der
 * erfolgreiche Rueckweg raeumt seinen eigenen Eintrag weg.
 *
 * Beides wird hier behoben: Schluessel setzen und die Altlast wegraeumen.
 * Ein OAuth-Wert ist einmalig und Minuten gueltig; was aelter als ein Tag ist,
 * kann niemand mehr einloesen.
 */
module.exports = {
    description: 'states: Primaerschluessel setzen und abgelaufene Eintraege wegraeumen',

    async up(db) {
        const vorhanden = await db.query(
            `SELECT COUNT(*) AS anzahl FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'states'`
        );
        if (!Number(vorhanden[0]?.anzahl)) return;

        // Erst raeumen, dann den Schluessel setzen - das haelt den Umbau kurz
        // und schliesst aus, dass eine alte Doppelung ihn blockiert.
        await db.query('DELETE FROM states WHERE created_at < NOW() - INTERVAL 1 DAY');

        const pk = await db.query(
            `SELECT COUNT(*) AS anzahl FROM information_schema.TABLE_CONSTRAINTS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'states'
               AND CONSTRAINT_TYPE = 'PRIMARY KEY'`
        );
        if (!Number(pk[0]?.anzahl)) {
            await db.query('ALTER TABLE states ADD PRIMARY KEY (id)');
        }

        const index = await db.query(
            `SELECT COUNT(*) AS anzahl FROM information_schema.STATISTICS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'states'
               AND INDEX_NAME = 'idx_created_at'`
        );
        if (!Number(index[0]?.anzahl)) {
            await db.query('ALTER TABLE states ADD INDEX idx_created_at (created_at)');
        }
    },

    /** Bewusst leer - der Schluessel gehoert dahin, geloeschte Werte sind wertlos. */
    async down() {
        // absichtlich nichts
    }
};
