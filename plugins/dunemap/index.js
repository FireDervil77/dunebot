const DunemapBotPlugin = require('./bot');
const DuneMapPlugin = require('./dashboard');

/**
 * Dunemap-Plugin für DuneBot
 * Stellt die uhrsprünglichen funktionen aus dem DuneBot bereit!
 */
module.exports = {
  bot: DunemapBotPlugin,
  dashboard: DuneMapPlugin
}