const StreamingBotPlugin = require('./bot');
const StreamingDashboardPlugin = require('./dashboard');

/**
 * Streaming-Plugin fuer FireBot
 *
 * Meldet im Discord, wenn ein beobachteter Kanal live geht. Twitch zuerst und
 * allein; Kick und YouTube folgen als eigene Adapter, ohne dass der Kern sie
 * kennen muss.
 *
 * Der Plan dazu steht in docs/streamer-plugin/ - Wiedereinstieg ueber STAND.md.
 */
module.exports = {
    bot: StreamingBotPlugin,
    dashboard: StreamingDashboardPlugin
};
