const Messprobe = require("../helpers/Messprobe");

/**
 * Kern-Event: messageDeleteBulk
 * Die Messprobe G-18 zählt gesammelt gelöschte Nachrichten
 * (Moderation, `/clear`). Discord meldet sie nicht einzeln.
 *
 * @param {import('discord.js').ReadonlyCollection<string, import('discord.js').Message>} nachrichten
 * @param {import('discord.js').GuildTextBasedChannel} kanal
 */
module.exports = (nachrichten, kanal) => Messprobe.geloescht(kanal?.guildId, nachrichten?.size || 0);
