'use strict';

/**
 * Sitzungen und Schritte der Werkbank (Stufe 1, 2026-09-24).
 *
 * ## Zwei Tabellen, und was NICHT doppelt steht
 *
 * `werkbank_sitzungen` hält, was eine Sitzung ausmacht: Name, Maschine, Image
 * und den Paket-Entwurf (Entscheidung 2a: „eigene tabelle aus dem plugin").
 * `werkbank_schritte` hält jeden ausgeführten Schritt mit Status und Ausgabe.
 *
 * Die Schritte des Rezepts stehen NICHT zusätzlich im Entwurf. Sie werden aus
 * den Schritten mit Status `ok` abgeleitet (helpers/Sitzungen.js,
 * `entwurfAlsPaket`). Zwei Listen derselben Schritte laufen beim ersten
 * „aus dem Entwurf nehmen" auseinander.
 *
 * ## Kennung
 *
 * `kennung` ist die Sitzungskennung beim Daemon und wird dort Teil eines
 * Pfades (`.werkbank/<kennung>/`) und eines Containernamens — deshalb nur
 * `[a-z0-9-]`, dieselbe Regel wie `reSitzung` im Daemon.
 *
 * ## Keine Verknüpfung zu Kern-Tabellen
 *
 * `guild_id` und `rootserver_id` stehen als Werte, ohne Fremdschlüssel auf
 * Kern-Tabellen: Ein Plugin, das abgeschaltet und entfernt wird, soll nicht an
 * einer Kern-Tabelle hängen. Die Kollation ist dieselbe wie im Kern
 * (`utf8mb4_unicode_ci`, nachgesehen an `guilds` und `rootserver`) — einige
 * ältere Plugin-Tabellen haben `general_ci`, und ein JOIN darüber wirft
 * (scripts/check-kollationen.js).
 */
module.exports = {
    description: 'Werkbank: Sitzungen und ihre Schritte',

    async up(db) {
        await db.query(`
            CREATE TABLE IF NOT EXISTS werkbank_sitzungen (
                id INT AUTO_INCREMENT PRIMARY KEY,
                kennung VARCHAR(63) NOT NULL
                    COMMENT 'Sitzungskennung beim Daemon: .werkbank/<kennung>/',
                guild_id VARCHAR(20) NOT NULL,
                angelegt_von VARCHAR(20) DEFAULT NULL,
                name VARCHAR(100) NOT NULL,
                rootserver_id INT NOT NULL,
                image LONGTEXT NOT NULL
                    COMMENT 'JSON {ref, tag, digest} — das Basis-Image der Sitzung',
                entwurf LONGTEXT DEFAULT NULL
                    COMMENT 'JSON: Paket-Entwurf OHNE install.steps (die kommen aus werkbank_schritte)',
                status ENUM('offen','verworfen') NOT NULL DEFAULT 'offen',
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY uq_werkbank_kennung (kennung),
                KEY idx_werkbank_guild (guild_id, status)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS werkbank_schritte (
                id INT AUTO_INCREMENT PRIMARY KEY,
                sitzung_id INT NOT NULL,
                nr INT NOT NULL,
                schritt LONGTEXT NOT NULL
                    COMMENT 'JSON: ein Schritt nach FBPKG_v1 (install.steps[])',
                status ENUM('laeuft','ok','fehler','herausgenommen') NOT NULL DEFAULT 'laeuft',
                ausgabe MEDIUMTEXT DEFAULT NULL
                    COMMENT 'Ausgabe des Laufs, auf die letzten 200 000 Zeichen begrenzt',
                fehler TEXT DEFAULT NULL,
                bytes BIGINT DEFAULT NULL
                    COMMENT 'Belegter Platz der Sitzung nach diesem Schritt',
                begonnen_am TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                beendet_am TIMESTAMP NULL DEFAULT NULL,
                KEY idx_werkbank_schritt_sitzung (sitzung_id, nr),
                CONSTRAINT fk_werkbank_schritt_sitzung FOREIGN KEY (sitzung_id)
                    REFERENCES werkbank_sitzungen (id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
    },

    async down(db) {
        await db.query('DROP TABLE IF EXISTS werkbank_schritte');
        await db.query('DROP TABLE IF EXISTS werkbank_sitzungen');
    }
};
