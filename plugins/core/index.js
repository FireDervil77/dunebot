const CoreBotPlugin = require('./bot');
const CoreDashboardPlugin = require('./dashboard');

/**
 * Core-Plugin für FireBot
 * Stellt grundlegende Funktionen sowohl für den Bot als auch für das Dashboard bereit
 */
module.exports = {
  bot: CoreBotPlugin,
  dashboard: CoreDashboardPlugin
};