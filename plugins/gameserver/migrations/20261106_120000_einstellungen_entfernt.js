'use strict';

/**
 * Die Einstellungsseite des Gameserver-Plugins ist entfallen (2026-11-06).
 *
 * Sie speicherte fünf Werte (automatischer Start, Addon-Updates, Höchstzahl
 * Server, Sicherung, Intervall), die nichts las. Gespeichert hat sie mit
 * `setConfig('gameserver', guildId, config)` — die Reihenfolge ist aber
 * `(plugin, schlüssel, wert, …)`. Herausgekommen ist eine GLOBALE Zeile mit
 * der Guild-ID als Schlüssel und dem ganzen Objekt als Wert. Gemessen am
 * 2026-11-06: genau eine (Nr. 3478, vom 2026-03-20).
 *
 * Gelöscht wird nur, was diese Seite geschrieben hat: Schlüssel aus Ziffern,
 * keine Guild, und ein Wert mit `auto_start_servers` darin.
 */
module.exports = {
    description: 'gameserver-einstellungsseite-entfernt',

    async up(db) {
        await db.query(
            `DELETE FROM configs
              WHERE plugin_name = 'gameserver'
                AND guild_id IS NULL
                AND config_key REGEXP '^[0-9]{17,20}$'
                AND config_value LIKE '%"auto_start_servers"%'`
        );
    },

    // Kein Rückweg: Die Werte hat nie jemand gelesen, und die Seite, die sie
    // schrieb, gibt es nicht mehr.
    async down() {}
};
