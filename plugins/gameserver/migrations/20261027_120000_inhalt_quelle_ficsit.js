'use strict';

/**
 * Satisfactory-Mods aus ficsit.app (Stufe 10 S1, 2026-10-27).
 *
 * `gameserver_content.quelle` ist ein ENUM mit „denselben Werten wie
 * content.sources im Paketschema". Ohne `ficsit` scheiterte jeder Satisfactory-
 * Mod beim Eintragen — NACH der Auflösung, also mit einer Fehlermeldung aus der
 * Datenbank statt einer Absage vorher.
 *
 * Geprüft wird am Spaltentyp, nicht an einem Merker: Die Migration darf auf
 * einer Datenbank laufen, in der jemand die Spalte schon von Hand erweitert hat.
 */
const MIT = "ENUM('thunderstore','modrinth','curseforge','steam-workshop','upload','ficsit')";
const OHNE = "ENUM('thunderstore','modrinth','curseforge','steam-workshop','upload')";
const KOMMENTAR = 'Dieselben Werte wie content.sources im Paketschema';

module.exports = {
    description: 'gameserver-inhalt-quelle-ficsit',

    async up(db) {
        const [spalte] = await db.query(`
            SELECT COLUMN_TYPE AS typ
            FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'gameserver_content'
              AND COLUMN_NAME = 'quelle'
        `);
        if (!spalte) return;                                   // Tabelle gibt es (noch) nicht
        if (String(spalte.typ).includes("'ficsit'")) return;

        await db.query(`ALTER TABLE gameserver_content MODIFY quelle ${MIT} NOT NULL COMMENT '${KOMMENTAR}'`);
    },

    async down(db) {
        const [zeilen] = await db.query("SELECT COUNT(*) AS n FROM gameserver_content WHERE quelle = 'ficsit'");
        if (Number(zeilen?.n) > 0) {
            throw new Error(`${zeilen.n} Inhalt(e) aus ficsit.app — erst entfernen, sonst gingen sie beim Zurücknehmen verloren`);
        }
        await db.query(`ALTER TABLE gameserver_content MODIFY quelle ${OHNE} NOT NULL COMMENT '${KOMMENTAR}'`);
    }
};
