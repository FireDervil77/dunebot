const GreetingBotPlugin = require('./bot');
const GretingDashboardPlugin = require('./dashboard');

/**
 * Core-Plugin für DuneBot
 * Stellt grundlegende Funktionen sowohl für den Bot als auch für das Dashboard bereit
 */
module.exports = {
  bot: GreetingBotPlugin,
  dashboard: GretingDashboardPlugin
};