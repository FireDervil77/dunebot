'use strict';

/**
 * Das Löschen eines Servers läuft im Hintergrund (2026-10-30).
 *
 * Betreiber: Nach der Bestätigung springt die Seite in die Übersicht, und die
 * Zeile bleibt bis zum Ende gesperrt und rot. Das braucht einen Zustand, der
 * einen Seitenwechsel überlebt. `status` taugt nicht: Der Daemon schreibt ihn
 * während des Stoppens selbst (`stopping`, `offline`), und `ServerStopp` wartet
 * genau auf diese Werte.
 *
 * Nebeneinander, wie im Helfer `Loeschung.js` beschrieben:
 *   seit gesetzt, kein Fehler   läuft (höchstens zehn Minuten)
 *   seit gesetzt, mit Fehler    gescheitert, der Server steht noch
 */
const SPALTEN = [
    ['loeschung_seit', "DATETIME NULL DEFAULT NULL COMMENT 'Wann das Loeschen zuletzt angefordert wurde'"],
    ['loeschung_fehler', "TEXT NULL DEFAULT NULL COMMENT 'Warum das Loeschen scheiterte; NULL = laeuft oder nie versucht'"],
];

module.exports = {
    description: 'gameserver-loeschung-im-hintergrund',

    async up(db) {
        for (const [name, art] of SPALTEN) {
            // Wie 20261027_140000: Name als Text, `SHOW … LIKE ?` geht mit
            // execute nicht. Die Namen sind Konstanten aus dieser Datei.
            const [da] = await db.query(`SHOW COLUMNS FROM gameservers LIKE '${name}'`);
            if (da) continue;
            await db.query(`ALTER TABLE gameservers ADD COLUMN ${name} ${art}`);
        }
    },

    async down(db) {
        for (const [name] of [...SPALTEN].reverse()) {
            await db.query(`ALTER TABLE gameservers DROP COLUMN IF EXISTS ${name}`);
        }
    }
};
