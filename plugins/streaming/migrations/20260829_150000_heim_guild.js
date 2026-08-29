'use strict';

/**
 * Die Heim-Guild eines Kanals (Stufe 14).
 *
 * Hintergrund: `docs/streamer-plugin/14-Rechte-neu-denken.md`, TEIL C.
 *
 * ## Warum es diese Spalte gibt
 *
 * Am 2026-08-28 gab der Betreiber einem zweiten Streamer Zugriff auf das
 * Streaming-Plugin seiner Guild und stellte fest, dass damit **alles** offen
 * steht. Der Befund war schaerfer als die Beschreibung: Es gab im ganzen
 * Plugin keine einzige Eigentumspruefung.
 *
 * Die Loesung ist nicht ein zweites Rechtesystem, sondern ein Schnitt:
 *
 *     VERFOLGUNG (Ankuendigung, Melder, Live-Rolle)
 *        beliebig viele Guilds je Kanal        <- bleibt wie es war
 *
 *     CHATBOT (Befehle, Timer, Filter)
 *        GENAU EINE Guild je Kanal             <- diese Spalte
 *
 * Damit stellt sich die Ausgangsfrage nicht mehr: Ein fremder Streamer
 * richtet seinen Chatbot in SEINEM Discord ein, nicht in dem des Betreibers.
 * Die eine Guild verfolgt seinen Stream - mehr Beruehrung gibt es nicht.
 *
 * ## Warum am Streamer und nicht am Ziel
 *
 * Ein Ziel gehoert einer Guild; davon gibt es viele je Kanal. Die Heim-Guild
 * ist aber eine Eigenschaft des **Kanals** - er hat genau eine. Stuende sie
 * am Ziel, koennte derselbe Kanal in zwei Guilds zwei Heimaten haben, und
 * `!discord` wuesste nicht, welchen Link er nennen soll (F-18).
 *
 * ## NULL heisst aus, und das ist der Normalfall
 *
 * Kein Kanal bekommt hier einen Wert. **Setzen darf ihn nur der
 * Kanalinhaber**, nachgewiesen ueber `user_connections` - sonst traegt jemand
 * einen fremden Kanal ein, erklaert seine Guild zum Heim und redet in einem
 * fremden Twitch-Chat. Eine Vorbelegung waere genau diese Selbsternennung,
 * nur von uns ausgefuehrt.
 */

module.exports = {
    description: 'Heim-Guild am Streamer: wo der Chatbot dieses Kanals verwaltet wird',

    async up(db) {
        // **Nicht destrukturieren.** `db.query()` liefert hier die Zeilen
        // direkt; `const [x] = await db.query(...)` griffe die erste ZEILE und
        // die Waechterabfrage liefe ins Leere - bei vorhandener Spalte waere
        // `Array.isArray(x)` falsch, `Number(x)` NaN, und das ALTER liefe
        // trotzdem. 22 Altdateien tragen den Fehler und sind eingefroren;
        // neue duerfen ihn nicht erben (`scripts/check-migrationen.js`).
        const vorhanden = await db.query(`
            SELECT COLUMN_NAME FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'streaming_streamers'
               AND COLUMN_NAME = 'heim_guild_id'
        `);

        if (!vorhanden.length) {
            await db.query(`
                ALTER TABLE streaming_streamers
                  ADD COLUMN heim_guild_id VARCHAR(32) DEFAULT NULL
            `);
        }

        // Der Index traegt die Frage, die im Betrieb wirklich gestellt wird:
        // "Ist DIESE Guild das Heim von irgendetwas?" - einmal je Aufbau der
        // Navigation, also oft.
        const idx = await db.query(`
            SELECT INDEX_NAME FROM information_schema.STATISTICS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'streaming_streamers'
               AND INDEX_NAME = 'idx_heim_guild'
        `);
        if (!idx.length) {
            await db.query('ALTER TABLE streaming_streamers ADD INDEX idx_heim_guild (heim_guild_id)');
        }
    },

    async down(db) {
        // **Die Spalte bleibt.** Sie zu entfernen hiesse, jedem Streamer seine
        // Wahl zu nehmen - und ein Rueckbau des Codes ist kein Grund, eine
        // Entscheidung des Nutzers zu loeschen. Dieselbe Regel wie bei
        // `abo_rolle_id`.
        void db;
    }
};
