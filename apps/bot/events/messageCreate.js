const SpieleUpdates = require("../helpers/SpieleUpdates");

/**
 * Kern-Event: messageCreate
 * Eine Ankündigung im Kanal mit den Spiele-Updates wird ein Blogbeitrag.
 * Alles andere prüft `SpieleUpdates` selbst und lässt es liegen.
 *
 * @param {import('discord.js').Message} message
 */
module.exports = (message) => SpieleUpdates.beiNachricht(message);
