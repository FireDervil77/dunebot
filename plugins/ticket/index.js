const TicketBotPlugin = require('./bot');
const TicketPlugin = require('./dashboard');

/**
 * Moderation-Plugin für FireBot
 * Stellt die ursprünglichen Funktionen aus dem FireBot bereit!
 */
module.exports = {
  bot: TicketBotPlugin,
  dashboard: TicketPlugin
}