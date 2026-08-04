'use strict';

/**
 * Merkt sich, welchen Befehlssatz eine Guild bei Discord stehen hat.
 *
 * Bisher schrieb der Bot bei JEDEM Start in JEDER Guild alle Slash-Commands neu
 * (`guild.commands.set()` überschreibt vollständig) — ohne zu prüfen, ob sich
 * überhaupt etwas geändert hat. Discord bremst das ab: Am 2026-08-04 dauerte
 * eine einzige Guild 59 Sekunden, über alle Guilds hinweg waren die Befehle
 * rund vier Minuten lang weg oder veraltet. Bei 23 Neustarts an einem Tag
 * viermal täglich ein Ausfall, den niemand gebraucht hätte.
 *
 * `commands_hash` hält die Prüfsumme des zuletzt übertragenen Satzes. Stimmt
 * sie beim Start noch, wird nichts gesendet.
 */
module.exports = {
    description: 'Prüfsumme des registrierten Slash-Command-Satzes je Guild',

    async up(db) {
        await db.query(`
            CREATE TABLE IF NOT EXISTS guild_command_state (
                guild_id      VARCHAR(32) NOT NULL PRIMARY KEY,
                commands_hash CHAR(64)    NOT NULL COMMENT 'SHA-256 des uebertragenen Satzes',
                command_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
                updated_at    TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
              COMMENT='Was bei Discord steht — damit der Start nicht blind neu registriert'
        `);
    },

    async down(db) {
        await db.query('DROP TABLE IF EXISTS guild_command_state');
    }
};
