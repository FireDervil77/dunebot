'use strict';

/**
 * Wie steht die Leitung zu einer Maschine? (2026-11-02, F15)
 *
 * Fällt ein Rootserver aus, sagte bisher nur `daemon_status` etwas darüber, und
 * das liest keine Serverzeile. `verbindung` unterscheidet außerdem, ob erst neu
 * verbunden wird, nur der Daemon fehlt oder die ganze Maschine schweigt.
 * Geschrieben wird beides allein von `helpers/VerbindungsWache.js`.
 */
module.exports = {
    description: 'masterserver-rootserver-verbindung',

    async up(db) {
        // Name als Text: dbService.query ist execute, kein Platzhalter hinter SHOW … LIKE.
        const [da] = await db.query("SHOW COLUMNS FROM rootserver LIKE 'verbindung'");
        if (da) return;
        await db.query(`ALTER TABLE rootserver
            ADD COLUMN verbindung ENUM('da', 'neu_verbinden', 'angekuendigt', 'daemon_weg', 'maschine_weg')
                NOT NULL DEFAULT 'da' COMMENT 'Zustand der Leitung, schreibt die VerbindungsWache',
            ADD COLUMN verbindung_seit DATETIME NULL DEFAULT NULL COMMENT 'Seit wann nicht da'`);
    },

    async down(db) {
        await db.query('ALTER TABLE rootserver DROP COLUMN IF EXISTS verbindung_seit');
        await db.query('ALTER TABLE rootserver DROP COLUMN IF EXISTS verbindung');
    }
};
