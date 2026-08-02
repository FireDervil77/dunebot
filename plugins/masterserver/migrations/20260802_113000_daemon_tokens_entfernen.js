'use strict';

/**
 * Entfernt die wirkungslose Token-Verwaltung.
 *
 * `daemon_tokens` war eine vollständig gebaute Mechanik ohne Anschluss: Die
 * Seite erzeugte bcrypt-gehashte Tokens, eine Route widerrief sie, das Modell
 * bot Validierung, Ablauf und Statistik. Gelesen wurde die Tabelle von keiner
 * einzigen Zeile im Repo — `DaemonToken.validate()` und `markUsed()` hatten nie
 * einen Aufrufer.
 *
 * Angemeldet hat sich der Daemon immer anders, und tut es weiterhin: mit
 * `rootserver.api_key` beim ersten Verbinden, danach mit einem JWT
 * (`IPMServer._handleRegister`). Die zehn Zeilen, die im Produktionsbestand
 * standen, haben nie etwas aufgesperrt.
 *
 * Der Widerruf-Weg war zusätzlich kaputt: er verglich `token.daemon_id` gegen
 * den Daemon der Guild, obwohl die Tabelle diese Spalte gar nicht hat (nur
 * `used_by_daemon_id`). Der Vergleich war also immer `undefined !== ...` und
 * jeder Widerruf endete mit 404 "Token nicht gefunden".
 *
 * Mit der Tabelle gehen die Rechte `MASTERSERVER.TOKENS.VIEW` und
 * `MASTERSERVER.TOKENS.MANAGE`, das Modell `DaemonToken.js`, die Seite
 * `masterserver-tokens.ejs` und die drei zugehörigen Routen.
 */
module.exports = {
    description: 'wirkungslose daemon_tokens-Verwaltung entfernen',

    async up(db) {
        await db.query('DROP TABLE IF EXISTS daemon_tokens');

        // Die beiden Rechte aus der Definitionstabelle nehmen, damit sie nicht
        // weiter in der Rechte-Oberfläche zur Vergabe angeboten werden.
        await db.query(
            `DELETE FROM permission_definitions
             WHERE permission_key IN ('MASTERSERVER.TOKENS.VIEW', 'MASTERSERVER.TOKENS.MANAGE')`
        ).catch(() => { /* Tabelle oder Spalte anders benannt — dann bleibt nur der Code-Stand */ });
    },

    async down(db) {
        await db.query(`
            CREATE TABLE IF NOT EXISTS daemon_tokens (
                id INT AUTO_INCREMENT PRIMARY KEY,
                token_hash VARCHAR(255) UNIQUE NOT NULL,
                guild_id VARCHAR(30) NOT NULL,
                created_by VARCHAR(30) DEFAULT NULL,
                description VARCHAR(255) DEFAULT NULL,
                used TINYINT(1) NOT NULL DEFAULT 0,
                used_at TIMESTAMP NULL DEFAULT NULL,
                used_by_daemon_id VARCHAR(36) DEFAULT NULL,
                expires_at TIMESTAMP NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_guild (guild_id),
                INDEX idx_expires (expires_at),
                INDEX idx_token_hash (token_hash)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
        // Die Zeilen selbst kommen nicht zurück — sie hatten keine Wirkung.
    }
};
