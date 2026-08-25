'use strict';

/**
 * Merken, welchen Inhalt eine Nachricht zuletzt zeigte.
 *
 * **Der Fehler, den das behebt:** `nachtragen()` schrieb bei jedem
 * Anreicherungslauf einen Bearbeitungsauftrag, sobald eine Nachricht stand -
 * mit der Begruendung "Titel oder Kategorie koennten sich geaendert haben".
 * Das `koennten` war nie geprueft. Ergebnis: alle fuenf Minuten je laufendem
 * Streamer eine Discord-Bearbeitung, dauerhaft, ohne dass sich irgendetwas
 * unterschied. In einer Nacht 32 Stueck fuer zwei Kanaele.
 *
 * Das faellt niemandem auf, weil das Ergebnis ja richtig aussieht - die
 * Nachricht stimmt. Es kostet nur Discord-Kontingent, das sich alle Guilds
 * teilen.
 *
 * Der Vergleichswert deckt **Titel, Kategorie und Vorschaubild** ab, also das,
 * was Bedeutung traegt. Die Zuschauerzahl steht ausdruecklich NICHT darin: Sie
 * aendert sich fortlaufend, und eine Bearbeitung im Minutentakt fuer eine Zahl,
 * die ohnehin veraltet ist, waere genau derselbe Fehler mit besserer
 * Begruendung.
 */
module.exports = {
    description: 'Vergleichswert je Nachricht, damit nur bei echten Aenderungen bearbeitet wird',

    async up(db) {
        const da = await db.query(`
            SELECT COLUMN_NAME FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'streaming_messages'
               AND COLUMN_NAME = 'inhalt_stand'
        `);
        if (!da.length) {
            await db.query(`
                ALTER TABLE streaming_messages
                  ADD COLUMN inhalt_stand VARCHAR(64) DEFAULT NULL
                      COMMENT 'Fingerabdruck von Titel/Kategorie/Bild - verhindert Bearbeitungen ohne Aenderung'
            `);
        }
    },

    async down(db) {
        const da = await db.query(`
            SELECT COLUMN_NAME FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'streaming_messages'
               AND COLUMN_NAME = 'inhalt_stand'
        `);
        if (da.length) await db.query('ALTER TABLE streaming_messages DROP COLUMN inhalt_stand');
    }
};
