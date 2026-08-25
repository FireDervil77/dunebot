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
 * Der Vergleichswert deckt **alles ab, was die Karte zeigt** - Titel,
 * Kategorie, Vorschaubild und Zuschauerzahl.
 *
 * Die Zuschauerzahl war zuerst ausgenommen, um die Schleife zu schliessen. Der
 * Betreiber hat widersprochen, und zu Recht: Waehrend jemand sendet, ist eine
 * aktuelle Zahl der Sinn der Ankuendigung, keine Verschwendung. Verschwendung
 * war der Fall, in dem sich GAR NICHTS unterscheidet - und den faengt der
 * Vergleich weiterhin ab, gerade weil er vollstaendig ist.
 *
 * Wer nicht mehr sendet, wird ohnehin nicht abgefragt: Der Anreicherungslauf
 * filtert auf `ist_live = 1`.
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
