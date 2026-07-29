/**
 * UpdateOptions – Auto-Update-Parameter für Start- und Restart-Befehle
 *
 * Der Daemon aktualisiert die Spieldateien vor jedem Start, wenn auto_update
 * gesetzt ist. Dafür braucht er die Steam-AppID und das Installer-Image – beides
 * steht nicht am Server, sondern in dessen Variablen bzw. im Addon.
 *
 * Damit Start, Neustart und Cronjob dieselben Daten mitschicken (sonst würde
 * z.B. der nächtliche Neustart das Update stillschweigend überspringen), liegt
 * die Auflösung an genau einer Stelle.
 *
 * @module helpers/UpdateOptions
 * @author FireBot Team
 */

'use strict';

/** @private */
function parseJson(value, fallback) {
    if (value == null) return fallback;
    if (typeof value !== 'string') return value;
    try { return JSON.parse(value); } catch (_) { return fallback; }
}

/**
 * Baut die Auto-Update-Felder für ein IPM-Payload.
 *
 * @param {object} server - Zeile aus gameservers (auto_update, env_variables,
 *                          frozen_game_data) – optional mit steam_app_id/
 *                          steam_server_app_id aus addon_marketplace
 * @returns {{auto_update: boolean, steam_app_id: string|null, install_image: string|null}}
 */
function resolveUpdateOptions(server) {
    const envVars  = parseJson(server.env_variables, {}) || {};
    const gameData = parseJson(server.frozen_game_data, {}) || {};

    // SRCDS_APPID gewinnt: das ist die AppID, mit der auch installiert wurde.
    const steamAppId = envVars.SRCDS_APPID
        || server.steam_server_app_id
        || server.steam_app_id
        || null;

    // SteamCMD läuft im Installer-Image, nicht im Runtime-Image
    const installImage = gameData.scripts?.installation?.container
        || gameData.installation?.docker_image
        || null;

    return {
        auto_update:   !!server.auto_update && !!steamAppId,
        steam_app_id:  steamAppId ? String(steamAppId) : null,
        install_image: installImage,
    };
}

module.exports = { resolveUpdateOptions };
