const TicketBotPlugin = require('./bot');
const TicketPlugin = require('./dashboard');

/**
 * Moderation-Plugin für DuneBot
 * Stellt die ursprünglichen Funktionen aus dem DuneBot bereit!
 */
module.exports = {
  bot: TicketBotPlugin,
  dashboard: TicketPlugin
}