'use strict';

/**
 * Die gemeldete Bereitschaft bekommt einen Platz.
 *
 * Baustelle 58 und 62f. Der Daemon meldet seit dem 2026-08-20 nachweislich eine
 * dreistufige Bereitschaft — Prozess, Port, Abfrage — mit Zeit und Begründung:
 *
 *   👂 [Server 108] Am Agenten — Bereitschaftsstufen kommen jetzt an
 *   ✅ [Server 108] Agent: bereit — Stufe "query"
 *
 * Im Dashboard gab es dafür KEINEN Behandler. Die Meldung lief ins Leere, und
 * die Karte auf der Serverseite sagte weiter „nicht gemessen" — obwohl die
 * Messung unten längst vorlag.
 *
 * ── Warum drei Spalten und nicht eine ───────────────────────────────────────
 *
 * Eine Stufe allein ist keine Auskunft. „Port" heisst je nach Lage „gleich so
 * weit" oder „hängt seit zehn Minuten" — den Unterschied macht der Zeitpunkt.
 * Und die Begründung ist der Satz, für den fb-init überhaupt gebaut wurde:
 * „Port 2457 lauscht nach 60 s noch nicht, der Prozess läuft aber. Bei einer
 * neuen Welt ist das normal."
 *
 * Ohne diesen Satz bliebe von einer dreistufigen Messung ein Ampelmännchen.
 */
module.exports = {
    description: 'Bereitschaftsstufe, Begründung und Zeitpunkt an gameservers',

    async up(db) {
        await db.query(`
            ALTER TABLE gameservers
                ADD COLUMN IF NOT EXISTS bereitschaft_stufe VARCHAR(16) DEFAULT NULL
                    COMMENT 'process | port | query — was fb-init zuletzt gemeldet hat',
                ADD COLUMN IF NOT EXISTS bereitschaft_grund VARCHAR(500) DEFAULT NULL
                    COMMENT 'der Erklaersatz von fb-init, nicht nur ein Zustand',
                ADD COLUMN IF NOT EXISTS bereitschaft_am DATETIME DEFAULT NULL
        `);
    },

    async down(db) {
        await db.query(`
            ALTER TABLE gameservers
                DROP COLUMN IF EXISTS bereitschaft_stufe,
                DROP COLUMN IF EXISTS bereitschaft_grund,
                DROP COLUMN IF EXISTS bereitschaft_am
        `);
    }
};
