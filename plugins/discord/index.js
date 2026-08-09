const DiscordBotPlugin = require('./bot');
const DiscordDashboardPlugin = require('./dashboard');

/**
 * Discord-Plugin für FireBot
 *
 * Der einzige Bereich, in dem das Dashboard **Discord selbst** anfasst statt
 * unseren Bot zu konfigurieren: Rollen anlegen, ändern und löschen, Kanäle
 * einsehen. Bis zum 2026-08-09 hing das unter „Einstellungen" im Kern und
 * stand dort zwischen Schaltern, die das Verhalten des Bots regeln.
 *
 * Die IPC-Handler (`dashboard:GET_GUILD_ROLES_DETAILED` und Verwandte) bleiben
 * bewusst im Kern unter `apps/bot/ipc/` — sie sind gemeinsame Infrastruktur,
 * `music` und andere Plugins fragen dort ebenfalls Rollen und Kanäle ab.
 */
module.exports = {
    bot: DiscordBotPlugin,
    dashboard: DiscordDashboardPlugin
};
