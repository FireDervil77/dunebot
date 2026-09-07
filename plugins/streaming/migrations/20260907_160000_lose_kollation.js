'use strict';

/**
 * Nachtrag: `streaming_lose.guild_id` auf die Kollation der anderen ziehen.
 *
 * Die Tabelle wurde am 2026-09-07 mit `utf8mb4_general_ci` fuer alle Spalten
 * angelegt - meine Begruendung dort ("wie alle `streaming_*`-Tabellen") war
 * fuer die **Tabelle** richtig und fuer die **Spalte** falsch. Alle sechs
 * anderen `streaming_*`-Tabellen tragen auf `guild_id` ausdruecklich
 * `utf8mb4_unicode_ci`, damit die Spalte mit `guilds._id` vergleichbar bleibt.
 *
 * Gemeldet hat es `scripts/check-kollationen.js` mit einer einzigen Zeile:
 * „NEU (1) — hier ist gerade etwas dazugekommen". Genau dafuer gibt es ihn.
 *
 * Die Migration von vorhin ist bereits gelaufen und wird nicht noch einmal
 * ausgefuehrt; sie ist trotzdem richtiggestellt, damit eine **neue** Anlage
 * die Spalte gleich korrekt bekommt.
 */
module.exports = {
    description: 'streaming_lose.guild_id auf utf8mb4_unicode_ci',

    async up(db) {
        const [zeile] = await db.query(`
            SELECT COLLATION_NAME AS kollation
              FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'streaming_lose'
               AND COLUMN_NAME = 'guild_id'
        `);

        // Gibt es die Tabelle nicht (frische Anlage, Reihenfolge), ist nichts
        // zu tun - die vorherige Migration legt sie dann schon richtig an.
        if (!zeile || zeile.kollation === 'utf8mb4_unicode_ci') return;

        await db.query(`
            ALTER TABLE streaming_lose
              MODIFY COLUMN guild_id VARCHAR(32) COLLATE utf8mb4_unicode_ci NOT NULL
        `);
    },

    async down() {
        // Kein Rueckbau: Die alte Kollation war der Fehler.
    }
};
