const InfoBotPlugin = require('./bot');
const InfoDashboardPlugin = require('./dashboard');

/**
 * Info-Plugin für DuneBot
 * Stellt verschiedene Informationen rund um den Server / Owner / Member bereit
 */
module.exports = {
  bot: InfoBotPlugin,
  dashboard: InfoDashboardPlugin
}