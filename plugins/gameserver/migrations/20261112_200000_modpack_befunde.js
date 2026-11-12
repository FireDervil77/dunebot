'use strict';

/**
 * Der Server-Befund je Modpack-Fassung (K226, vorher Baustelle 187).
 *
 * Katalogwissen ohne Guild-Bezug: Eine Fassung bei Modrinth ändert sich nie,
 * ihr Befund wird einmal gerechnet und gilt für alle. Deshalb keine
 * `guild_id`, kein Fremdschlüssel und kein JOIN auf Kerntabellen.
 *
 *   quelle, fassung_id   Schlüssel — `modrinth` und die Kennung der Fassung
 *   kennung, fassung     Slug und Fassungsnummer, zum Lesen
 *   stufe                1 = Bestandteile laut Modrinth, 2 = Archiv und
 *                        Pflichtabhängigkeiten geprüft
 *   regel                Stand der Prüfregel (`PackBefund.REGEL`). Eine Zeile
 *                        mit älterer Regel gilt als nicht vorhanden.
 *   urteil               laeuft · laeuft_ohne_client · unvollstaendig · unklar
 *   auslassen            JSON {sha1, namen} — genau das, was der Daemon bekommt
 *   fehlt                JSON-Liste der fehlenden Pflicht-Mods mit „gebraucht von"
 *   einzelheiten         JSON: Zahlen, was nicht lesbar war, externe Listen
 *
 * Gelesen und geschrieben nur von `dashboard/helpers/PackBefund.js`.
 */
module.exports = {
    description: 'modpack_befunde — Server-Befund je Modpack-Fassung (K226)',

    async up(db) {
        // `SHOW TABLES` statt `CREATE TABLE IF NOT EXISTS`: Letzteres legt bei
        // einer abweichenden Tabelle nichts an und meldet trotzdem Erfolg.
        const [vorhanden] = await db.query("SHOW TABLES LIKE 'modpack_befunde'");
        if (vorhanden) return;

        await db.query(`
            CREATE TABLE modpack_befunde (
                quelle        VARCHAR(20)  NOT NULL
                              COMMENT 'Anbieter; heute nur modrinth',
                fassung_id    VARCHAR(64)  NOT NULL
                              COMMENT 'Kennung der Fassung beim Anbieter — unveränderlich',
                kennung       VARCHAR(190) NOT NULL COMMENT 'Slug des Pakets, zum Lesen',
                fassung       VARCHAR(190) NOT NULL COMMENT 'Fassungsnummer, zum Lesen',
                stufe         TINYINT UNSIGNED NOT NULL
                              COMMENT '1 = Bestandteile, 2 = Archiv und Abhängigkeiten geprüft',
                regel         SMALLINT UNSIGNED NOT NULL
                              COMMENT 'Stand der Prüfregel; ältere Zeilen werden neu gerechnet',
                urteil        VARCHAR(30)  NOT NULL
                              COMMENT 'laeuft, laeuft_ohne_client, unvollstaendig, unklar',
                auslassen     LONGTEXT DEFAULT NULL COMMENT 'JSON {sha1, namen} der reinen Client-Mods',
                fehlt         LONGTEXT DEFAULT NULL COMMENT 'JSON-Liste fehlender Pflicht-Mods',
                einzelheiten  LONGTEXT DEFAULT NULL COMMENT 'JSON: Zahlen und Begründungen',
                geprueft_am   DATETIME NOT NULL,
                dauer_ms      INT UNSIGNED NOT NULL DEFAULT 0,
                PRIMARY KEY (quelle, fassung_id),
                KEY idx_urteil (urteil)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
              COMMENT='Server-Befund je Modpack-Fassung (K226)'
        `);
    },

    async down(db) {
        await db.query('DROP TABLE IF EXISTS modpack_befunde');
    },
};
