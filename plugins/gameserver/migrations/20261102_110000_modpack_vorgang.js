'use strict';

/**
 * Das Einspielen eines Modpacks ist ein Vorgang, den man sieht (2026-11-02, B218).
 *
 * Betreiber: Beim Wechsel kamen Toasts, aber weder die Mods-Seite noch die
 * Serverseite zeigten, dass etwas läuft, und nach „Neu installieren" sah die
 * Karte aus wie vorher. `status` taugt dafür nicht: Ein Modpack geht auch auf
 * einen laufenden Server, und dessen Status schreibt der Daemon.
 *
 * Wie beim Löschen, siehe `helpers/Modpackstand.js`.
 */
const SPALTEN = [
    ['modpack_seit', "DATETIME NULL DEFAULT NULL COMMENT 'Seit wann ein Modpack eingespielt wird; NULL = keines'"],
    ['modpack_name', "VARCHAR(190) NULL DEFAULT NULL COMMENT 'Welches'"],
];

module.exports = {
    description: 'gameserver-modpack-vorgang',

    async up(db) {
        for (const [name, art] of SPALTEN) {
            // Wie 20261030_120000: Name als Text, die Namen sind Konstanten aus dieser Datei.
            const [da] = await db.query(`SHOW COLUMNS FROM gameservers LIKE '${name}'`);
            if (da) continue;
            await db.query(`ALTER TABLE gameservers ADD COLUMN ${name} ${art}`);
        }
    },

    async down(db) {
        for (const [name] of SPALTEN) await db.query(`ALTER TABLE gameservers DROP COLUMN IF EXISTS ${name}`);
    },
};
