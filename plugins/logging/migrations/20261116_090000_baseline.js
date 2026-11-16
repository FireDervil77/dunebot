'use strict';

/**
 * Logging Stufe 1: alle Tabellen des Plugins (LG-1a, K382, 2026-11-16).
 *
 * Alle Tabellen aus dem Konzept sind dabei, auch die für Inhalte, Zustellung,
 * Zugriffe, Filter und Alarme. Sie bleiben leer, bis ihre Stufe kommt, und
 * brauchen dann keine Umbaumigration.
 *
 *   log_einstellungen  eine Zeile je Guild: Darstellung, Bündeln, Zeitzone,
 *                      Entscheidung über Inhalte (F-LG2, bis dahin `offen`)
 *   log_regeln         Kategorie an/aus, Art aus, Ausschlüsse (Mitglied,
 *                      Rolle, Kanal, Bots). Fehlt eine Kategorie-Zeile, gilt
 *                      die Vorgabe aus `shared/katalog.js`
 *   log_ereignisse     ein Ereignis, nur Metadaten (Vorher/Nachher ohne Text)
 *   log_namen          Name und Anzeigename eines Mitglieds zur Zeit des
 *                      Ereignisses, damit „wer war das“ nach Austritt lesbar bleibt
 *   log_inhalte        Nachrichtentext zu einem Ereignis (Stufe 2, nach G-04)
 *   log_nachrichten    Stand einer Nachricht beim Schreiben (Stufe 2)
 *   log_anhaenge       Name, Größe, Typ je Anhang, nie eine Kopie (F-LG3)
 *   log_ziele          Kategorie/Art → Kanal mit Webhook (LG-1d)
 *   log_zustellungen   Ereignis → Ziel mit Zustand und Versuchen (LG-1d)
 *   log_zugriffe       wer im Dashboard Inhalte sah oder exportierte (Stufe 2)
 *   log_filter         gespeicherte Suchen (Stufe 2)
 *   log_alarme         Security Center (Stufe 3)
 *
 * Inhalte stehen getrennt von den Metadaten (Idee §9.3): eigene Frist, und
 * „meine Daten löschen“ trifft sie ganz (F-G2).
 */
module.exports = {
    description: 'Logging: Einstellungen, Regeln, Ereignisse, Namen, Inhalte, Ziele, Zustellungen, Zugriffe, Filter, Alarme (LG-1a)',

    async up(db) {
        await db.query(`
            CREATE TABLE IF NOT EXISTS log_einstellungen (
                guild_id      VARCHAR(20)  NOT NULL,
                darstellung   ENUM('kompakt','ausfuehrlich') NOT NULL DEFAULT 'ausfuehrlich',
                buendeln_ms   INT          NOT NULL DEFAULT 2000,
                zeitzone      VARCHAR(64)  NULL,
                inhalte       ENUM('offen','ja','nein') NOT NULL DEFAULT 'offen',
                geaendert     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
                PRIMARY KEY (guild_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        await db.query(`
            CREATE TABLE IF NOT EXISTS log_regeln (
                id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
                guild_id     VARCHAR(20)  NOT NULL,
                regel        ENUM('kategorie','art','mitglied','rolle','kanal','bots') NOT NULL,
                ziel         VARCHAR(64)  NOT NULL DEFAULT '',
                aktiv        TINYINT(1)   NOT NULL DEFAULT 1,
                geaendert    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
                PRIMARY KEY (id),
                UNIQUE KEY uq_regel (guild_id, regel, ziel)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        await db.query(`
            CREATE TABLE IF NOT EXISTS log_ereignisse (
                id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                guild_id      VARCHAR(20)  NOT NULL,
                zeit          DATETIME(3)  NOT NULL,
                kategorie     VARCHAR(32)  NOT NULL,
                art           VARCHAR(64)  NOT NULL,
                schwere       ENUM('info','warnung','kritisch') NOT NULL DEFAULT 'info',
                quelle        VARCHAR(64)  NOT NULL DEFAULT 'discord',
                akteur_id     VARCHAR(20)  NULL,
                betroffen_id  VARCHAR(20)  NULL,
                kanal_id      VARCHAR(20)  NULL,
                objekt_typ    VARCHAR(32)  NULL,
                objekt_id     VARCHAR(20)  NULL,
                objekt_name   VARCHAR(200) NULL,
                vorher        JSON         NULL,
                nachher       JSON         NULL,
                zuordnung     ENUM('sicher','wahrscheinlich','unbekannt') NOT NULL DEFAULT 'unbekannt',
                verknuepft    JSON         NULL,
                schluessel    VARCHAR(64)  NOT NULL,
                angelegt_am   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
                PRIMARY KEY (id),
                UNIQUE KEY uq_schluessel (guild_id, schluessel),
                KEY idx_zeit (guild_id, zeit),
                KEY idx_kategorie (guild_id, kategorie, zeit),
                KEY idx_akteur (guild_id, akteur_id),
                KEY idx_betroffen (guild_id, betroffen_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        await db.query(`
            CREATE TABLE IF NOT EXISTS log_namen (
                guild_id      VARCHAR(20)  NOT NULL,
                mitglied_id   VARCHAR(20)  NOT NULL,
                name          VARCHAR(100) NOT NULL,
                anzeigename   VARCHAR(100) NOT NULL DEFAULT '',
                bot           TINYINT(1)   NOT NULL DEFAULT 0,
                zuerst        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
                zuletzt       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
                PRIMARY KEY (guild_id, mitglied_id, name, anzeigename),
                KEY idx_zuletzt (guild_id, mitglied_id, zuletzt)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        await db.query(`
            CREATE TABLE IF NOT EXISTS log_inhalte (
                ereignis_id   BIGINT UNSIGNED NOT NULL,
                guild_id      VARCHAR(20)  NOT NULL,
                autor_id      VARCHAR(20)  NULL,
                text_vorher   MEDIUMTEXT   NULL,
                text_nachher  MEDIUMTEXT   NULL,
                geschwaerzt   TINYINT(1)   NOT NULL DEFAULT 0,
                angelegt_am   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
                PRIMARY KEY (ereignis_id),
                KEY idx_guild (guild_id, angelegt_am),
                KEY idx_autor (guild_id, autor_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        await db.query(`
            CREATE TABLE IF NOT EXISTS log_nachrichten (
                nachricht_id  VARCHAR(20)  NOT NULL,
                guild_id      VARCHAR(20)  NOT NULL,
                kanal_id      VARCHAR(20)  NOT NULL,
                autor_id      VARCHAR(20)  NOT NULL,
                text          MEDIUMTEXT   NULL,
                geschwaerzt   TINYINT(1)   NOT NULL DEFAULT 0,
                zeit          DATETIME(3)  NOT NULL,
                PRIMARY KEY (nachricht_id),
                KEY idx_guild (guild_id, zeit),
                KEY idx_autor (guild_id, autor_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        await db.query(`
            CREATE TABLE IF NOT EXISTS log_anhaenge (
                id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                guild_id      VARCHAR(20)  NOT NULL,
                nachricht_id  VARCHAR(20)  NOT NULL,
                autor_id      VARCHAR(20)  NULL,
                dateiname     VARCHAR(255) NOT NULL,
                groesse       BIGINT UNSIGNED NOT NULL DEFAULT 0,
                typ           VARCHAR(128) NULL,
                zeit          DATETIME(3)  NOT NULL,
                PRIMARY KEY (id),
                KEY idx_nachricht (nachricht_id),
                KEY idx_guild (guild_id, zeit),
                KEY idx_autor (guild_id, autor_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        await db.query(`
            CREATE TABLE IF NOT EXISTS log_ziele (
                id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
                guild_id      VARCHAR(20)  NOT NULL,
                kategorie     VARCHAR(32)  NOT NULL,
                art           VARCHAR(64)  NOT NULL DEFAULT '',
                kritisch      TINYINT(1)   NOT NULL DEFAULT 0,
                kanal_id      VARCHAR(20)  NOT NULL,
                webhook_id    VARCHAR(20)  NULL,
                webhook_token VARCHAR(128) NULL,
                zustand       ENUM('ok','kein_recht','kanal_fehlt','fehler') NOT NULL DEFAULT 'ok',
                grund         VARCHAR(255) NULL,
                geaendert     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
                PRIMARY KEY (id),
                UNIQUE KEY uq_ziel (guild_id, kategorie, art, kritisch, kanal_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        await db.query(`
            CREATE TABLE IF NOT EXISTS log_zustellungen (
                id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                guild_id      VARCHAR(20)  NOT NULL,
                ereignis_id   BIGINT UNSIGNED NOT NULL,
                ziel_id       INT UNSIGNED NOT NULL,
                zustand       ENUM('offen','gesendet','liegen_geblieben') NOT NULL DEFAULT 'offen',
                versuche      INT          NOT NULL DEFAULT 0,
                naechster     DATETIME(3)  NULL,
                fehler        VARCHAR(255) NULL,
                nachricht_id  VARCHAR(20)  NULL,
                angelegt_am   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
                PRIMARY KEY (id),
                UNIQUE KEY uq_zustellung (ereignis_id, ziel_id),
                KEY idx_offen (zustand, naechster),
                KEY idx_guild (guild_id, zustand)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        await db.query(`
            CREATE TABLE IF NOT EXISTS log_zugriffe (
                id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                guild_id      VARCHAR(20)  NOT NULL,
                nutzer_id     VARCHAR(20)  NOT NULL,
                aktion        ENUM('inhalt_angesehen','export') NOT NULL,
                was           VARCHAR(255) NULL,
                zeit          DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
                PRIMARY KEY (id),
                KEY idx_guild (guild_id, zeit),
                KEY idx_nutzer (guild_id, nutzer_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        await db.query(`
            CREATE TABLE IF NOT EXISTS log_filter (
                id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
                guild_id      VARCHAR(20)  NOT NULL,
                nutzer_id     VARCHAR(20)  NOT NULL,
                name          VARCHAR(100) NOT NULL,
                filter        JSON         NOT NULL,
                angelegt_am   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
                PRIMARY KEY (id),
                UNIQUE KEY uq_filter (guild_id, nutzer_id, name)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        await db.query(`
            CREATE TABLE IF NOT EXISTS log_alarme (
                id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                guild_id      VARCHAR(20)  NOT NULL,
                regel         VARCHAR(64)  NOT NULL,
                schwere       ENUM('info','warnung','kritisch') NOT NULL DEFAULT 'warnung',
                ereignisse    JSON         NULL,
                zustand       ENUM('offen','gesehen','erledigt') NOT NULL DEFAULT 'offen',
                angelegt_am   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
                geaendert     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
                PRIMARY KEY (id),
                KEY idx_guild (guild_id, zustand, angelegt_am)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
    },
};
