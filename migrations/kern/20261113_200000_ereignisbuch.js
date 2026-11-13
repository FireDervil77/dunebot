'use strict';

/**
 * Ereignisbuch und Quittungen der Fachereignisse (G-02, K382, 2026-11-13).
 *
 * Bot und Dashboard sind zwei Prozesse. Ein Ereignis, das im Bot entsteht,
 * muss einen Hörer im Dashboard erreichen, auch wenn das Dashboard gerade neu
 * startet. Deshalb eine Tabelle und kein Weg im Speicher (Vorbild
 * `streaming_outbox`).
 *
 * `ereignisbuch`: eine Zeile je Ereignis, gleich in welchem Prozess gemeldet.
 *   Eindeutig je `(quelle, schluessel)`: Dasselbe zweimal gemeldet ergibt eine
 *   Zeile, `doppelt` zählt die Wiederholungen. `zustand` ist `neu`, bis der
 *   Zusteller die Quittungen angelegt hat, dann `verteilt`.
 * `ereignis_quittungen`: je Ereignis und Abnehmer (Plugin) eine Zeile.
 *   `offen` → `erledigt`, `plugin_aus` (in dieser Guild abgeschaltet) oder nach
 *   zehn Fehlversuchen `liegen_geblieben` (sichtbar unter /admin/ereignisse).
 *
 * Die Frist (sieben Tage, dann löschen) kommt mit G-05, nicht hier.
 * Kollation wie die übrigen Kern-Tabellen, damit der JOIN zwischen beiden geht.
 */
module.exports = {
    description: 'Fachereignisse: Ereignisbuch und Quittungen (G-02)',

    async up(db) {
        await db.query(`
            CREATE TABLE IF NOT EXISTS ereignisbuch (
                id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                name         VARCHAR(64)  NOT NULL,
                version      SMALLINT UNSIGNED NOT NULL,
                guild_id     VARCHAR(20)  NOT NULL,
                quelle       VARCHAR(32)  NOT NULL,
                schluessel   VARCHAR(191) NOT NULL,
                schutz       VARCHAR(16)  NOT NULL,
                schwere      VARCHAR(16)  NOT NULL,
                akteur       VARCHAR(20)  NOT NULL,
                betroffen    VARCHAR(20)  DEFAULT NULL,
                bezug        LONGTEXT     DEFAULT NULL,
                daten        LONGTEXT     NOT NULL,
                zeit         DATETIME(3)  NOT NULL,
                zustand      VARCHAR(16)  NOT NULL DEFAULT 'neu',
                doppelt      INT UNSIGNED NOT NULL DEFAULT 0,
                angelegt_am  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
                verteilt_am  DATETIME(3)  DEFAULT NULL,
                UNIQUE KEY uq_quelle_schluessel (quelle, schluessel),
                KEY idx_zustand (zustand, id),
                KEY idx_guild (guild_id, id),
                KEY idx_name (name, id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS ereignis_quittungen (
                id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                ereignis_id  BIGINT UNSIGNED NOT NULL,
                abnehmer     VARCHAR(32)  NOT NULL,
                zustand      VARCHAR(20)  NOT NULL DEFAULT 'offen',
                versuche     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
                faellig_ab   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
                fehlertext   VARCHAR(512) DEFAULT NULL,
                angelegt_am  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
                erledigt_am  DATETIME(3)  DEFAULT NULL,
                UNIQUE KEY uq_ereignis_abnehmer (ereignis_id, abnehmer),
                KEY idx_faellig (zustand, faellig_ab),
                CONSTRAINT fk_quittung_ereignis FOREIGN KEY (ereignis_id)
                    REFERENCES ereignisbuch (id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
    },

    async down(db) {
        await db.query('DROP TABLE IF EXISTS ereignis_quittungen');
        await db.query('DROP TABLE IF EXISTS ereignisbuch');
    }
};
