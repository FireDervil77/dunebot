'use strict';

/**
 * Probestart: was ein Lauf insgesamt an Ports gesehen hat (2026-10-08).
 *
 * `ports` hält, was GERADE lauscht — und wird mit dem Ende des Spiels leer.
 * Damit war nach dem Stoppen nichts mehr zu übernehmen, und zwei Starts liessen
 * sich nicht vergleichen. Gemessen an der 7-Days-Sitzung des Betreibers: Der
 * ausgehende Zufallsport hiess in einem Start 51333, im nächsten 51737 — genau
 * das, woran man erkennt, dass er kein Dienst ist. Die Werkbank hatte den
 * ersten Wert da schon vergessen.
 *
 * `gesehen` ist die Vereinigung über den Lauf und bleibt nach seinem Ende.
 * Läufe von vorher haben es nicht (NULL) — für sie gilt wie bisher `ports`.
 */
module.exports = {
    description: 'Werkbank: je Probestart merken, welche Ports er gesehen hat',

    async up(db) {
        await db.query(`
            ALTER TABLE werkbank_laeufe
              ADD COLUMN IF NOT EXISTS gesehen LONGTEXT DEFAULT NULL
                COMMENT 'JSON [{port, protocol}] — alles, was während des Laufs je lauschte; bleibt nach dem Ende'
                AFTER ports
        `);
    },

    async down(db) {
        await db.query('ALTER TABLE werkbank_laeufe DROP COLUMN IF EXISTS gesehen');
    }
};
