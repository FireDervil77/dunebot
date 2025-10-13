const AutoModBotPlugin = require('./bot');
const AutoModPlugin = require('./dashboard');

/**
 * Moderation-Plugin für DuneBot
 * Stellt die ursprünglichen Funktionen aus dem DuneBot bereit!
 */
module.exports = {
  bot: AutoModBotPlugin,
  dashboard: AutoModPlugin
}