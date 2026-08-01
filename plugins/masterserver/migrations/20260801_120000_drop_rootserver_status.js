'use strict';

/**
 * Entfernt die tote Spalte `rootserver.status`.
 *
 * Dieselbe Fehlerklasse wie `current_players` vor E1, nur eine Ebene höher: eine
 * Spalte, die aussieht, als trüge sie die Wahrheit, und es nie getan hat.
 *
 *   | Spalte                     | schreibt                          | liest        |
 *   |----------------------------|-----------------------------------|--------------|
 *   | rootserver.daemon_status   | processHeartbeat(), IPMServer     | Übersicht    |
 *   | rootserver.status          | niemand (nur der INSERT-Default)  | niemand      |
 *
 * Belegt vor dem Drop: `INSERT INTO rootserver` in `routes/guild.router.js` nennt
 * die Spalte nicht, sie bekommt also dauerhaft ihren Default `'offline'`. In der
 * Produktionsdatenbank standen beide Rootserver auf `status = 'offline'` bei
 * gleichzeitig `daemon_status = 'online'` – die Spalte hat also nicht bloß
 * geschwiegen, sie hat widersprochen.
 *
 * Sichtbar war der Widerspruch nie, weil `rootserver.router.js` das Feld nach dem
 * Laden überschreibt (`rs.status = rs.daemon_status`). Genau deshalb kommt sie
 * weg: Die nächste Abfrage, die `status` für die naheliegende Bedeutung nimmt,
 * ohne diese Zeile zu kennen, erbt den Fehler.
 *
 * Die Alternative – die Spalte mitpflegen – wäre der falsche Weg gewesen. Zwei
 * Wahrheiten synchron zu halten ist genau das Muster, das E1 abgeschafft hat.
 *
 * `idx_status` liegt allein auf dieser Spalte und verschwindet mit ihr; kein
 * zusammengesetzter Index verliert dadurch ein Feld.
 */
module.exports = {
    description: 'tote Spalte rootserver.status entfernen',

    async up(db) {
        const [spalte] = await db.query(`
            SELECT COLUMN_NAME
            FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'rootserver'
              AND COLUMN_NAME = 'status'
        `);

        if (!spalte) return;

        await db.query('ALTER TABLE rootserver DROP COLUMN status');
    },

    async down(db) {
        const [spalte] = await db.query(`
            SELECT COLUMN_NAME
            FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'rootserver'
              AND COLUMN_NAME = 'status'
        `);

        if (spalte) return;

        await db.query(`
            ALTER TABLE rootserver
            ADD COLUMN status ENUM('online','offline','installing','error','maintenance')
                NULL DEFAULT 'offline' AFTER api_key
        `);
        await db.query('ALTER TABLE rootserver ADD INDEX idx_status (status)');
    },
};
