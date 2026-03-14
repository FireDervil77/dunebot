const GameserverBotPlugin = require('./bot');
const GameserverPlugin = require('./dashboard');

/**
 * Core-Plugin für DuneBot
 * Stellt grundlegende Funktionen sowohl für den Bot als auch für das Dashboard bereit
 */
module.exports = {
  bot: GameserverBotPlugin,
  dashboard: GameserverPlugin
};