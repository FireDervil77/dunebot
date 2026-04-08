const AutoModBotPlugin = require('./bot');
const AutoModPlugin = require('./dashboard');

/**
 * Moderation-Plugin für FireBot
 * Stellt die ursprünglichen Funktionen aus dem FireBot bereit!
 */
module.exports = {
  bot: AutoModBotPlugin,
  dashboard: AutoModPlugin
}