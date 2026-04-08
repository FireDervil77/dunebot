const ModerationBotPlugin = require('./bot');
const ModerationPlugin = require('./dashboard');

/**
 * Moderation-Plugin für FireBot
 * Stellt die ursprünglichen Funktionen aus dem FireBot bereit!
 */
module.exports = {
  bot: ModerationBotPlugin,
  dashboard: ModerationPlugin
}