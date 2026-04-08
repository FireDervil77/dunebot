const DunemapBotPlugin = require('./bot');
const DuneMapPlugin = require('./dashboard');

/**
 * Dunemap-Plugin für FireBot
 * Stellt die uhrsprünglichen funktionen aus dem FireBot bereit!
 */
module.exports = {
  bot: DunemapBotPlugin,
  dashboard: DuneMapPlugin
}