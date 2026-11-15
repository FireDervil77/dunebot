'use strict';

/**
 * Leveling Stufe 1: alle Tabellen des Plugins (LV-1a, K382, 2026-11-15).
 *
 * Buchungen, Stand, Stufen und Saisons liegen im Kern (G-20, `fortschritt_*`,
 * Kennung `leveling:community`). Hier stehen nur die Regeln der Guild und die
 * Zähler. Alle Tabellen der späteren Stufen sind schon dabei (Belohnungen,
 * Boosts), damit die keine Umbaumigration brauchen.
 *
 *   level_einstellungen  eine Zeile je Guild: Spamschutz, Storno, Level-up-
 *                        Ausgabe (LV-1f), Sprache (LV-1d), Verlassen
 *   level_quellen        je Guild und Quelle (`nachricht`, `sprache`, später
 *                        Ereignisnamen): XP von/bis, Taktung, an/aus
 *   level_regeln         Kanäle und Rollen: ausschließen, nur diese, Faktor
 *   level_zaehler        je Mitglied: Nachrichten, Sprachminuten, Reaktionen
 *                        (für Abzeichen und Profil, ohne Inhalt)
 *   level_belohnungen    je Stufe: Rolle geben/nehmen, Abzeichen, XP, Ereignis (LV-1e)
 *   level_boosts         befristeter Faktor (Stufe 3)
 *
 * Die Vorgaben stehen als Spaltenvorgaben hier und in
 * `shared/vorgaben.js` (Quellen). Sie sind nur Startwerte, alles ist je
 * Guild einstellbar (F-CL8).
 */
module.exports = {
    description: 'Leveling: Einstellungen, Quellen, Regeln, Zähler, Belohnungen, Boosts (LV-1a)',

    async up(db) {
        await db.query(`
            CREATE TABLE IF NOT EXISTS level_einstellungen (
                guild_id              VARCHAR(20)  NOT NULL,
                mindestlaenge         INT          NOT NULL DEFAULT 3,
                gleiche_fenster_s     INT          NOT NULL DEFAULT 300,
                storno_loeschen_min   INT          NOT NULL DEFAULT 10,
                storno_automod        TINYINT(1)   NOT NULL DEFAULT 1,
                ausgabe_modus         ENUM('aus','kanal_der_nachricht','level_kanal','direktnachricht') NOT NULL DEFAULT 'level_kanal',
                ausgabe_kanal         VARCHAR(20)  NULL,
                nur_meilensteine      TINYINT(1)   NOT NULL DEFAULT 0,
                meilensteine          JSON         NULL,
                rangkarte_anhaengen   TINYINT(1)   NOT NULL DEFAULT 0,
                vorherige_rollen_entfernen TINYINT(1) NOT NULL DEFAULT 0,
                sprache_min_menschen  INT          NOT NULL DEFAULT 2,
                sprache_stumm_zaehlt  TINYINT(1)   NOT NULL DEFAULT 1,
                verlassen             ENUM('behalten','loeschen') NOT NULL DEFAULT 'behalten',
                geaendert             DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
                PRIMARY KEY (guild_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        await db.query(`
            CREATE TABLE IF NOT EXISTS level_quellen (
                guild_id   VARCHAR(20) NOT NULL,
                quelle     VARCHAR(64) NOT NULL,
                xp_von     INT         NOT NULL,
                xp_bis     INT         NOT NULL,
                taktung_s  INT         NOT NULL DEFAULT 60,
                aktiv      TINYINT(1)  NOT NULL DEFAULT 1,
                geaendert  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
                PRIMARY KEY (guild_id, quelle)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        await db.query(`
            CREATE TABLE IF NOT EXISTS level_regeln (
                id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
                guild_id   VARCHAR(20)  NOT NULL,
                art        ENUM('kanal','rolle') NOT NULL,
                ziel_id    VARCHAR(20)  NOT NULL,
                wirkung    ENUM('ausschliessen','nur','faktor') NOT NULL,
                faktor     DECIMAL(6,2) NULL,
                quelle     VARCHAR(64)  NULL,
                angelegt_am DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
                PRIMARY KEY (id),
                UNIQUE KEY uq_regel (guild_id, art, ziel_id, wirkung, quelle),
                KEY idx_guild (guild_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        await db.query(`
            CREATE TABLE IF NOT EXISTS level_zaehler (
                guild_id        VARCHAR(20) NOT NULL,
                mitglied_id     VARCHAR(20) NOT NULL,
                nachrichten     BIGINT      NOT NULL DEFAULT 0,
                sprachminuten   BIGINT      NOT NULL DEFAULT 0,
                reaktionen      BIGINT      NOT NULL DEFAULT 0,
                erste_nachricht DATETIME(3) NULL,
                geaendert       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
                PRIMARY KEY (guild_id, mitglied_id),
                KEY idx_mitglied (mitglied_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        await db.query(`
            CREATE TABLE IF NOT EXISTS level_belohnungen (
                id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
                guild_id    VARCHAR(20)  NOT NULL,
                stufe       INT          NOT NULL,
                art         ENUM('rolle_geben','rolle_nehmen','abzeichen','xp','ereignis') NOT NULL,
                wert        VARCHAR(100) NOT NULL,
                angelegt_am DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
                PRIMARY KEY (id),
                UNIQUE KEY uq_belohnung (guild_id, stufe, art, wert),
                KEY idx_stufe (guild_id, stufe)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        await db.query(`
            CREATE TABLE IF NOT EXISTS level_boosts (
                id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
                guild_id    VARCHAR(20)  NOT NULL,
                faktor      DECIMAL(6,2) NOT NULL,
                ziel_art    ENUM('alle','rolle','kanal') NOT NULL DEFAULT 'alle',
                ziel_id     VARCHAR(20)  NULL,
                beginn      DATETIME     NOT NULL,
                ende        DATETIME     NOT NULL,
                grund       VARCHAR(255) NULL,
                akteur      VARCHAR(20)  NULL,
                angelegt_am DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
                PRIMARY KEY (id),
                KEY idx_zeit (guild_id, beginn, ende),
                KEY idx_akteur (akteur)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
    },

    async down(db) {
        for (const t of ['level_boosts', 'level_belohnungen', 'level_zaehler', 'level_regeln', 'level_quellen', 'level_einstellungen']) {
            await db.query(`DROP TABLE IF EXISTS ${t}`);
        }
    }
};
