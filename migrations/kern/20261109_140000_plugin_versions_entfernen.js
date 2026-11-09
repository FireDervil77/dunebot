'use strict';

/**
 * `plugin_versions` entfernen (K358, 2026-11-09, Ja des Betreibers).
 *
 * Eine Update-Verwaltung „WordPress-Style“ mit Fristen, Changelog und
 * `update_status`. Gemessen vor dem Abriss: keine Codezeile in apps,
 * packages, plugins, migrations und im Daemon liest oder schreibt sie, keine
 * Fremdschlüssel, Views oder Trigger. 7 Zeilen, alle `core` 6.8.0
 * „up-to-date“, zuletzt geprüft am 2025-11-01. Was sie bedienen sollte, die
 * Kette „Plugin aktualisieren“, ist mit K028 (9565b436) entfallen: Plugins
 * ziehen ihre Fassung beim Start nach (`guild_plugins.plugin_version`).
 *
 * Definition und Zeilen liegen lokal in
 * `docs_bak/datenbank-abriss/plugin_versions-2026-11-09.json`.
 * `down` legt die leere Tabelle wieder an; die Zeilen sagten nichts, was nicht
 * auch `guild_plugins` sagt.
 */
module.exports = {
    async up(db) {
        await db.query('DROP TABLE IF EXISTS plugin_versions');
    },

    async down(db) {
        await db.query(`CREATE TABLE IF NOT EXISTS plugin_versions (
            id int(11) NOT NULL AUTO_INCREMENT,
            plugin_name varchar(50) NOT NULL,
            guild_id varchar(20) NOT NULL,
            current_version varchar(20) NOT NULL DEFAULT '0.0.0',
            available_version varchar(20) DEFAULT NULL,
            update_available_at timestamp NULL DEFAULT NULL,
            update_deadline_at timestamp NULL DEFAULT NULL,
            auto_update_at timestamp NULL DEFAULT NULL,
            update_status enum('up-to-date','available','pending','auto-updated','failed') DEFAULT 'up-to-date',
            last_check_at timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
            updated_at timestamp NULL DEFAULT NULL,
            changelog longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(changelog)),
            error_log text DEFAULT NULL,
            PRIMARY KEY (id),
            UNIQUE KEY unique_plugin_guild (plugin_name, guild_id),
            KEY idx_deadline (update_deadline_at, update_status),
            KEY idx_guild (guild_id),
            KEY idx_status (update_status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    }
};
