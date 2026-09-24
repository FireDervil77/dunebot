'use strict';

/**
 * Probestarts der Werkbank (Stufe 2, 2026-09-24).
 *
 * Ein Lauf ist ein Start des Spiels im Volume der Sitzung: mit welchem
 * Startteil, wie viel RAM und CPU, was die Konsole sagte, was lauschte und wie
 * er endete. Neue Tabelle statt Spalten an `werkbank_sitzungen` — eine Sitzung
 * hat viele Läufe, und der letzte soll den vorletzten nicht überschreiben.
 *
 * `ports` und `bereitschaft` halten jeweils die LETZTE Meldung des Daemons:
 * Er meldet die Ports nach jeder Änderung vollständig, nicht als Unterschied.
 *
 * Kollation wie Stufe 1 (`utf8mb4_unicode_ci`), Fremdschlüssel nur auf die
 * eigene Sitzungstabelle.
 */
module.exports = {
    description: 'Werkbank: Probestarts einer Sitzung',

    async up(db) {
        await db.query(`
            CREATE TABLE IF NOT EXISTS werkbank_laeufe (
                id INT AUTO_INCREMENT PRIMARY KEY,
                sitzung_id INT NOT NULL,
                status ENUM('startet','laeuft','stoppt','beendet') NOT NULL DEFAULT 'startet',
                memory_mb INT NOT NULL,
                cpu_prozent INT NOT NULL
                    COMMENT '100 = ein Kern',
                start LONGTEXT NOT NULL
                    COMMENT 'JSON: der start-Abschnitt, mit dem gestartet wurde',
                konsole MEDIUMTEXT DEFAULT NULL
                    COMMENT 'Ausgabe des Spiels, auf die letzten 200 000 Zeichen begrenzt',
                ports LONGTEXT DEFAULT NULL
                    COMMENT 'JSON [{protocol, port}] — letzte Beobachtung',
                bereitschaft LONGTEXT DEFAULT NULL
                    COMMENT 'JSON — letzte Meldung von fb-init',
                luecken LONGTEXT DEFAULT NULL
                    COMMENT 'JSON — was der Auftragsbau am Entwurf vermisste',
                exit_code INT DEFAULT NULL,
                gestoppt TINYINT(1) DEFAULT NULL,
                fehler TEXT DEFAULT NULL,
                begonnen_am TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                beendet_am TIMESTAMP NULL DEFAULT NULL,
                KEY idx_werkbank_lauf_sitzung (sitzung_id, status),
                CONSTRAINT fk_werkbank_lauf_sitzung FOREIGN KEY (sitzung_id)
                    REFERENCES werkbank_sitzungen (id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
    },

    async down(db) {
        await db.query('DROP TABLE IF EXISTS werkbank_laeufe');
    }
};
