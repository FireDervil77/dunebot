'use strict';

/**
 * Fortschritts-Bibliothek (G-20, F-G8, F-CL8, K382, 2026-11-14).
 *
 * Buchungen, Stand, Stufentabellen und Saisons für jeden Fortschritt einer
 * Guild, unterschieden nach Kennung (`leveling:community`, `clan:<clan_id>`).
 * Geschrieben wird nur über `Fortschritt` im SDK
 * (`packages/dunebot-sdk/lib/Fortschritt.js`), dort stehen die Regeln.
 *
 *   fortschritt_buchungen     die Wahrheit: jede Vergabe eine Zeile, eindeutig
 *                             je Guild, Kennung und Schlüssel; Storno markiert
 *                             die Zeile. Alte Zeilen verdichtet die
 *                             Aufbewahrung zu Monatssummen (`kern:verdichtet`).
 *   fortschritt_stand         Summe der nicht stornierten Buchungen je
 *                             Mitglied, dazu Level und Prestige; jederzeit aus
 *                             den Buchungen neu rechenbar
 *   fortschritt_stufen        je Guild und Kennung die Stufen 1..n mit
 *                             Gesamt-XP-Schwelle, frei einstellbar
 *   fortschritt_einstellungen je Guild und Kennung: Prestige, geladene Schablone;
 *                             die Zeile zeigt auch, dass die Stufen einmal
 *                             eingespielt wurden
 *   fortschritt_saisons       befristete Ranglisten einer Kennung; der
 *                             Dauerstand bleibt davon unberührt (Leveling-Idee §8)
 *   fortschritt_saison_stand  XP je Mitglied in einer Saison
 *
 * Mitglied löscht seine Daten: Buchungen, Stand und Saisonstand gehen
 * (`plugins/core/package.json` `mitgliedInhalte`). Guild geht: alles geht
 * (`guildInhalte`).
 */
module.exports = {
    description: 'Fortschritts-Bibliothek: Buchungen, Stand, Stufen, Saisons (G-20)',

    async up(db) {
        await db.query(`
            CREATE TABLE IF NOT EXISTS fortschritt_buchungen (
                id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                guild_id      VARCHAR(20)  NOT NULL,
                kennung       VARCHAR(90)  NOT NULL,
                mitglied_id   VARCHAR(20)  NOT NULL,
                menge         BIGINT       NOT NULL,
                verlangt      BIGINT       NULL,
                quelle        VARCHAR(64)  NOT NULL,
                schluessel    VARCHAR(160) NOT NULL,
                akteur        VARCHAR(20)  NULL,
                grund         VARCHAR(255) NULL,
                zeit          DATETIME(3)  NOT NULL,
                storniert_am  DATETIME(3)  NULL,
                storniert_von VARCHAR(20)  NULL,
                storno_grund  VARCHAR(255) NULL,
                PRIMARY KEY (id),
                UNIQUE KEY uq_schluessel (guild_id, kennung, schluessel),
                KEY idx_zeit (guild_id, kennung, zeit),
                KEY idx_mitglied_zeit (guild_id, kennung, mitglied_id, zeit),
                KEY idx_alter (zeit),
                KEY idx_mitglied (mitglied_id),
                KEY idx_akteur (akteur)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        await db.query(`
            CREATE TABLE IF NOT EXISTS fortschritt_stand (
                guild_id     VARCHAR(20) NOT NULL,
                kennung      VARCHAR(90) NOT NULL,
                mitglied_id  VARCHAR(20) NOT NULL,
                xp           BIGINT      NOT NULL DEFAULT 0,
                level        INT         NOT NULL DEFAULT 0,
                prestige     INT         NOT NULL DEFAULT 0,
                geaendert    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
                PRIMARY KEY (guild_id, kennung, mitglied_id),
                KEY idx_rang (guild_id, kennung, prestige, xp),
                KEY idx_mitglied (mitglied_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        await db.query(`
            CREATE TABLE IF NOT EXISTS fortschritt_stufen (
                guild_id  VARCHAR(20)  NOT NULL,
                kennung   VARCHAR(90)  NOT NULL,
                stufe     INT          NOT NULL,
                name      VARCHAR(100) NULL,
                schwelle  BIGINT       NOT NULL,
                PRIMARY KEY (guild_id, kennung, stufe)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        await db.query(`
            CREATE TABLE IF NOT EXISTS fortschritt_einstellungen (
                guild_id   VARCHAR(20) NOT NULL,
                kennung    VARCHAR(90) NOT NULL,
                prestige   TINYINT(1)  NOT NULL DEFAULT 0,
                schablone  VARCHAR(32) NULL,
                geaendert  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
                PRIMARY KEY (guild_id, kennung)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        await db.query(`
            CREATE TABLE IF NOT EXISTS fortschritt_saisons (
                id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
                guild_id    VARCHAR(20)  NOT NULL,
                kennung     VARCHAR(90)  NOT NULL,
                name        VARCHAR(100) NOT NULL,
                beginn      DATETIME     NOT NULL,
                ende        DATETIME     NOT NULL,
                regel       ENUM('archivieren','zuruecksetzen') NOT NULL DEFAULT 'archivieren',
                beendet_am  DATETIME(3)  NULL,
                angelegt_am DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
                PRIMARY KEY (id),
                KEY idx_kennung (guild_id, kennung, beginn),
                KEY idx_faellig (beendet_am, ende)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        await db.query(`
            CREATE TABLE IF NOT EXISTS fortschritt_saison_stand (
                saison_id    INT UNSIGNED NOT NULL,
                guild_id     VARCHAR(20)  NOT NULL,
                mitglied_id  VARCHAR(20)  NOT NULL,
                xp           BIGINT       NOT NULL DEFAULT 0,
                PRIMARY KEY (saison_id, mitglied_id),
                KEY idx_rang (saison_id, xp),
                KEY idx_guild (guild_id),
                KEY idx_mitglied (mitglied_id),
                CONSTRAINT fk_fortschritt_saison FOREIGN KEY (saison_id)
                    REFERENCES fortschritt_saisons (id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
    },

    async down(db) {
        await db.query('DROP TABLE IF EXISTS fortschritt_saison_stand');
        await db.query('DROP TABLE IF EXISTS fortschritt_saisons');
        await db.query('DROP TABLE IF EXISTS fortschritt_einstellungen');
        await db.query('DROP TABLE IF EXISTS fortschritt_stufen');
        await db.query('DROP TABLE IF EXISTS fortschritt_stand');
        await db.query('DROP TABLE IF EXISTS fortschritt_buchungen');
    }
};
