'use strict';

/**
 * Grundlautheit: alle Titel kommen gleich laut an.
 *
 * Gemeldet wurde "auf dem Handy ist es viel zu leise, trotz /music volume 200".
 * Die Lautstaerkekette selbst war in Ordnung — der Ton geht als rohes PCM durch
 * ffmpeg, `inlineVolume` ist gesetzt, `setVolume(2.0)` kommt an. Was fehlte,
 * war ein gemeinsamer Pegel: Ein leise gemasterter Titel blieb leise, egal wie
 * weit man aufdreht, und ueber 100 % uebersteuert die Verstaerkung ohnehin.
 *
 * `loudnorm` im ffmpeg-Pfad bringt jeden Titel auf -14 LUFS — denselben Wert,
 * den Spotify und YouTube fahren. Damit ist die Lautstaerke berechenbar statt
 * je Titel nachgeregelt.
 *
 * Der Schalter steht auf **an**. Das aendert das Verhalten bestehender Server,
 * und zwar bewusst: Es ist die Antwort auf eine gemeldete Stoerung, und wer
 * sehr dynamische Musik spielt (Klassik, Live-Mitschnitte) kann es abschalten,
 * ohne dass ihm etwas fehlt.
 */
module.exports = {
    async up(db) {
        const spalten = await db.query(`
            SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'music_settings'
        `);
        if (spalten.some(s => s.COLUMN_NAME === 'normalize_loudness')) return;

        await db.query(`
            ALTER TABLE music_settings
            ADD COLUMN normalize_loudness TINYINT(1) NOT NULL DEFAULT 1
                COMMENT 'Alle Titel auf eine gemeinsame Lautheit bringen (loudnorm, -14 LUFS)'
        `);
    },

    async down(db) {
        await db.query('ALTER TABLE music_settings DROP COLUMN normalize_loudness');
    }
};
