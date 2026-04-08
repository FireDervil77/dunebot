const MasterserverBotPlugin = require('./bot');
const MasterserverDashboardPlugin = require('./dashboard');

/**
 * Core-Plugin für FireBot
 * Stellt grundlegende Funktionen sowohl für den Bot als auch für das Dashboard bereit
 */
module.exports = {
  bot: MasterserverBotPlugin,
  dashboard: MasterserverDashboardPlugin
};