'use strict';

/**
 * Eigene Textbausteine - `{discord}` einmal setzen, ueberall benutzen.
 *
 * ## Wofuer
 *
 * Der Modulkopf von `kern/befehle` traegt seit Stufe 15 einen offenen Punkt:
 *
 *     `!discord` ist bewusst KEIN fertiger Befehl, obwohl er auf jeder Liste
 *     steht: Die Anlage kennt die Einladungsadresse einer Guild nicht, und sie
 *     zu erfinden waere schlimmer als sie wegzulassen.
 *
 * Genau das loest diese Tabelle. Der Streamer traegt seine Adresse **einmal**
 * ein, und `{discord}` steht danach in jedem Befehl und jeder Ansage zur
 * Verfuegung. Aendert sich die Einladung, aendert sie sich an einer Stelle -
 * nicht in zehn Antworten, von denen man neun vergisst.
 *
 * ## Warum `wert` und nicht `text`
 *
 * Ein Baustein ist kein Satz, sondern ein eingesetzter Wert: eine Adresse, ein
 * Name, eine Zahl. `text` hiesse `streaming_announcements.text` - dieselbe
 * Spalte mit anderer Bedeutung, und beim naechsten Join verwechselt sie jemand.
 *
 * ## Warum kein `art`
 *
 * Zaehler kommen als naechstes und teilen sich viel mit dieser Tabelle. Eine
 * Spalte `art`, die heute immer denselben Wert traegt, waere trotzdem
 * vorbereiteter toter Platz - dieselbe Bauform wie `pendingUpdatesCount`, die
 * beim ersten echten Einsatz nicht hielt, was sie versprach. Die Zaehler
 * bringen ihre eigene Migration mit; dann steht die Spalte da, weil sie
 * gebraucht wird.
 */

module.exports = {
    name: '20260905_190000_bausteine',
    description: 'Eigene Textbausteine: streaming_variables',

    async up(db) {
        // **Nicht destrukturieren.** `db.query()` liefert die Zeilen direkt.
        const tabellen = await db.query(`
            SELECT TABLE_NAME FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'streaming_variables'
        `);
        if (tabellen.length) return;

        await db.query(`
            CREATE TABLE streaming_variables (
                id           INT AUTO_INCREMENT PRIMARY KEY,

                guild_id     VARCHAR(32) NOT NULL,

                -- NULL heisst "gilt fuer jeden Kanal dieser Guild" - dieselbe
                -- Bedeutung wie in streaming_commands.
                streamer_id  INT DEFAULT NULL,

                -- Ohne geschweifte Klammern. Die gehoeren der Schreibweise,
                -- nicht dem Namen - sonst stuenden sie in jeder Zeile mit drin
                -- und der erste Vergleich ohne sie ginge ins Leere.
                name         VARCHAR(32) NOT NULL,

                -- 500 wie ueberall im Chat: Ein Baustein, der allein schon
                -- laenger ist als eine Nachricht, kann nirgends eingesetzt
                -- werden.
                wert         VARCHAR(500) NOT NULL,

                angelegt_von VARCHAR(32) DEFAULT NULL,
                angelegt_am  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
                geaendert_am DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                                 ON UPDATE CURRENT_TIMESTAMP(3),

                -- Einen Namen kann es je Guild und Kanal nur einmal geben.
                -- Ohne diesen Schluessel entstuenden zwei Zeilen fuer
                -- {discord}, und welche gilt, entschiede die Sortierung.
                -- (Ohne Schraegstriche drumherum: Ein Backtick in diesem
                --  Kommentar schliesst das JS-Template-Literal und die Datei
                --  laesst sich nicht mehr laden. Am 2026-09-05 zweimal
                --  passiert, siehe scripts/check-migrationen.js.)
                UNIQUE KEY uniq_name (guild_id, streamer_id, name),
                KEY idx_guild (guild_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
    },

    async down(db) {
        // **Die Tabelle bleibt** - dieselbe Regel wie bei Befehlen und Ansagen.
        return;
    }
};
