'use strict';

/**
 * Entfernt die Leichentabelle `daemon_instances`.
 *
 * Migration 2.0.0 hat die Tabelle in `rootserver` aufgelöst — jeder RootServer
 * trägt seine Verbindungs- und Statusfelder seither selbst. Nur stand diese
 * Migration in `dashboard/migrations/`, einem Ordner, den kein Runner liest
 * (der `MigrationRunner` kennt `plugins/<name>/migrations/`). Der Drop ist damit
 * nie gelaufen.
 *
 * Die Baseline legt `daemon_instances` weiterhin an, jede Neuinstallation
 * bekommt sie also frisch dazu. Im Produktionsbestand stand sie mit null Zeilen
 * da: `RootServer.js` beschreibt sie nicht, der IPMServer liest sie nicht, das
 * Cleanup in `onGuildDisable` erwähnt sie nur noch in einem Kommentar.
 *
 * Die Baseline selbst bleibt unangetastet — sie beschreibt den historischen
 * Ausgangszustand, und diese Migration ist genau der Schritt, der ihn korrigiert.
 */
module.exports = {
    description: 'Leichentabelle daemon_instances entfernen (seit 2.0.0 in rootserver aufgelöst)',

    async up(db) {
        const [vorhanden] = await db.query(`
            SELECT TABLE_NAME FROM information_schema.TABLES
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'daemon_instances'
        `);
        if (!vorhanden) return;

        // Sicherheitsnetz: nur droppen, wenn wirklich nichts drinsteht. Sollte
        // eine Installation die Tabelle noch füllen, fällt das hier auf, statt
        // Daten stillschweigend zu verlieren.
        const [{ anzahl }] = await db.query('SELECT COUNT(*) AS anzahl FROM daemon_instances');
        if (anzahl > 0) {
            throw new Error(
                `daemon_instances enthält ${anzahl} Zeilen — erwartet wurden 0. ` +
                'Die Tabelle gilt seit Migration 2.0.0 als aufgelöst; bitte den Inhalt ' +
                'prüfen und nach rootserver überführen, bevor diese Migration läuft.'
            );
        }

        // Fremdschlüssel anderer Tabellen auf daemon_instances lösen, falls noch welche hängen.
        const beziehungen = await db.query(`
            SELECT TABLE_NAME, CONSTRAINT_NAME
            FROM information_schema.KEY_COLUMN_USAGE
            WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME = 'daemon_instances'
        `);
        for (const { TABLE_NAME, CONSTRAINT_NAME } of beziehungen) {
            await db.query(`ALTER TABLE \`${TABLE_NAME}\` DROP FOREIGN KEY \`${CONSTRAINT_NAME}\``);
        }

        await db.query('DROP TABLE IF EXISTS daemon_instances');
    },

    async down(db) {
        await db.query(`
            CREATE TABLE IF NOT EXISTS daemon_instances (
                id INT AUTO_INCREMENT PRIMARY KEY,
                daemon_id VARCHAR(36) UNIQUE NOT NULL,
                guild_id VARCHAR(30) NOT NULL,
                status ENUM('online','offline','error') DEFAULT 'offline',
                version VARCHAR(20) DEFAULT NULL,
                session_token TEXT DEFAULT NULL,
                session_token_expires_at TIMESTAMP NULL DEFAULT NULL,
                last_heartbeat TIMESTAMP NULL DEFAULT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY unique_guild_daemon (guild_id),
                INDEX idx_guild (guild_id),
                INDEX idx_daemon (daemon_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
    }
};
