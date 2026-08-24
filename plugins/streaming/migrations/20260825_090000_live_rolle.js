'use strict';

/**
 * Live-Rolle: die Zuordnung Kanal -> Discord-Mitglied.
 *
 * **Das Problem in einem Satz:** „Kanal *ninja* ist live" sagt nicht, welchem
 * Discord-Mitglied die Rolle gehoert. Ein Kanalname ist kein Discord-Nutzer.
 *
 * Deshalb eine Spalte am **Ziel** und nicht am Streamer: Der Streamer ist
 * guild-uebergreifend, die Zuordnung gilt je Guild. Derselbe Twitch-Kanal
 * gehoert auf Server A vielleicht zu einem Mitglied und ist auf Server B nur
 * ein Kanal, den man gern schaut.
 *
 * Ist die Spalte leer, gibt es keine Rolle — ausdruecklich kein Fehler,
 * sondern der Normalfall.
 *
 * Welche Rolle vergeben wird, steht **nicht** hier, sondern als Einstellung
 * der Guild (`configs`, Schluessel `LIVE_ROLLE_ID`). Eine Rolle je Ziel waere
 * flexibler und in der Bedienung eine Zumutung: Wer zwanzig Kanaele
 * beobachtet, stellt zwanzigmal dieselbe Rolle ein.
 */
module.exports = {
    description: 'Live-Rolle: Zuordnung Ziel -> Discord-Mitglied',

    async up(db) {
        // `IF NOT EXISTS` gibt es fuer ADD COLUMN erst ab MariaDB 10.0/MySQL 8.0.29
        // und verhaelt sich uneinheitlich. Deshalb vorher nachsehen — und nicht
        // hoffen ([[db-schema-weicht-von-migration-ab]]).
        const spalten = await db.query(`
            SELECT COLUMN_NAME FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'streaming_targets'
               AND COLUMN_NAME = 'mitglied_id'
        `);

        if (!spalten.length) {
            await db.query(`
                ALTER TABLE streaming_targets
                  ADD COLUMN mitglied_id VARCHAR(32) DEFAULT NULL
                      COMMENT 'Discord-Mitglied, das diesen Kanal betreibt - fuer die Live-Rolle'
            `);
        }
    },

    async down(db) {
        const spalten = await db.query(`
            SELECT COLUMN_NAME FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'streaming_targets'
               AND COLUMN_NAME = 'mitglied_id'
        `);
        if (spalten.length) {
            await db.query('ALTER TABLE streaming_targets DROP COLUMN mitglied_id');
        }
    }
};
