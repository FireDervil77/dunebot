'use strict';

/**
 * Streaming: die Lose, die aus dem Twitch-Chat kommen.
 *
 * # Warum eine eigene Tabelle und nicht `giveaway_entries`
 *
 * Entschieden vom Betreiber am 2026-09-07: "Twitch soll dort keine Plaetze
 * einnehmen, fuer die das System nicht gemacht ist."
 *
 * `giveaway_entries.user_id` haelt Discord-Kennungen. Kaemen Twitch-Kennungen
 * dazu, rechneten `giveaway_blacklist`, die Teilnehmerstatistik und vier
 * Ausgabestellen ab sofort stillschweigend auf zwei Namensraeumen. Nichts
 * davon stuerzt ab - es wird leise falsch, und das faellt erst auf, wenn eine
 * Erwaehnung auf ein unbeteiligtes Mitglied zeigt.
 *
 * # Warum KEIN Fremdschluessel auf `giveaways`
 *
 * Ein Fremdschluessel ueber die Plugin-Grenze koppelt zwei Schemata, die
 * getrennt installiert und getrennt entfernt werden. Ohne das
 * Verlosungs-Plugin gibt es `giveaways` nicht, und diese Migration wuerde
 * scheitern - an einer Tabelle, mit der sie gar nichts zu tun hat.
 *
 * Der Preis dafuer sind verwaiste Zeilen, wenn eine Verlosung geloescht wird.
 * Die raeumt der taegliche Lauf ab: Lose, die aelter sind als jede sinnvolle
 * Verlosung, kann niemand mehr brauchen.
 *
 * # Kollation
 *
 * `utf8mb4_general_ci` wie alle `streaming_*`-Tabellen. Die
 * `giveaway*`-Tabellen sind `utf8mb4_unicode_ci` - ein JOIN ueber eine
 * Zeichenkette zwischen beiden **wirft**. Deshalb geht die Verbindung ueber
 * `verlosung_id` (INT, kollationsfrei) und ueber Parameter, nie ueber einen
 * JOIN.
 */
module.exports = {
    description: 'Lose aus dem Twitch-Chat',

    async up(db) {
        await db.query(`
            CREATE TABLE IF NOT EXISTS streaming_lose (
                id            BIGINT AUTO_INCREMENT PRIMARY KEY,
                verlosung_id  INT          NOT NULL,
                guild_id      VARCHAR(32)  NOT NULL,
                streamer_id   INT          NOT NULL,
                konto_id      VARCHAR(64)  NOT NULL,
                konto_name    VARCHAR(128) DEFAULT NULL,
                angelegt_am   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY uniq_verlosung_konto (verlosung_id, konto_id),
                KEY idx_verlosung (verlosung_id),
                KEY idx_alter (angelegt_am)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
        `);
    },

    async down(db) {
        await db.query('DROP TABLE IF EXISTS streaming_lose');
    }
};
