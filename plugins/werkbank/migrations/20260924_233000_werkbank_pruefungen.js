'use strict';

/**
 * Prüfdurchläufe der Werkbank (Stufe 3, 2026-09-24).
 *
 * Ein Durchlauf installiert den Entwurf auf einem leeren Volume, startet und
 * stoppt ihn (Daemon: werkbank.pruefen). Gespeichert wird der Entwurf, der
 * GEPRÜFT wurde, und sein Fingerabdruck: Stufe 4 veröffentlicht nur einen
 * Entwurf, dessen letzter Durchlauf grün war und der sich seither nicht
 * geändert hat — verglichen wird `entwurf_hash` mit dem Stand von jetzt.
 */
module.exports = {
    description: 'Werkbank: Prüfdurchläufe',

    async up(db) {
        await db.query(`
            CREATE TABLE IF NOT EXISTS werkbank_pruefungen (
                id INT AUTO_INCREMENT PRIMARY KEY,
                sitzung_id INT NOT NULL,
                status ENUM('laeuft','gruen','rot') NOT NULL DEFAULT 'laeuft',
                entwurf LONGTEXT NOT NULL
                    COMMENT 'JSON: das Paket, wie es geprüft wurde',
                entwurf_hash CHAR(64) NOT NULL
                    COMMENT 'sha256 über den Entwurf mit sortierten Schlüsseln',
                ergebnis LONGTEXT DEFAULT NULL
                    COMMENT 'JSON: Urteil des Daemons (gruen, gruende, Zeiten, Dateien)',
                protokoll MEDIUMTEXT DEFAULT NULL
                    COMMENT 'Installation und Konsole, auf die letzten 200 000 Zeichen begrenzt',
                begonnen_am TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                beendet_am TIMESTAMP NULL DEFAULT NULL,
                KEY idx_werkbank_pruefung_sitzung (sitzung_id, status),
                CONSTRAINT fk_werkbank_pruefung_sitzung FOREIGN KEY (sitzung_id)
                    REFERENCES werkbank_sitzungen (id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
    },

    async down(db) {
        await db.query('DROP TABLE IF EXISTS werkbank_pruefungen');
    }
};
