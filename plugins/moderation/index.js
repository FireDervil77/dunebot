const ModerationBotPlugin = require('./bot');
const ModerationPlugin = require('./dashboard');

/**
 * Moderation-Plugin für DuneBot
 * Stellt die ursprünglichen Funktionen aus dem DuneBot bereit!
 */
module.exports = {
  bot: ModerationBotPlugin,
  dashboard: ModerationPlugin
}