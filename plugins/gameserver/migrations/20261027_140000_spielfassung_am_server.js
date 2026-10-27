'use strict';

/**
 * Die Spielfassung am Server (Stufe 10 S3, 2026-10-27).
 *
 * Gelesen aus der Datei, die `management.game_version` nennt (Satisfactory:
 * `Engine/Binaries/Linux/FactoryServer-Linux-Shipping.version`), nach der
 * Installation und bei jedem Start. `build` prüft Mods (ficsit.app vergleicht
 * gegen die Changelist), `label` steht in der Anzeige. NULL = das Paket nennt
 * keine Datei oder sie wurde noch nie gelesen — nie geraten.
 */
const SPALTEN = [
    ['spielfassung_build', "VARCHAR(40) NULL DEFAULT NULL COMMENT 'Build des Spiels (Changelist) aus management.game_version'"],
    ['spielfassung_label', "VARCHAR(60) NULL DEFAULT NULL COMMENT 'Fassung zur Anzeige (GameVersion)'"],
    ['spielfassung_am', "DATETIME NULL DEFAULT NULL COMMENT 'Wann zuletzt gelesen'"],
];

module.exports = {
    description: 'gameserver-spielfassung-am-server',

    async up(db) {
        for (const [name, art] of SPALTEN) {
            // SHOW COLUMNS statt information_schema: Es fragt genau die Tabelle,
            // die das ALTER danach trifft — auch eine TEMPORARY-Kopie im Wächter.
            // Der Name steht als Text drin, nicht als `?`: dbService.query ist
            // `execute` (Prepared Statement), und MariaDB nimmt dort hinter
            // SHOW … LIKE keinen Platzhalter — am 2026-10-27 daran gescheitert
            // („near '?'"). Die Namen sind Konstanten aus dieser Datei.
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
